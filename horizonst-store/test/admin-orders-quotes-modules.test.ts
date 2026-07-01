import assert from 'node:assert/strict';
import express from 'express';
import { ZodError } from 'zod';
import { createAdminQuotesRouter } from '../src/modules/admin/quotes.routes.js';
import { createAdminOrdersRouter } from '../src/modules/admin/orders.routes.js';

const quoteId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const adminId = '99999999-9999-4999-8999-999999999999';
const orderId = '44444444-4444-4444-8444-444444444444';
const now = '2026-07-01T00:00:00.000Z';

const quote = (status = 'sent') => ({ id: quoteId, user_id: userId, quote_number: 'Q-1', status, subtotal_cents: 1000, discount_cents: 0, tax_cents: 210, total_cents: 1210, accepted_at: status === 'accepted' ? now : null, rejected_at: status === 'rejected' ? now : null, created_at: now, updated_at: now, email: 'u@example.com', full_name: 'User Test' });
const order = { id: orderId, quote_id: quoteId, user_id: userId, order_number: 'ORD-Q-1', status: 'pending', subtotal_cents: 1000, discount_cents: 0, tax_cents: 210, total_cents: 1210, customer_notes: 'nota', created_at: now, updated_at: now, quote_number: 'Q-1', email: 'u@example.com', full_name: 'User Test', role: 'customer' };
const item = { id: '55555555-5555-4555-8555-555555555555', order_id: orderId, source_quote_item_id: null, item_type: 'custom', product_id: null, saas_plan_id: null, description: 'Custom', quantity: 1, unit_price_cents: 1000, discount_percent: '0.00', tax_rate: '21.00', line_subtotal_cents: 1000, line_discount_cents: 0, line_tax_cents: 210, line_total_cents: 1210 };

const request = async (app: express.Express, path: string, init: RequestInit = {}) => {
  const server = app.listen(0);
  try { const address = server.address(); assert.ok(address && typeof address === 'object'); return await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, ...init }); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};
const json = async (response: Response) => response.json() as Promise<any>;

const errorHandler = (error: any, _req: any, res: any, _next: any) => { if (error instanceof ZodError) { res.status(400).json({ error: 'Validation error' }); return; } res.status(500).json({ error: 'Internal server error' }); };

const makeAdminQuoteHarness = (options: { existing?: any; orderError?: Error; mailError?: Error } = {}) => {
  const calls: any[] = []; const historyCalls: any[] = []; const orderCalls: any[] = []; const quoteAvailableEmails: any[] = []; const orderConfirmationEmails: any[] = []; let released = false;
  const client = { async query(sql: string, params?: unknown[]) { calls.push({ sql, params, client: true }); if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }; if (sql.includes('FOR UPDATE')) return { rows: [options.existing ?? quote('sent')] }; if (sql.startsWith('UPDATE')) return { rows: [{ ...quote(params?.[1] as string), status: params?.[1] }] }; return { rows: [] }; }, release() { released = true; } };
  const pool = { query: async () => ({ rows: [] }), connect: async () => client };
  const app = express(); app.use(express.json());
  app.use('/api/admin', createAdminQuotesRouter({ pool, authMiddleware: (req, _res, next) => { req.user = { sub: adminId, role: 'admin', status: 'active' } as any; next(); }, roleMiddleware: (_req, _res, next) => next(), insertQuoteStatusHistory: async (input, queryClient) => { historyCalls.push({ input, sameClient: queryClient === client }); }, generateQuotePdf: async () => Buffer.from('%PDF-test'), createOrderFromAcceptedQuote: async (input) => { orderCalls.push({ input, sameClient: input.client === client, callIndex: calls.length }); if (options.orderError) throw options.orderError; return { order, items: [], created: true }; }, sendQuoteAvailableEmail: async (input) => { quoteAvailableEmails.push({ input, callIndex: calls.length }); if (options.mailError) throw options.mailError; }, sendOrderConfirmationEmail: async (input) => { orderConfirmationEmails.push({ input, callIndex: calls.length }); if (options.mailError) throw options.mailError; } } as any));
  app.use(errorHandler);
  return { app, calls, historyCalls, orderCalls, quoteAvailableEmails, orderConfirmationEmails, get released() { return released; } };
};

