import assert from 'node:assert/strict';
import express from 'express';
import { ZodError } from 'zod';
import { createAdminPrereservationsRouter } from '../src/modules/admin/prereservations.routes.js';
import { readFile } from 'node:fs/promises';

const id = '11111111-1111-4111-8111-111111111111';
const row = {
  id, email: 'cliente@example.test', offer_code: 'starter', campaign_code: 'prereservation_2026',
  created_at: '2026-07-01T10:00:00.000Z', last_interest_at: '2026-07-02T10:00:00.000Z',
  confirmed_at: null, lead_id: '22222222-2222-4222-8222-222222222222', status: 'pending',
  confirmation_email_status: 'pending', confirmation_email_sent_at: null,
  confirmation_email_last_error_at: null, confirmation_email_attempts: 0,
  commercial_email_sent_at: null, commercial_email_last_error_at: null, commercial_email_attempts: 0
};

const request = async (app: express.Express, path: string) => {
  const server = app.listen(0);
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    return await fetch(`http://127.0.0.1:${address.port}${path}`);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};
const errorHandler: express.ErrorRequestHandler = (error, _req, res, _next) => error instanceof ZodError ? res.status(400).json({ error: 'Validation error' }) : res.status(500).json({ error: 'Internal server error' });

{
  const app = express();
  app.use('/api/admin', createAdminPrereservationsRouter({ authMiddleware: (_req, res) => res.status(401).json({ error: 'Authentication required' }) }));
  assert.equal((await request(app, '/api/admin/prereservations')).status, 401, 'unauthenticated access is blocked');
}

const serverSource = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
const shellSource = await readFile(new URL('../web/src/pages/admin/AdminShell.tsx', import.meta.url), 'utf8');
assert.match(serverSource, /adminPrereservationsRouter/);
assert.match(appSource, /\/admin\/prereservations/);
assert.match(appSource, /\/admin\/prereservations\/:id/);
assert.match(shellSource, /\['\/admin\/prereservations', 'Prerreservas'\]/);
{
  const app = express();
  app.use('/api/admin', createAdminPrereservationsRouter({ authMiddleware: (_req, _res, next) => next(), roleMiddleware: (_req, res) => res.status(403).json({ error: 'Forbidden' }) }));
  assert.equal((await request(app, '/api/admin/prereservations')).status, 403, 'non-admin access is blocked');
}
{
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = { async query(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return { rows: [row] }; } };
  const app = express();
  app.use('/api/admin', createAdminPrereservationsRouter({ pool, authMiddleware: (_req, _res, next) => next(), roleMiddleware: (_req, _res, next) => next() }));
  app.use(errorHandler);
  const list = await request(app, '/api/admin/prereservations?email=cliente&offer=starter&status=pending&date_from=2026-07-01&date_to=2026-07-31');
  assert.equal(list.status, 200);
  const listBody = await list.json() as any;
  assert.equal(listBody.prereservations[0].lead_id, row.lead_id);
  assert.equal(listBody.prereservations[0].access_token_hash, undefined);
  assert.match(calls[0].sql, /p\.email ILIKE \$1/);
  assert.match(calls[0].sql, /p\.offer_code = \$2/);
  assert.match(calls[0].sql, /p\.confirmed_at IS NULL/);
  assert.match(calls[0].sql, /p\.created_at >= \$3::date/);
  assert.match(calls[0].sql, /p\.created_at < \(\$4::date \+ interval '1 day'\)/);
  assert.match(calls[0].sql, /ORDER BY p\.last_interest_at DESC, p\.created_at DESC/);
  assert.doesNotMatch(calls[0].sql, /access_token_hash|token/i, 'admin list never selects token material');

  const detail = await request(app, `/api/admin/prereservations/${id}`);
  assert.equal(detail.status, 200);
  const detailBody = await detail.json() as any;
  assert.equal(detailBody.prereservation.id, id);
  assert.equal(detailBody.prereservation.access_token_hash, undefined);
  assert.doesNotMatch(calls[1].sql, /access_token_hash|token/i, 'admin detail never selects token material');
}
