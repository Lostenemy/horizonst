import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';
import { calculateLineTotals, fetchQuoteWithItems, generateQuoteNumber, getDistributorDiscountPercent, getOrCreateDraftQuote, recalculateQuote } from './cart.service.js';

export const cartRouter = Router();
cartRouter.use(requireAuth, requireRole('customer', 'distributor', 'admin'));

const idSchema = z.string().uuid();
const quantitySchema = z.object({ quantity: z.number().int().positive().max(9999) }).strict();
const addItemSchema = z.discriminatedUnion('item_type', [
  z.object({ item_type: z.literal('product'), product_id: z.string().uuid(), quantity: z.number().int().positive().max(9999) }).strict(),
  z.object({ item_type: z.literal('saas_plan'), saas_plan_id: z.string().uuid(), quantity: z.number().int().positive().max(9999) }).strict()
]);

cartRouter.get('/', async (req, res, next) => {
  try {
    const quote = await getOrCreateDraftQuote(req.user!.sub);
    res.json(await fetchQuoteWithItems(quote.id));
  } catch (error) { next(error); }
});

cartRouter.post('/items', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = addItemSchema.parse(req.body);
    await client.query('BEGIN');
    const quote = await getOrCreateDraftQuote(req.user!.sub, client);
    const discountPercent = await getDistributorDiscountPercent(req.user!.sub, req.user!.role, client);
    let item: any;
    if (input.item_type === 'product') {
      const { rows } = await client.query('SELECT id, name, price_cents, tax_rate FROM store.products WHERE id = $1 AND is_active = true', [input.product_id]);
      if (!rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Active product not found' }); return; }
      item = { product_id: rows[0].id, saas_plan_id: null, description: rows[0].name, unit_price_cents: rows[0].price_cents, tax_rate: rows[0].tax_rate };
    } else {
      const { rows } = await client.query('SELECT id, name, annual_price_cents, tax_rate, is_enterprise FROM store.saas_plans WHERE id = $1 AND is_active = true', [input.saas_plan_id]);
      if (!rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Active SaaS plan not found' }); return; }
      if (rows[0].is_enterprise || rows[0].annual_price_cents === null) { await client.query('ROLLBACK'); res.status(422).json({ error: 'Enterprise plans require commercial contact' }); return; }
      item = { product_id: null, saas_plan_id: rows[0].id, description: rows[0].name, unit_price_cents: rows[0].annual_price_cents, tax_rate: rows[0].tax_rate };
    }
    const existing = await client.query(`SELECT * FROM store.quote_items WHERE quote_id = $1 AND item_type = $2 AND product_id IS NOT DISTINCT FROM $3 AND saas_plan_id IS NOT DISTINCT FROM $4`, [quote.id, input.item_type, item.product_id, item.saas_plan_id]);
    const quantity = Number(existing.rows[0]?.quantity ?? 0) + input.quantity;
    const totals = calculateLineTotals({ quantity, unitPriceCents: Number(item.unit_price_cents), discountPercent, taxRate: item.tax_rate });
    const params = [quote.id, input.item_type, item.product_id, item.saas_plan_id, item.description, quantity, item.unit_price_cents, discountPercent, item.tax_rate, totals.line_subtotal_cents, totals.line_discount_cents, totals.line_tax_cents, totals.line_total_cents];
    const { rows } = existing.rows[0]
      ? await client.query(`UPDATE store.quote_items SET quantity = $6, discount_percent = $8, tax_rate = $9, line_subtotal_cents = $10, line_discount_cents = $11, line_tax_cents = $12, line_total_cents = $13 WHERE id = $14 RETURNING *`, [...params, existing.rows[0].id])
      : await client.query(`INSERT INTO store.quote_items (quote_id, item_type, product_id, saas_plan_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, params);
    await recalculateQuote(quote.id, client);
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'cart_item_added', entityType: 'quote_item', entityId: rows[0].id, payload: { quote_id: quote.id, item_type: input.item_type, quantity: input.quantity } }, client);
    await client.query('COMMIT'); res.status(201).json(await fetchQuoteWithItems(quote.id));
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

cartRouter.patch('/items/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id); const { quantity } = quantitySchema.parse(req.body);
    await client.query('BEGIN');
    const found = await client.query(`SELECT qi.*, q.user_id, q.status FROM store.quote_items qi JOIN store.quotes q ON q.id = qi.quote_id WHERE qi.id = $1`, [id]);
    const row = found.rows[0];
    if (!row || row.user_id !== req.user!.sub || row.status !== 'draft') { await client.query('ROLLBACK'); res.status(404).json({ error: 'Draft cart item not found' }); return; }
    const totals = calculateLineTotals({ quantity, unitPriceCents: Number(row.unit_price_cents), discountPercent: row.discount_percent, taxRate: row.tax_rate });
    await client.query(`UPDATE store.quote_items SET quantity = $2, line_subtotal_cents = $3, line_discount_cents = $4, line_tax_cents = $5, line_total_cents = $6 WHERE id = $1`, [id, quantity, totals.line_subtotal_cents, totals.line_discount_cents, totals.line_tax_cents, totals.line_total_cents]);
    await recalculateQuote(row.quote_id, client);
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'cart_item_updated', entityType: 'quote_item', entityId: id, payload: { quote_id: row.quote_id, quantity } }, client);
    await client.query('COMMIT'); res.json(await fetchQuoteWithItems(row.quote_id));
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

cartRouter.delete('/items/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id); await client.query('BEGIN');
    const found = await client.query(`SELECT qi.quote_id, q.user_id, q.status FROM store.quote_items qi JOIN store.quotes q ON q.id = qi.quote_id WHERE qi.id = $1`, [id]);
    const row = found.rows[0];
    if (!row || row.user_id !== req.user!.sub || row.status !== 'draft') { await client.query('ROLLBACK'); res.status(404).json({ error: 'Draft cart item not found' }); return; }
    await client.query('DELETE FROM store.quote_items WHERE id = $1', [id]);
    await recalculateQuote(row.quote_id, client);
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'cart_item_removed', entityType: 'quote_item', entityId: id, payload: { quote_id: row.quote_id } }, client);
    await client.query('COMMIT'); res.json(await fetchQuoteWithItems(row.quote_id));
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

cartRouter.post('/submit', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const quote = await getOrCreateDraftQuote(req.user!.sub, client);
    const count = await client.query('SELECT COUNT(*)::int AS count FROM store.quote_items WHERE quote_id = $1', [quote.id]);
    if (count.rows[0].count < 1) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Cannot submit an empty cart' }); return; }
    const updated = await client.query(`UPDATE store.quotes SET status = 'submitted', quote_number = $2, submitted_at = now(), updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING *`, [quote.id, generateQuoteNumber()]);
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'quote_submitted', entityType: 'quote', entityId: quote.id, payload: { quote_number: updated.rows[0].quote_number, item_count: count.rows[0].count } }, client);
    await client.query('COMMIT'); res.json(await fetchQuoteWithItems(quote.id));
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});
