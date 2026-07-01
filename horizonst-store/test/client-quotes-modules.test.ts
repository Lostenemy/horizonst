import assert from 'node:assert/strict';
import express from 'express';
import { ZodError } from 'zod';
import { quoteDecisionSchema, createQuotesRouter } from '../src/modules/quotes/quotes.routes.js';

const quoteId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const otherUserId = '33333333-3333-4333-8333-333333333333';
const now = '2026-07-01T00:00:00.000Z';

const baseQuote = (status = 'sent') => ({
  id: quoteId,
  user_id: userId,
  quote_number: 'Q-1',
  status,
  subtotal_cents: 1000,
  discount_cents: 0,
  tax_cents: 210,
  total_cents: 1210,
  notes: null,
  internal_notes: 'admin-only',
  created_at: now,
  updated_at: now,
  submitted_at: now,
  accepted_at: null,
  rejected_at: null
});

type QueryCall = { sql: string; params?: unknown[]; client?: boolean };

const makeDecisionHarness = (options: { role?: 'customer' | 'distributor' | 'admin'; existing?: any; updateError?: Error } = {}) => {
  const calls: QueryCall[] = [];
  const historyCalls: any[] = [];
  const auditCalls: any[] = [];
  let released = false;
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params, client: true });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: options.existing === undefined ? [baseQuote()] : options.existing ? [options.existing] : [] };
      if (sql.startsWith('UPDATE')) {
        if (options.updateError) throw options.updateError;
        const status = params?.[1] as string;
        return { rows: [{ ...baseQuote(status), status, accepted_at: status === 'accepted' ? now : null, rejected_at: status === 'rejected' ? now : null }] };
      }
      return { rows: [] };
    },
    release() { released = true; }
  };
  const pool = { query: async () => ({ rows: [] }), connect: async () => client };
  const app = express();
  app.use(express.json());
  app.use('/api/quotes', createQuotesRouter({
    pool,
    authMiddleware: (req, _res, next) => { req.user = { sub: userId, role: options.role ?? 'customer', status: 'active', email: 'u@example.com' } as any; next(); },
    roleMiddleware: (req, res, next) => (req.user?.role === 'customer' || req.user?.role === 'distributor') ? next() : res.status(403).json({ error: 'Forbidden' }),
    insertQuoteStatusHistory: async (input, queryClient) => { historyCalls.push({ input, sameClient: queryClient === client }); },
    writeAuditLog: async (input, queryClient) => { auditCalls.push({ input, sameClient: queryClient === client }); },
    generateQuotePdf: async () => Buffer.from('%PDF-test')
  } as any));
  app.use((error: any, _req: any, res: any, _next: any) => {
    if (error instanceof ZodError) { res.status(400).json({ error: 'Validation error' }); return; }
    res.status(500).json({ error: 'Internal server error' });
  });
  return { app, calls, historyCalls, auditCalls, get released() { return released; } };
};

const request = async (app: express.Express, path: string, init: RequestInit = {}) => {
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, ...init });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const json = async (response: Response) => response.json() as Promise<any>;

assert.deepEqual(quoteDecisionSchema.parse({}), {});
assert.deepEqual(quoteDecisionSchema.parse({ comment: '  Acepto la propuesta  ' }), { comment: 'Acepto la propuesta' });
assert.throws(() => quoteDecisionSchema.parse({ comment: 42 }));
assert.throws(() => quoteDecisionSchema.parse({ comment: 'x'.repeat(5001) }));
assert.throws(() => quoteDecisionSchema.parse({ comment: 'ok', unknown: true }));

