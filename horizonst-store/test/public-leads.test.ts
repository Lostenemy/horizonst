import assert from 'node:assert/strict';
import express from 'express';
import { ZodError } from 'zod';
import { createLeadsRouter, leadSchema } from '../src/modules/leads/leads.routes.js';

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

assert.equal(leadSchema.parse({ source: 'demo', fullName: 'Ana', email: 'ana@example.test' }).source, 'demo');
assert.equal(leadSchema.parse({ source: 'appcc_guide', fullName: 'Ana', companyName: 'Frío Norte', email: 'ana@example.test', phone: '600000000' }).source, 'appcc_guide');
assert.throws(() => leadSchema.parse({ source: 'landing', fullName: 'Ana', email: 'ana@example.test' }));
assert.throws(() => leadSchema.parse({ source: 'demo', fullName: 'A', email: 'bad' }));
assert.throws(() => leadSchema.parse({ source: 'appcc_guide', fullName: 'Ana', email: 'ana@example.test' }));

{
  const calls: any[] = [];
  const pool = { async query(sql: string, params?: unknown[]) { calls.push({ sql, params }); return { rows: [{ id: 'lead-1', source: params?.[0], status: 'new', created_at: 'now' }] }; } };
  const app = express();
  app.use(express.json());
  app.use('/api/leads', createLeadsRouter({ pool }));
  app.use((error: any, _req: any, res: any, _next: any) => { if (error instanceof ZodError) { res.status(400).json({ error: 'Validation error' }); return; } res.status(500).json({ error: 'Internal server error' }); });

  const demo = await request(app, '/api/leads', { method: 'POST', body: JSON.stringify({ source: 'demo', fullName: 'Ana Demo', companyName: 'Restaurante Norte', email: 'ana@example.test', phone: '600000000', message: 'Quiero una demo' }) });
  assert.equal(demo.status, 201, 'LP-02 creates demo lead');
  assert.deepEqual(calls[0].params?.slice(0, 4), ['demo', 'Ana Demo', 'Restaurante Norte', 'ana@example.test']);

  const guide = await request(app, '/api/leads', { method: 'POST', body: JSON.stringify({ source: 'appcc_guide', fullName: 'Luis Guía', companyName: 'Cámaras Sur', email: 'luis@example.test', phone: '611111111' }) });
  assert.equal(guide.status, 201, 'LP-03 creates APPCC guide lead');
  assert.equal(calls[1].params?.[0], 'appcc_guide');
}

{
  const pool = { async query() { throw new Error('must not insert invalid leads'); } };
  const app = express();
  app.use(express.json());
  app.use('/api/leads', createLeadsRouter({ pool }));
  app.use((error: any, _req: any, res: any, _next: any) => { if (error instanceof ZodError) { res.status(400).json({ error: 'Validation error' }); return; } res.status(500).json({ error: 'Internal server error' }); });
  const response = await request(app, '/api/leads', { method: 'POST', body: JSON.stringify({ source: 'contact_form', fullName: 'Ana', email: 'ana@example.test' }) });
  assert.equal(response.status, 400);
}
