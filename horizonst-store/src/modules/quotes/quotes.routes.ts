import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { insertQuoteStatusHistory as defaultInsertQuoteStatusHistory } from '../admin/quotes/history.js';
import { generateQuotePdf as defaultGenerateQuotePdf } from '../admin/quotes/pdf.js';
import type { QuoteStatus } from '../admin/quotes/status.js';
import { writeAuditLog as defaultWriteAuditLog } from '../shared/audit.js';
import { createOrderFromAcceptedQuote as defaultCreateOrderFromAcceptedQuote } from '../orders/order.service.js';
import { commercialMailRecipient, sanitizeMailError, sendOrderConfirmationEmail as defaultSendOrderConfirmationEmail, sendQuoteAcceptedCommercialEmail as defaultSendQuoteAcceptedCommercialEmail } from '../shared/mail.js';

const idSchema = z.string().uuid();
export const quoteDecisionSchema = z.object({ comment: z.string().trim().max(5000).optional() }).strict();
type DecisionStatus = Extract<QuoteStatus, 'accepted' | 'rejected'>;
type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };
type Client = Queryable & { release: () => void };
type PoolLike = Queryable & { connect: () => Promise<Client> };

export type QuotesRouterDependencies = {
  pool?: PoolLike;
  authMiddleware?: RequestHandler;
  roleMiddleware?: RequestHandler;
  insertQuoteStatusHistory?: typeof defaultInsertQuoteStatusHistory;
  writeAuditLog?: typeof defaultWriteAuditLog;
  generateQuotePdf?: typeof defaultGenerateQuotePdf;
  createOrderFromAcceptedQuote?: typeof defaultCreateOrderFromAcceptedQuote;
  sendQuoteAcceptedCommercialEmail?: typeof defaultSendQuoteAcceptedCommercialEmail;
  sendOrderConfirmationEmail?: typeof defaultSendOrderConfirmationEmail;
};

const logMailFailure = (event: string, to: string, error: unknown) => {
  console.error('store_mail_failed', { event, to, error: sanitizeMailError(error) });
};

const publicQuoteColumns = `q.id, q.user_id, q.quote_number, q.status, q.subtotal_cents, q.discount_cents, q.tax_cents, q.total_cents, q.notes, q.created_at, q.updated_at, q.submitted_at, q.accepted_at, q.rejected_at`;
const quotePdfSelect = `SELECT q.quote_number, q.created_at, q.subtotal_cents, q.tax_cents, q.total_cents, q.notes, u.email, u.full_name, COALESCE(cp.company_name, dp.company_name) AS company_name FROM store.quotes q JOIN store.users u ON u.id = q.user_id LEFT JOIN store.customer_profiles cp ON cp.user_id = u.id LEFT JOIN store.distributor_profiles dp ON dp.user_id = u.id WHERE q.id = $1`;

