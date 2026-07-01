import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { insertQuoteStatusHistory } from '../admin/quotes/history.js';
import { generateQuotePdf } from '../admin/quotes/pdf.js';
import type { QuoteStatus } from '../admin/quotes/status.js';
import { writeAuditLog } from '../shared/audit.js';

export const quotesRouter = Router();
quotesRouter.use(requireAuth, requireRole('customer', 'distributor'));

const idSchema = z.string().uuid();
export const quoteDecisionSchema = z.object({ comment: z.string().trim().max(5000).optional() }).strict();
type DecisionStatus = Extract<QuoteStatus, 'accepted' | 'rejected'>;

const publicQuoteColumns = `q.id, q.user_id, q.quote_number, q.status, q.subtotal_cents, q.discount_cents, q.tax_cents, q.total_cents, q.notes, q.created_at, q.updated_at, q.submitted_at, q.accepted_at, q.rejected_at`;

quotesRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${publicQuoteColumns} FROM store.quotes q WHERE q.user_id = $1 ORDER BY q.created_at DESC LIMIT 200`, [req.user!.sub]);
    res.json({ quotes: rows });
  } catch (error) { next(error); }
});

quotesRouter.get('/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const quote = await pool.query(`SELECT ${publicQuoteColumns} FROM store.quotes q WHERE q.id = $1 AND q.user_id = $2`, [id, req.user!.sub]);
    if (!quote.rows[0]) { res.status(404).json({ error: 'Quote not found' }); return; }
    const items = await pool.query(`SELECT id, item_type, product_id, saas_plan_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1 ORDER BY description ASC`, [id]);
    const history = await pool.query(`SELECT id, quote_id, old_status, new_status, comment, changed_by, created_at FROM store.quote_status_history WHERE quote_id = $1 ORDER BY created_at DESC`, [id]);
    res.json({ quote: quote.rows[0], items: items.rows, history: history.rows });
  } catch (error) { next(error); }
});

quotesRouter.get('/:id/pdf', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const quote = await pool.query(`SELECT q.quote_number, q.created_at, q.subtotal_cents, q.tax_cents, q.total_cents, q.notes, u.email, u.full_name, cp.company_name FROM store.quotes q JOIN store.users u ON u.id = q.user_id LEFT JOIN store.customer_profiles cp ON cp.user_id = u.id WHERE q.id = $1 AND q.user_id = $2`, [id, req.user!.sub]);
    if (!quote.rows[0]) { res.status(404).json({ error: 'Quote not found' }); return; }
    const items = await pool.query(`SELECT description, quantity, unit_price_cents, line_subtotal_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1 ORDER BY description ASC`, [id]);
    const pdf = await generateQuotePdf({ quote: quote.rows[0], items: items.rows });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quote.rows[0].quote_number}.pdf"`);
    res.setHeader('Content-Length', pdf.length.toString());
    res.send(pdf);
  } catch (error) { next(error); }
});

const decideQuote = (status: DecisionStatus) => async (req: any, res: any, next: any) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id); const input = quoteDecisionSchema.parse(req.body ?? {});
    await client.query('BEGIN');
    const existing = await client.query(`SELECT q.id, q.status FROM store.quotes q WHERE q.id = $1 AND q.user_id = $2 FOR UPDATE`, [id, req.user.sub]);
    if (!existing.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Quote not found' }); return; }
    const oldStatus = existing.rows[0].status as QuoteStatus;
    if (oldStatus !== 'sent') { await client.query('ROLLBACK'); res.status(409).json({ error: 'Quote must be sent before it can be accepted or rejected', previous_status: oldStatus, status }); return; }
    const acceptedAtSql = status === 'accepted' ? 'now()' : 'NULL';
    const rejectedAtSql = status === 'rejected' ? 'now()' : 'NULL';
    const { rows } = await client.query(`UPDATE store.quotes q SET status = $2, accepted_at = ${acceptedAtSql}, rejected_at = ${rejectedAtSql}, updated_at = now() WHERE q.id = $1 AND q.user_id = $3 RETURNING ${publicQuoteColumns}`, [id, status, req.user.sub]);
    await insertQuoteStatusHistory({ quoteId: id, oldStatus, newStatus: status, comment: input.comment ?? null, changedBy: req.user.sub }, client);
    await writeAuditLog({ actorUserId: req.user.sub, action: status === 'accepted' ? 'quote_accepted' : 'quote_rejected', entityType: 'quote', entityId: id, payload: { previous_status: oldStatus, status, comment: input.comment ?? null } }, client);
    await client.query('COMMIT'); res.json({ quote: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
};

quotesRouter.post('/:id/accept', decideQuote('accepted'));
quotesRouter.post('/:id/reject', decideQuote('rejected'));
