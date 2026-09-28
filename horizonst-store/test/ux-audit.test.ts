import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { isPrereservationCampaignActive, PRERESERVATION_END_AT, PRERESERVATION_END_LABEL } from '../src/modules/prereservation/prereservation.service.js';
import { createQuotesRouter } from '../src/modules/quotes/quotes.routes.js';
import { createPrereservationRouter } from '../src/modules/prereservation/prereservation.routes.js';
import { PublicPlanCards } from '../web/src/pages/PublicLanding.js';
import { displayLabel, itemPresentation, pageTitle, quoteDisplayName, quotesNavigation } from '../web/src/lib/presentation.js';
import type { Role, SaasPlan } from '../web/src/lib/types.js';

const end = Date.parse(PRERESERVATION_END_AT);
assert.equal(PRERESERVATION_END_LABEL, '1 de enero de 2027');
for (const instant of ['2026-08-01T00:00:00Z', '2026-09-28T00:00:00Z', '2026-12-31T23:00:00Z', '2027-01-01T22:59:59.999Z'])
  assert.equal(isPrereservationCampaignActive(Date.parse(instant)), true);
assert.equal(isPrereservationCampaignActive(end + 1), false);
assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(end + 1), '02/01/2027, 00:00:00');

const plans = ['starter', 'professional', 'enterprise'].map((code): SaasPlan => ({
  id: code, code, name: code, description: null, annual_price_cents: 60000,
  tax_rate: 21, max_tags: 10, max_gateways: 5, is_active: true, is_enterprise: false
}));
for (const active of [true, false]) {
  const cards = JSON.stringify(PublicPlanCards({ plans, loading: false, error: false,
    campaign: { active, endAt: PRERESERVATION_END_AT, campaign: 'test', codes: ['starter', 'professional', 'enterprise'] }, onPrereserve() {} }));
  assert.equal((cards.match(active ? /Prerreservar con 5 % de descuento/g : /Consultar condiciones actuales/g) ?? []).length, 3);
  assert.doesNotMatch(cards, /"disabled":true/);
}
assert.deepEqual(quotesNavigation('admin'), { to: '/admin/quotes', label: 'Gestionar presupuestos' });
for (const role of ['customer', 'distributor'] as const) assert.deepEqual(quotesNavigation(role), { to: '/quotes', label: 'Mis presupuestos' });
assert.equal(displayLabel('submitted'), 'Solicitud recibida');
assert.equal(displayLabel('cart_item_removed'), 'Artículo retirado del carrito');
assert.equal(quoteDisplayName({ status: 'draft', quote_number: 'DRAFT-private-id' }), 'Borrador de presupuesto');
assert.deepEqual(itemPresentation('PACK Starter: 5 gateways: cobertura hasta 500 m²'), { name: 'PACK Starter', details: '5 gateways: cobertura hasta 500 m²' });
assert.deepEqual(itemPresentation('Plan anual'), { name: 'Plan anual', details: '' });
assert.equal(pageTitle('/planes', true), 'Planes | HorizonST');
assert.equal(pageTitle('/catalog', false), 'Catálogo B2B | HorizonST Store');
assert.notEqual(pageTitle('/cart', false), pageTitle('/quotes', false));

async function request(app: express.Express, url: string, options?: RequestInit) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    return await fetch(`http://127.0.0.1:${address.port}${url}`, options);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

// API real, reloj inyectado y pool que nunca contacta una base de datos.
for (const now of [end - 1, end, end + 1]) {
  let queries = 0;
  const app = express(); app.use(express.json());
  app.use('/campaign', createPrereservationRouter({ pool: { query: async () => { queries++; return { rows: [] }; } } as any, now: () => now }));
  const status = await request(app, '/campaign/campaign');
  assert.equal((await status.json()).active, now <= end);
  if (now > end) {
    const response = await request(app, '/campaign/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'starter', email: 'fixture@example.test', privacyAccepted: true }) });
    assert.equal(response.status, 410); assert.equal(queries, 0);
  }
}

// Cada identidad se ejerce por HTTP con el middleware real de roles.
const ownedId = '11111111-1111-4111-8111-111111111111';
const foreignId = '22222222-2222-4222-8222-222222222222';
for (const role of ['customer', 'distributor', 'admin'] as Role[]) {
  const app = express();
  const userId = `${role}-fixture`;
  const calls: unknown[][] = [];
  app.use('/quotes', createQuotesRouter({
    authMiddleware: (req, _res, next) => { req.user = { sub: userId, role, status: 'active', email: 'fixture@example.test' } as any; next(); },
    pool: { query: async (sql: string, params: unknown[] = []) => {
      calls.push(params);
      assert.ok(sql.includes('q.user_id = $1') || sql.includes('q.user_id = $2'));
      if (params.length === 1) { assert.equal(params[0], userId); return { rows: [{ id: ownedId, user_id: userId }] }; }
      assert.equal(params[1], userId); return { rows: [] };
    } } as any
  }));
  const list = await request(app, '/quotes');
  assert.equal(list.status, role === 'admin' ? 403 : 200);
  const foreign = await request(app, `/quotes/${foreignId}`);
  assert.equal(foreign.status, role === 'admin' ? 403 : 404);
  if (role === 'admin') assert.equal(calls.length, 0);
}
console.log('UX audit: campaign boundaries, presentation and role/isolation HTTP checks passed');