export const createQuotesRouter = (dependencies: QuotesRouterDependencies = {}) => {
  const router = Router();
  const quotePool = dependencies.pool ?? defaultPool;
  const insertQuoteStatusHistory = dependencies.insertQuoteStatusHistory ?? defaultInsertQuoteStatusHistory;
  const writeAuditLog = dependencies.writeAuditLog ?? defaultWriteAuditLog;
  const generateQuotePdf = dependencies.generateQuotePdf ?? defaultGenerateQuotePdf;
  const createOrderFromAcceptedQuote = dependencies.createOrderFromAcceptedQuote ?? defaultCreateOrderFromAcceptedQuote;
  const sendQuoteAcceptedCommercialEmail = dependencies.sendQuoteAcceptedCommercialEmail ?? defaultSendQuoteAcceptedCommercialEmail;
  const sendOrderConfirmationEmail = dependencies.sendOrderConfirmationEmail ?? defaultSendOrderConfirmationEmail;

  router.use(dependencies.authMiddleware ?? requireAuth, dependencies.roleMiddleware ?? requireRole('customer', 'distributor'));

  router.get('/', async (req, res, next) => {
    try {
      const { rows } = await quotePool.query(`SELECT ${publicQuoteColumns} FROM store.quotes q WHERE q.user_id = $1 ORDER BY q.created_at DESC LIMIT 200`, [req.user!.sub]);
      res.json({ quotes: rows });
    } catch (error) { next(error); }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id);
      const quote = await quotePool.query(`SELECT ${publicQuoteColumns} FROM store.quotes q WHERE q.id = $1 AND q.user_id = $2`, [id, req.user!.sub]);
      if (!quote.rows[0]) { res.status(404).json({ error: 'Quote not found' }); return; }
      const items = await quotePool.query(`SELECT id, item_type, product_id, saas_plan_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1 ORDER BY description ASC`, [id]);
      const history = await quotePool.query(`SELECT id, quote_id, old_status, new_status, comment, changed_by, created_at FROM store.quote_status_history WHERE quote_id = $1 ORDER BY created_at DESC`, [id]);
      res.json({ quote: quote.rows[0], items: items.rows, history: history.rows });
    } catch (error) { next(error); }
  });

  router.get('/:id/pdf', async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id);
      const quote = await quotePool.query(`${quotePdfSelect} AND q.user_id = $2`, [id, req.user!.sub]);
      if (!quote.rows[0]) { res.status(404).json({ error: 'Quote not found' }); return; }
      const items = await quotePool.query(`SELECT description, quantity, unit_price_cents, line_subtotal_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1 ORDER BY description ASC`, [id]);
      const pdf = await generateQuotePdf({ quote: quote.rows[0], items: items.rows });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${quote.rows[0].quote_number}.pdf"`);
      res.setHeader('Content-Length', pdf.length.toString());
      res.send(pdf);
    } catch (error) { next(error); }
  });

  const decideQuote = (status: DecisionStatus) => async (req: any, res: any, next: any) => {
    const client = await quotePool.connect();
    try {
      const id = idSchema.parse(req.params.id); const input = quoteDecisionSchema.parse(req.body ?? {});
      await client.query('BEGIN');
      const existing = await client.query(`SELECT q.id, q.status, q.quote_number, q.total_cents, u.email, u.full_name FROM store.quotes q JOIN store.users u ON u.id = q.user_id WHERE q.id = $1 AND q.user_id = $2 FOR UPDATE`, [id, req.user.sub]);
      if (!existing.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Quote not found' }); return; }
      const oldStatus = existing.rows[0].status as QuoteStatus;
      if (oldStatus !== 'sent') { await client.query('ROLLBACK'); res.status(409).json({ error: 'Quote must be sent before it can be accepted or rejected', previous_status: oldStatus, status }); return; }
      const acceptedAtSql = status === 'accepted' ? 'now()' : 'NULL';
      const rejectedAtSql = status === 'rejected' ? 'now()' : 'NULL';
      const { rows } = await client.query(`UPDATE store.quotes q SET status = $2, accepted_at = ${acceptedAtSql}, rejected_at = ${rejectedAtSql}, updated_at = now() WHERE q.id = $1 AND q.user_id = $3 RETURNING ${publicQuoteColumns}`, [id, status, req.user.sub]);
      await insertQuoteStatusHistory({ quoteId: id, oldStatus, newStatus: status, comment: input.comment ?? null, changedBy: req.user.sub }, client);
      await writeAuditLog({ actorUserId: req.user.sub, action: status === 'accepted' ? 'quote_accepted' : 'quote_rejected', entityType: 'quote', entityId: id, payload: { previous_status: oldStatus, status, comment: input.comment ?? null } }, client);
      const orderResult = status === 'accepted' ? await createOrderFromAcceptedQuote({ client, quoteId: id, actorUserId: req.user.sub, writeAuditLog }) : null;
      await client.query('COMMIT');
      if (status === 'accepted' && orderResult?.order) {
        const quoteForEmail = { ...existing.rows[0], ...rows[0], email: existing.rows[0].email, full_name: existing.rows[0].full_name };
        void sendQuoteAcceptedCommercialEmail({ quote: quoteForEmail, order: orderResult.order }).catch((error) => logMailFailure('quote_accepted_commercial', commercialMailRecipient, error));
        void sendOrderConfirmationEmail({ quote: quoteForEmail, order: orderResult.order }).catch((error) => logMailFailure('order_confirmation', quoteForEmail.email, error));
      }
      res.json(orderResult ? { quote: rows[0], order: orderResult.order } : { quote: rows[0] });
    } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
  };

  router.post('/:id/accept', decideQuote('accepted'));
  router.post('/:id/reject', decideQuote('rejected'));

  return router;
};

export const quotesRouter = createQuotesRouter();
export const quotePdfSelectForAdmin = quotePdfSelect;
