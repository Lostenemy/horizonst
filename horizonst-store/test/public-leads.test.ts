import assert from 'node:assert/strict';
import express from 'express';
import { ZodError } from 'zod';
import { createLeadsRouter, leadSchema } from '../src/modules/leads/leads.routes.js';

const request = async (app: express.Express, body: unknown) => {
  const server = app.listen(0);
  try { const address = server.address(); assert.ok(address && typeof address === 'object'); return await fetch(`http://127.0.0.1:${address.port}/api/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};

assert.equal(leadSchema.parse({ source: 'appcc_guide', email: 'ana@example.test', privacyAccepted: true }).source, 'appcc_guide');
assert.throws(() => leadSchema.parse({ source: 'appcc_guide', email: 'bad', privacyAccepted: true }));
assert.throws(() => leadSchema.parse({ source: 'appcc_guide', email: 'ana@example.test', privacyAccepted: false }));

const calls: any[] = []; const deliveries: string[] = [];
const pool = { async query(sql: string, params?: unknown[]) { calls.push({ sql, params }); return { rows: [{ id: 'lead-1', source: params?.[0], status: 'new', created_at: 'now' }] }; } };
const app = express(); app.use(express.json({ limit: '16kb' })); app.use('/api/leads', createLeadsRouter({ pool, sendGuideEmail: async (email) => { deliveries.push(email); } })); app.use((error: any, _req: any, res: any, _next: any) => { if (error instanceof ZodError) return res.status(400).json({ error: 'Validation error' }); return res.status(500).json({ error: 'Internal server error' }); });
const guide = await request(app, { source: 'appcc_guide', email: ' ANA@EXAMPLE.TEST ', privacyAccepted: true });
assert.equal(guide.status, 201); assert.equal(calls[0].params?.[1], ''); assert.equal(calls[0].params?.[3], 'ana@example.test'); assert.deepEqual(deliveries, ['ana@example.test']);
const noConsent = await request(app, { source: 'appcc_guide', email: 'other@example.test', privacyAccepted: false }); assert.equal(noConsent.status, 400);
assert.equal((await request(app, { source: 'appcc_guide', email: 'ana@example.test', privacyAccepted: true })).status, 201);
assert.equal((await request(app, { source: 'appcc_guide', email: 'ana@example.test', privacyAccepted: true })).status, 201);
assert.equal((await request(app, { source: 'appcc_guide', email: 'ana@example.test', privacyAccepted: true })).status, 429);
const failing = express(); failing.use(express.json()); failing.use('/api/leads', createLeadsRouter({ pool, sendGuideEmail: async () => { throw new Error('smtp unavailable'); } })); failing.use((_error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: 'Internal server error' }));
assert.equal((await request(failing, { source: 'appcc_guide', email: 'fail@example.test', privacyAccepted: true })).status, 503);
