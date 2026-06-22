import { pool } from '../../db/pool.js';

export type UserRole = 'customer' | 'distributor' | 'admin';
export type CartItemType = 'product' | 'saas_plan';

export const toBasisPoints = (value: string | number | null | undefined): number => Math.round(Number(value ?? 0) * 100);
export const calculatePercentCents = (amountCents: number, percent: string | number): number => Math.round((amountCents * toBasisPoints(percent)) / 10000);

export const calculateLineTotals = (input: { quantity: number; unitPriceCents: number; discountPercent: string | number; taxRate: string | number }) => {
  const lineSubtotalCents = input.quantity * input.unitPriceCents;
  const lineDiscountCents = calculatePercentCents(lineSubtotalCents, input.discountPercent);
  const taxableCents = lineSubtotalCents - lineDiscountCents;
  const lineTaxCents = calculatePercentCents(taxableCents, input.taxRate);
  return {
    line_subtotal_cents: lineSubtotalCents,
    line_discount_cents: lineDiscountCents,
    line_tax_cents: lineTaxCents,
    line_total_cents: taxableCents + lineTaxCents
  };
};

export const calculateQuoteTotals = (items: Array<{ line_subtotal_cents: number; line_discount_cents: number; line_tax_cents: number; line_total_cents: number }>) => ({
  subtotal_cents: items.reduce((sum, item) => sum + Number(item.line_subtotal_cents), 0),
  discount_cents: items.reduce((sum, item) => sum + Number(item.line_discount_cents), 0),
  tax_cents: items.reduce((sum, item) => sum + Number(item.line_tax_cents), 0),
  total_cents: items.reduce((sum, item) => sum + Number(item.line_total_cents), 0)
});

export const getDistributorDiscountPercent = async (userId: string, role: UserRole, client: any = pool): Promise<string> => {
  if (role !== 'distributor') return '0';
  const { rows } = await client.query('SELECT validation_status, discount_percent FROM store.distributor_profiles WHERE user_id = $1', [userId]);
  return rows[0]?.validation_status === 'approved' ? String(rows[0].discount_percent ?? '0') : '0';
};

export const generateQuoteNumber = (): string => `Q-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
export const generateDraftQuoteNumber = (userId: string): string => `DRAFT-${userId}-${Date.now()}`;

export const getOrCreateDraftQuote = async (userId: string, client: any = pool) => {
  const existing = await client.query('SELECT * FROM store.quotes WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1', [userId, 'draft']);
  if (existing.rows[0]) return existing.rows[0];
  const created = await client.query('INSERT INTO store.quotes (user_id, quote_number, status) VALUES ($1, $2, $3) RETURNING *', [userId, generateDraftQuoteNumber(userId), 'draft']);
  return created.rows[0];
};

export const recalculateQuote = async (quoteId: string, client: any) => {
  const { rows: items } = await client.query('SELECT line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1', [quoteId]);
  const totals = calculateQuoteTotals(items);
  const { rows } = await client.query(`UPDATE store.quotes SET subtotal_cents = $2, discount_cents = $3, tax_cents = $4, total_cents = $5, updated_at = now() WHERE id = $1 RETURNING *`, [quoteId, totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents]);
  return rows[0];
};

export const fetchQuoteWithItems = async (quoteId: string, client: any = pool) => {
  const quote = await client.query('SELECT id, user_id, quote_number, status, subtotal_cents, discount_cents, tax_cents, total_cents, notes, created_at, updated_at, submitted_at FROM store.quotes WHERE id = $1', [quoteId]);
  const items = await client.query(`SELECT id, quote_id, item_type, product_id, saas_plan_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1 ORDER BY description ASC`, [quoteId]);
  return { quote: quote.rows[0], items: items.rows };
};