{
  const h = makeAdminQuoteHarness();
  const response = await request(h.app, `/api/admin/quotes/${quoteId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted', comment: 'ok' }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.quote.status, 'accepted');
  assert.equal(body.quote.accepted_at, now);
  assert.equal(body.quote.rejected_at, null);
  assert.equal(body.order.order_number, 'ORD-Q-1');
  assert.equal(h.historyCalls.length, 1);
  assert.equal(h.historyCalls[0].sameClient, true);
  assert.equal(h.orderCalls.length, 1);
  assert.equal(h.orderCalls[0].sameClient, true);
  assert.equal(h.orderConfirmationEmails.length, 1);
  assert.equal(h.orderConfirmationEmails[0].input.quote.email, 'u@example.com');
  assert.equal(h.orderConfirmationEmails[0].callIndex, h.calls.findIndex((call) => call.sql === 'COMMIT') + 1, 'order email is scheduled after commit');
  assert.equal(h.quoteAvailableEmails.length, 0);
  assert.ok(h.calls.find((call) => call.sql.startsWith('UPDATE')));
  assert.ok(h.calls.findIndex((call) => call.sql === 'COMMIT') >= h.orderCalls[0].callIndex, 'commit happens after order creation hook');
  assert.equal(h.calls.some((call) => call.sql === 'ROLLBACK'), false);
  assert.equal(h.released, true);
}

{
  const h = makeAdminQuoteHarness();
  const response = await request(h.app, `/api/admin/quotes/${quoteId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', comment: 'no' }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.quote.status, 'rejected');
  assert.equal(body.quote.accepted_at, null);
  assert.equal(body.quote.rejected_at, now);
  assert.equal(body.order, undefined);
  assert.equal(h.orderCalls.length, 0, 'admin rejection must not create order');
  assert.equal(h.quoteAvailableEmails.length, 0, 'admin rejection must not send quote email');
  assert.equal(h.orderConfirmationEmails.length, 0, 'admin rejection must not send order email');
  assert.equal(h.historyCalls.length, 1);
  assert.equal(h.calls.some((call) => call.sql === 'COMMIT'), true);
}

{
  const h = makeAdminQuoteHarness({ existing: quote('in_review') });
  const response = await request(h.app, `/api/admin/quotes/${quoteId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', comment: 'enviado' }) });
  assert.equal(response.status, 200);
  assert.equal(h.quoteAvailableEmails.length, 1);
  assert.equal(h.quoteAvailableEmails[0].input.quote.quote_number, 'Q-1');
  assert.ok(h.calls.findIndex((call) => call.sql === 'COMMIT') < h.quoteAvailableEmails[0].callIndex, 'quote email is scheduled after commit');
  assert.equal(h.orderConfirmationEmails.length, 0);
}

{
  const h = makeAdminQuoteHarness({ mailError: new Error('smtp boom') });
  const response = await request(h.app, `/api/admin/quotes/${quoteId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) });
  assert.equal(response.status, 200, 'post-commit mail failure must not fail admin acceptance');
  assert.equal(h.calls.some((call) => call.sql === 'ROLLBACK'), false);
  assert.equal(h.orderConfirmationEmails.length, 1);
}

{
  const h = makeAdminQuoteHarness({ orderError: new Error('order boom') });
  const response = await request(h.app, `/api/admin/quotes/${quoteId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) });
  assert.equal(response.status, 500);
  assert.ok(h.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(h.calls.some((call) => call.sql === 'COMMIT'), false);
  assert.equal(h.orderCalls.length, 1);
  assert.equal(h.released, true);
  assert.equal((await json(response)).order, undefined);
}

{
  const calls: any[] = [];
  const pool = { async query(sql: string, params?: unknown[]) { calls.push({ sql, params }); if (sql.includes('ORDER BY o.created_at DESC')) return { rows: [order] }; if (sql.includes('WHERE o.id = $1')) return { rows: [order] }; if (sql.includes('FROM store.order_items')) return { rows: [item] }; return { rows: [] }; } };
  const app = express(); app.use('/api/admin', createAdminOrdersRouter({ pool, authMiddleware: (req, _res, next) => { req.user = { sub: adminId, role: 'admin', status: 'active' } as any; next(); }, roleMiddleware: (_req, _res, next) => next() })); app.use(errorHandler);
  assert.equal((await request(app, '/api/admin/orders?status=pending&email=u@example.com&order_number=ORD&quote_number=Q')).status, 200);
  assert.deepEqual(calls[0].params, ['pending', '%u@example.com%', '%ORD%', '%Q%']);
  const detail = await request(app, `/api/admin/orders/${orderId}`);
  assert.equal(detail.status, 200);
  assert.equal((await json(detail)).order.email, 'u@example.com');
}

{
  const pool = { async query() { return { rows: [] }; } };
  const app = express(); app.use('/api/admin', createAdminOrdersRouter({ pool, authMiddleware: (req, _res, next) => { req.user = { sub: adminId, role: 'admin', status: 'active' } as any; next(); }, roleMiddleware: (_req, _res, next) => next() })); app.use(errorHandler);
  assert.equal((await request(app, '/api/admin/orders?status=paid')).status, 400);
  assert.equal((await request(app, `/api/admin/orders/${orderId}`)).status, 404);
  assert.equal((await request(app, '/api/admin/orders/not-a-uuid')).status, 400);
}

{
  const app = express(); app.use('/api/admin', createAdminOrdersRouter({ pool: { query: async () => ({ rows: [] }) }, authMiddleware: (req, _res, next) => { req.user = { sub: userId, role: 'customer', status: 'active' } as any; next(); }, roleMiddleware: (_req, res) => res.status(403).json({ error: 'Forbidden' }) })); app.use(errorHandler);
  assert.equal((await request(app, '/api/admin/orders')).status, 403);
}
