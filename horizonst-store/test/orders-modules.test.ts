import assert from 'node:assert/strict';
import express from 'express';
import { ZodError } from 'zod';
import { createOrdersRouter } from '../src/modules/orders/orders.routes.js';
import { createOrderFromAcceptedQuote } from '../src/modules/orders/order.service.js';

const userId = '22222222-2222-4222-8222-222222222222';
const otherUserId = '33333333-3333-4333-8333-333333333333';
const orderId = '44444444-4444-4444-8444-444444444444';
const quoteId = '11111111-1111-4111-8111-111111111111';
const itemId = '55555555-5555-4555-8555-555555555555';

const request = async (app: express.Express, path: string) => {
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return await fetch(`http://127.0.0.1:${address.port}${path}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const order = { id: orderId, quote_id: quoteId, user_id: userId, order_number: 'ORD-Q-1', status: 'pending', subtotal_cents: 1000, discount_cents: 100, tax_cents: 189, total_cents: 1089, customer_notes: 'nota', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', quote_number: 'Q-1' };
const item = { id: itemId, order_id: orderId, source_quote_item_id: '66666666-6666-4666-8666-666666666666', item_type: 'product', product_id: '77777777-7777-4777-8777-777777777777', saas_plan_id: null, description: 'Sensor', quantity: 2, unit_price_cents: 500, discount_percent: '10.00', tax_rate: '21.00', line_subtotal_cents: 1000, line_discount_cents: 100, line_tax_cents: 189, line_total_cents: 1089 };

{
  const calls: any[] = [];
  const pool = { async query(sql: string, params?: unknown[]) { calls.push({ sql, params }); if (sql.includes('ORDER BY o.created_at DESC')) return { rows: [order] }; if (sql.includes('WHERE o.id = $1 AND o.user_id = $2')) return { rows: [order] }; if (sql.includes('FROM store.order_items')) return { rows: [item] }; return { rows: [] }; } };
  const app = express();
  app.use('/api/orders', createOrdersRouter({ pool, authMiddleware: (req, _res, next) => { req.user = { sub: userId, role: 'customer', status: 'active' } as any; next(); }, roleMiddleware: (_req, _res, next) => next() }));
  app.use((error: any, _req: any, res: any, _next: any) => { if (error instanceof ZodError) { res.status(400).json({ error: 'Validation error' }); return; } res.status(500).json({ error: 'Internal server error' }); });
  const list = await request(app, '/api/orders');
  assert.equal(list.status, 200);
  assert.deepEqual(calls[0].params, [userId], 'list is scoped to authenticated user');
  assert.equal((await list.json() as any).orders[0].order_number, 'ORD-Q-1');
  assert.equal((await request(app, '/api/orders')).status, 200, 'list endpoint tolerates repeated safe reads');
  const detail = await request(app, `/api/orders/${orderId}`);
  assert.equal(detail.status, 200);
  const body = await detail.json() as any;
  assert.equal(body.items[0].source_quote_item_id, item.source_quote_item_id);
  assert.equal(body.order.customer_notes, 'nota');
  assert.equal(body.order.internal_notes, undefined, 'customer detail must not expose internal fields');
  assert.ok(calls.some((call) => JSON.stringify(call.params) === JSON.stringify([orderId, userId])), 'detail is scoped to owner');
}

{
  const pool = { async query(sql: string, params?: unknown[]) { if (sql.includes('ORDER BY o.created_at DESC')) return { rows: [] }; return { rows: [] }; } };
  const app = express();
  app.use('/api/orders', createOrdersRouter({ pool, authMiddleware: (req, _res, next) => { req.user = { sub: userId, role: 'customer', status: 'active' } as any; next(); }, roleMiddleware: (_req, _res, next) => next() }));
  const response = await request(app, '/api/orders');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as any).orders, [], 'empty customer list returns empty collection');
}

{
  const pool = { async query(sql: string) { if (sql.includes('WHERE o.id = $1 AND o.user_id = $2')) return { rows: [] }; return { rows: [] }; } };
  const app = express();
  app.use('/api/orders', createOrdersRouter({ pool, authMiddleware: (req, _res, next) => { req.user = { sub: otherUserId, role: 'customer', status: 'active' } as any; next(); }, roleMiddleware: (_req, _res, next) => next() }));
  app.use((error: any, _req: any, res: any, _next: any) => { if (error instanceof ZodError) { res.status(400).json({ error: 'Validation error' }); return; } res.status(500).json({ error: 'Internal server error' }); });
  assert.equal((await request(app, `/api/orders/${orderId}`)).status, 404, 'foreign order returns 404');
  assert.equal((await request(app, '/api/orders/not-a-uuid')).status, 400, 'invalid UUID returns 400');
}

{
  const calls: any[] = [];
  const auditCalls: any[] = [];
  const client = { async query(sql: string, params?: unknown[]) { calls.push({ sql, params }); if (sql.includes('FROM store.quotes')) return { rows: [{ id: quoteId, user_id: userId, quote_number: 'Q-1', status: 'accepted', subtotal_cents: 1000, discount_cents: 100, tax_cents: 189, total_cents: 1089, notes: 'nota' }] }; if (sql.startsWith('INSERT INTO store.orders')) return { rows: [{ ...order, quote_number: undefined }] }; if (sql.startsWith('INSERT INTO store.order_items')) return { rows: [] }; if (sql.includes('FROM store.order_items')) return { rows: [item] }; return { rows: [] }; } };
  const result = await createOrderFromAcceptedQuote({ client, quoteId, actorUserId: userId, writeAuditLog: async (input, queryClient) => { auditCalls.push({ input, sameClient: queryClient === client }); } });
  assert.equal(result.order.order_number, 'ORD-Q-1');
  assert.equal(result.items[0].source_quote_item_id, item.source_quote_item_id);
  assert.ok(calls[0].sql.includes('FOR UPDATE'));
  assert.ok(calls[2].sql.includes('SELECT $1, id, item_type'), 'items are copied from quote_items without recalculation');
  assert.equal(auditCalls[0].input.action, 'order_created');
  assert.equal(auditCalls[0].sameClient, true);
  assert.deepEqual(auditCalls[0].input.payload, { quote_id: quoteId, quote_number: 'Q-1', order_number: 'ORD-Q-1', status: 'pending', total_cents: 1089 });
}

for (const failure of ['items', 'audit'] as const) {
  const client = { async query(sql: string) { if (sql.includes('FROM store.quotes')) return { rows: [{ id: quoteId, user_id: userId, quote_number: 'Q-1', status: 'accepted', subtotal_cents: 1000, discount_cents: 100, tax_cents: 189, total_cents: 1089, notes: 'nota' }] }; if (sql.startsWith('INSERT INTO store.orders')) return { rows: [{ ...order, quote_number: undefined }] }; if (sql.startsWith('INSERT INTO store.order_items')) { if (failure === 'items') throw new Error('items boom'); return { rows: [] }; } if (sql.includes('FROM store.order_items')) return { rows: [item] }; return { rows: [] }; } };
  await assert.rejects(() => createOrderFromAcceptedQuote({ client, quoteId, actorUserId: userId, writeAuditLog: async () => { if (failure === 'audit') throw new Error('audit boom'); } }), new RegExp(`${failure} boom`));
}

{
  const calls: any[] = [];
  const auditCalls: any[] = [];
  const client = { async query(sql: string, params?: unknown[]) { calls.push({ sql, params }); if (sql.includes('FROM store.quotes')) return { rows: [{ id: quoteId, user_id: userId, quote_number: 'Q-1', status: 'accepted', subtotal_cents: 1000, discount_cents: 100, tax_cents: 189, total_cents: 1089, notes: 'nota' }] }; if (sql.startsWith('INSERT INTO store.orders')) return { rows: [] }; if (sql.includes('FROM store.orders WHERE quote_id')) return { rows: [{ ...order, quote_number: undefined }] }; if (sql.includes('FROM store.order_items')) return { rows: [item] }; return { rows: [] }; } };
  const result = await createOrderFromAcceptedQuote({ client, quoteId, actorUserId: userId, writeAuditLog: async (input) => { auditCalls.push(input); } });
  assert.equal(result.created, false);
  assert.equal(result.order.order_number, 'ORD-Q-1');
  assert.equal(result.items.length, 1);
  assert.equal(calls.some((call) => call.sql.startsWith('INSERT INTO store.order_items')), false, 'existing order does not copy lines again');
  assert.equal(auditCalls.length, 0, 'existing order does not audit again');
}
