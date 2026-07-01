import { writeAuditLog as defaultWriteAuditLog } from '../shared/audit.js';

export const orderStatuses = ['pending', 'processing', 'completed', 'cancelled'] as const;
export type OrderStatus = typeof orderStatuses[number];

type QueryResult<T = any> = { rows: T[] };
export type Queryable = { query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>> };

export type Order = {
  id: string;
  quote_id: string;
  user_id: string;
  order_number: string;
  status: OrderStatus;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  customer_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  source_quote_item_id: string | null;
  item_type: 'product' | 'saas_plan' | 'custom';
  product_id: string | null;
  saas_plan_id: string | null;
  description: string;
  quantity: number;
  unit_price_cents: number | null;
  discount_percent: string | number;
  tax_rate: string | number;
  line_subtotal_cents: number;
  line_discount_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
};

export type CreateOrderFromAcceptedQuoteInput = {
  client: Queryable;
  quoteId: string;
  actorUserId: string;
  writeAuditLog?: typeof defaultWriteAuditLog;
};

const orderColumns = `id, quote_id, user_id, order_number, status, subtotal_cents, discount_cents, tax_cents, total_cents, customer_notes, created_at, updated_at`;
export const publicOrderColumns = `o.id, o.quote_id, o.user_id, o.order_number, o.status, o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents, o.customer_notes, o.created_at, o.updated_at`;
export const orderItemColumns = `id, order_id, source_quote_item_id, item_type, product_id, saas_plan_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents`;

export const createOrderFromAcceptedQuote = async ({ client, quoteId, actorUserId, writeAuditLog = defaultWriteAuditLog }: CreateOrderFromAcceptedQuoteInput): Promise<{ order: Order; items: OrderItem[]; created: boolean }> => {
  const quoteResult = await client.query<{
    id: string; user_id: string; quote_number: string; status: string; subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; notes: string | null;
  }>(`SELECT id, user_id, quote_number, status, subtotal_cents, discount_cents, tax_cents, total_cents, notes FROM store.quotes WHERE id = $1 FOR UPDATE`, [quoteId]);
  const quote = quoteResult.rows[0];
  if (!quote) throw new Error(`Quote ${quoteId} not found while creating order`);
  if (quote.status !== 'accepted') throw new Error(`Quote ${quoteId} must be accepted before creating an order`);

  const inserted = await client.query<Order>(
    `INSERT INTO store.orders (quote_id, user_id, order_number, subtotal_cents, discount_cents, tax_cents, total_cents, customer_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (quote_id) DO NOTHING
     RETURNING ${orderColumns}`,
    [quote.id, quote.user_id, `ORD-${quote.quote_number}`, quote.subtotal_cents, quote.discount_cents, quote.tax_cents, quote.total_cents, quote.notes]
  );

  let order = inserted.rows[0];
  const created = Boolean(order);
  if (!order) {
    const existing = await client.query<Order>(`SELECT ${orderColumns} FROM store.orders WHERE quote_id = $1`, [quote.id]);
    order = existing.rows[0];
    if (!order) throw new Error(`Order for quote ${quoteId} was not created and could not be loaded`);
  }

  if (created) {
    await client.query<OrderItem>(
      `INSERT INTO store.order_items (order_id, source_quote_item_id, item_type, product_id, saas_plan_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents)
       SELECT $1, id, item_type, product_id, saas_plan_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents
       FROM store.quote_items
       WHERE quote_id = $2`,
      [order.id, quote.id]
    );
    await writeAuditLog({
      actorUserId,
      action: 'order_created',
      entityType: 'order',
      entityId: order.id,
      payload: { quote_id: quote.id, quote_number: quote.quote_number, order_number: order.order_number, status: order.status, total_cents: order.total_cents }
    }, client);
  }

  const items = await client.query<OrderItem>(`SELECT ${orderItemColumns} FROM store.order_items WHERE order_id = $1 ORDER BY description ASC`, [order.id]);
  return { order, items: items.rows, created };
};