{
  const h = makeDecisionHarness({ role: 'customer' });
  const response = await request(h.app, `/api/quotes/${quoteId}/accept`, { method: 'POST', body: JSON.stringify({ comment: ' ok ' }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.quote.status, 'accepted');
  assert.equal(body.quote.accepted_at, now);
  assert.equal(body.quote.rejected_at, null);
  assert.equal(h.historyCalls.length, 1, 'valid accept creates exactly one history entry');
  assert.equal(h.historyCalls[0].sameClient, true);
  assert.equal(h.auditCalls.length, 1);
  assert.equal(h.auditCalls[0].sameClient, true);
  assert.equal(h.auditCalls[0].input.action, 'quote_accepted');
  assert.deepEqual(h.auditCalls[0].input.payload, { previous_status: 'sent', status: 'accepted', comment: 'ok' });
  assert.deepEqual(h.calls.map((call) => call.sql === 'BEGIN' || call.sql === 'COMMIT' ? call.sql : call.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
  assert.ok(h.calls[1].sql.includes('FOR UPDATE'));
  assert.deepEqual(h.calls[1].params, [quoteId, userId]);
  assert.equal(h.released, true);
}

{
  const h = makeDecisionHarness({ role: 'customer' });
  const response = await request(h.app, `/api/quotes/${quoteId}/reject`, { method: 'POST', body: JSON.stringify({ comment: 'No encaja' }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.quote.status, 'rejected');
  assert.equal(body.quote.accepted_at, null);
  assert.equal(body.quote.rejected_at, now);
  assert.equal(h.historyCalls.length, 1);
  assert.equal(h.auditCalls[0].input.action, 'quote_rejected');
}

{
  const h = makeDecisionHarness({ role: 'distributor' });
  const response = await request(h.app, `/api/quotes/${quoteId}/accept`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 200, 'distributor can accept own sent quote');
}

{
  const h = makeDecisionHarness({ role: 'admin' });
  const response = await request(h.app, `/api/quotes/${quoteId}/accept`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 403, 'admin is rejected by customer/distributor endpoints');
  assert.equal(h.historyCalls.length, 0);
}

for (const existing of [false, null]) {
  const h = makeDecisionHarness({ existing });
  const response = await request(h.app, `/api/quotes/${quoteId}/accept`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 404, 'missing or foreign quote returns 404');
  assert.equal(h.historyCalls.length, 0);
  assert.equal(h.auditCalls.length, 0);
  assert.ok(h.calls.some((call) => call.sql === 'ROLLBACK'));
}

for (const status of ['draft', 'accepted', 'rejected']) {
  const h = makeDecisionHarness({ existing: baseQuote(status) });
  const response = await request(h.app, `/api/quotes/${quoteId}/accept`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 409, `${status} quote returns 409`);
  assert.equal(h.historyCalls.length, 0, 'invalid operation must not create history');
  assert.equal(h.auditCalls.length, 0);
}

{
  const h = makeDecisionHarness({ updateError: new Error('boom') });
  const response = await request(h.app, `/api/quotes/${quoteId}/accept`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 500);
  assert.ok(h.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(h.released, true);
}

for (const body of [{ comment: 42 }, { comment: 'ok', extra: true }]) {
  const h = makeDecisionHarness();
  const response = await request(h.app, `/api/quotes/${quoteId}/accept`, { method: 'POST', body: JSON.stringify(body) });
  assert.equal(response.status, 400);
  assert.equal(h.historyCalls.length, 0);
}

{
  const calls: QueryCall[] = [];
  const pool = {
    connect: async () => { throw new Error('not used'); },
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('FROM store.quotes q') && sql.includes('ORDER BY q.created_at DESC')) return { rows: [baseQuote(), { ...baseQuote(), id: otherUserId }] };
      if (sql.includes('WHERE q.id = $1 AND q.user_id = $2')) return { rows: [baseQuote()] };
      if (sql.includes('FROM store.quote_items')) return { rows: [] };
      if (sql.includes('FROM store.quote_status_history')) return { rows: [] };
      return { rows: [] };
    }
  };
  const app = express();
  app.use('/api/quotes', createQuotesRouter({
    pool: pool as any,
    authMiddleware: (req, _res, next) => { req.user = { sub: userId, role: 'customer', status: 'active' } as any; next(); },
    roleMiddleware: (_req, _res, next) => next()
  }));
  const listResponse = await request(app, '/api/quotes');
  assert.equal(listResponse.status, 200);
  assert.deepEqual(calls[0].params, [userId], 'GET list is scoped to owner');
  const detailResponse = await request(app, `/api/quotes/${quoteId}`);
  assert.equal(detailResponse.status, 200);
  const detail = await json(detailResponse);
  assert.equal(detail.quote.internal_notes, undefined, 'detail must not expose internal_notes');
}

{
  const calls: QueryCall[] = [];
  const pool = {
    connect: async () => { throw new Error('not used'); },
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: [] };
    }
  };
  const app = express();
  app.use('/api/quotes', createQuotesRouter({
    pool: pool as any,
    authMiddleware: (req, _res, next) => { req.user = { sub: userId, role: 'customer', status: 'active' } as any; next(); },
    roleMiddleware: (_req, _res, next) => next(),
    generateQuotePdf: async () => Buffer.from('%PDF-test')
  }));
  const response = await request(app, `/api/quotes/${quoteId}/pdf`);
  assert.equal(response.status, 404, 'foreign PDF returns 404');
  assert.deepEqual(calls[0].params, [quoteId, userId]);
  assert.ok(calls[0].sql.includes('COALESCE(cp.company_name, dp.company_name) AS company_name'));
  assert.ok(calls[0].sql.includes('LEFT JOIN store.distributor_profiles dp ON dp.user_id = u.id'));
}
