import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { transactionCleanup } from '../../db/transaction-cleanup.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { insertQuoteStatusHistory as defaultInsertQuoteStatusHistory } from './quotes/history.js';
import { generateQuotePdf as defaultGenerateQuotePdf } from './quotes/pdf.js';
import { quotePdfSelectForAdmin } from '../quotes/quotes.routes.js';
import { canTransitionQuoteStatus, quoteStatuses, quoteStatusChangeSchema, type QuoteStatus } from './quotes/status.js';
import { createOrderFromAcceptedQuote as defaultCreateOrderFromAcceptedQuote } from '../orders/order.service.js';
import { buildOrderConfirmationEmail, buildQuoteAvailableEmail, deliverNotificationMail, type NotificationOutcome, type OrderConfirmationEmailInput, type QuoteEmailInput } from '../shared/mail.js';
import { insertNotificationIntent, notificationJournal } from '../shared/notification-journal.js';
import { commercialDocumentFilename } from '../shared/commercial-document-pdf.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };
type Client = Queryable & { release: (destroy?: boolean) => void };
type PoolLike = Queryable & { connect: () => Promise<Client> };

export type AdminQuotesRouterDependencies = {
  pool?: PoolLike;
  authMiddleware?: RequestHandler;
  roleMiddleware?: RequestHandler;
  insertQuoteStatusHistory?: typeof defaultInsertQuoteStatusHistory;
  generateQuotePdf?: typeof defaultGenerateQuotePdf;
  createOrderFromAcceptedQuote?: typeof defaultCreateOrderFromAcceptedQuote;
  sendQuoteAvailableEmail?: (input: QuoteEmailInput) => Promise<NotificationOutcome | void>;
  sendOrderConfirmationEmail?: (input: OrderConfirmationEmailInput) => Promise<NotificationOutcome | void>;
  insertNotificationIntent?: typeof insertNotificationIntent;
  notificationJournal?: Pick<typeof notificationJournal, 'dispatch'>;
};

const idSchema = z.string().uuid();

export const createAdminQuotesRouter = (dependencies: AdminQuotesRouterDependencies = {}) => {
const router = Router();
const pool = dependencies.pool ?? defaultPool;
const insertQuoteStatusHistory = dependencies.insertQuoteStatusHistory ?? defaultInsertQuoteStatusHistory;
const generateQuotePdf = dependencies.generateQuotePdf ?? defaultGenerateQuotePdf;
const createOrderFromAcceptedQuote = dependencies.createOrderFromAcceptedQuote ?? defaultCreateOrderFromAcceptedQuote;
const sendQuoteAvailableEmail = dependencies.sendQuoteAvailableEmail ?? (input => deliverNotificationMail(buildQuoteAvailableEmail(input)));
const sendOrderConfirmationEmail = dependencies.sendOrderConfirmationEmail ?? (input => deliverNotificationMail(buildOrderConfirmationEmail(input)));
const insertIntent = dependencies.insertNotificationIntent ?? insertNotificationIntent;
const journal = dependencies.notificationJournal ?? notificationJournal;

router.use(dependencies.authMiddleware ?? requireAuth, dependencies.roleMiddleware ?? requireRole('admin'));

router.get('/quotes', async (req, res, next) => {
  try {
    const query = z.object({ status: z.enum(quoteStatuses).optional(), email: z.string().optional(), quote_number: z.string().optional() }).parse(req.query);
    const params: unknown[] = []; const where: string[] = [];
    if (query.status) { params.push(query.status); where.push(`q.status = $${params.length}`); }
    if (query.email) { params.push(`%${query.email}%`); where.push(`u.email ILIKE $${params.length}`); }
    if (query.quote_number) { params.push(`%${query.quote_number}%`); where.push(`q.quote_number ILIKE $${params.length}`); }
    const { rows } = await pool.query(`SELECT q.id, q.quote_number, q.status, q.subtotal_cents, q.discount_cents, q.tax_cents, q.total_cents, q.created_at, q.updated_at, q.submitted_at, u.id AS user_id, u.email, u.full_name, u.role FROM store.quotes q JOIN store.users u ON u.id = q.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY q.created_at DESC LIMIT 200`, params);
    res.json({ quotes: rows });
  } catch (error) { next(error); }
});

router.get('/quotes/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const quote = await pool.query(`SELECT q.*, u.email, u.full_name, u.role FROM store.quotes q JOIN store.users u ON u.id = q.user_id WHERE q.id = $1`, [id]);
    if (!quote.rows[0]) { res.status(404).json({ error: 'Quote not found' }); return; }
    const items = await pool.query(`SELECT id, item_type, product_id, saas_plan_id, pack_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1 ORDER BY description ASC`, [id]);
    const history = await pool.query(`SELECT h.id, h.quote_id, h.old_status, h.new_status, h.comment, h.changed_by, h.created_at, u.email AS changed_by_email, u.full_name AS changed_by_full_name FROM store.quote_status_history h LEFT JOIN store.users u ON u.id = h.changed_by WHERE h.quote_id = $1 ORDER BY h.created_at DESC`, [id]);
    res.json({ quote: quote.rows[0], items: items.rows, history: history.rows });
  } catch (error) { next(error); }
});

router.get('/quotes/:id/pdf', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const quote = await pool.query(quotePdfSelectForAdmin, [id]);
    if (!quote.rows[0]) { res.status(404).json({ error: 'Quote not found' }); return; }
    const items = await pool.query(`SELECT description, quantity, unit_price_cents, discount_percent, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1 ORDER BY description ASC`, [id]);
    const pdf = await generateQuotePdf({ quote: quote.rows[0], items: items.rows });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${commercialDocumentFilename('quote', quote.rows[0].quote_number)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', pdf.length.toString());
    res.send(pdf);
  } catch (error) { next(error); }
});

router.patch('/quotes/:id/status', async (req, res, next) => {
  let client: Client;
  try { client = await pool.connect(); }
  catch { res.status(503).json({ error: 'notification_database_unavailable' }); return; }
  const transaction = transactionCleanup(client);
  try {
    const id = idSchema.parse(req.params.id); const input = quoteStatusChangeSchema.parse(req.body);
    await client.query('BEGIN');
    const existing = await client.query('SELECT q.id, q.status, q.quote_number, q.total_cents, u.email, u.full_name, u.role FROM store.quotes q JOIN store.users u ON u.id = q.user_id WHERE q.id = $1 FOR UPDATE', [id]);
    if (!existing.rows[0]) { await transaction.rollback(); res.status(404).json({ error: 'Quote not found' }); return; }
    const oldStatus = existing.rows[0].status as QuoteStatus;
    if (oldStatus === input.status) { await transaction.rollback(); res.status(409).json({ error: 'Quote status is already set to the requested value' }); return; }
    if (!canTransitionQuoteStatus(oldStatus, input.status)) { await transaction.rollback(); res.status(409).json({ error: 'Invalid quote status transition', previous_status: oldStatus, status: input.status }); return; }
    const acceptedAtSql = input.status === 'accepted' ? 'now()' : input.status === 'rejected' ? 'NULL' : 'accepted_at';
    const rejectedAtSql = input.status === 'rejected' ? 'now()' : input.status === 'accepted' ? 'NULL' : 'rejected_at';
    const { rows } = await client.query(`UPDATE store.quotes SET status = $2, internal_notes = COALESCE($3, internal_notes), accepted_at = ${acceptedAtSql}, rejected_at = ${rejectedAtSql}, reviewed_at = now(), reviewed_by = $4, updated_at = now() WHERE id = $1 RETURNING *`, [id, input.status, input.internal_notes ?? null, req.user!.sub]);
    const historyId = await insertQuoteStatusHistory({ quoteId: id, oldStatus, newStatus: input.status, comment: input.comment ?? null, changedBy: req.user!.sub }, client);
    const orderResult = input.status === 'accepted' ? await createOrderFromAcceptedQuote({ client, quoteId: id, actorUserId: req.user!.sub }) : null;
    const availableId = oldStatus === 'in_review' && input.status === 'sent' ? await insertIntent(client, { historyId, type: 'quote_available' }) : null;
    const confirmationId = orderResult?.order ? await insertIntent(client, { historyId, type: 'order_confirmation', orderId: orderResult.order.id }) : null;
    await transaction.commit();
    const quoteForEmail = { ...existing.rows[0], ...rows[0], email: existing.rows[0].email, full_name: existing.rows[0].full_name };
    if (oldStatus === 'in_review' && input.status === 'sent') {
      void journal.dispatch(availableId!, () => sendQuoteAvailableEmail({ quote: quoteForEmail }));
    }
    if (input.status === 'accepted' && orderResult?.order) {
      void journal.dispatch(confirmationId!, () => sendOrderConfirmationEmail({ quote: quoteForEmail, order: orderResult.order }));
    }
    res.json(orderResult ? { quote: rows[0], order: orderResult.order } : { quote: rows[0] });
  } catch (error) { await transaction.failed(error); next(error); }
  finally { client.release(transaction.discard || undefined); }
});

return router;
};

export const adminQuotesRouter = createAdminQuotesRouter();
