import assert from 'node:assert/strict';
import express from 'express';
import { ZodError } from 'zod';
import { hashToken } from '../src/modules/auth/token.js';
import { createPrereservationRouter } from '../src/modules/prereservation/prereservation.routes.js';
import { calculatePrereservationOffer, PRERESERVATION_CAMPAIGN, prereservationCodes } from '../src/modules/prereservation/prereservation.service.js';

const component = (code: string, price: number | null, overrides: Record<string, unknown> = {}) => ({
  code, name: code, price_cents: price, tax_rate: '21.00', is_active: true, ...overrides
});

const prices = {
  starter: { pack: 101001, plan: 20202 },
  professional: { pack: 303003, plan: 40404 },
  enterprise: { pack: 505005, plan: 60606 }
};

for (const code of prereservationCodes) {
  const offer = calculatePrereservationOffer(code, component(code, prices[code].pack), component(code, prices[code].plan));
  assert.equal(offer.available, true, `${code} is calculated when both matching components are active and priced`);
  if (offer.available) {
    const subtotal = prices[code].pack + prices[code].plan;
    assert.equal(offer.subtotalCents, subtotal);
    assert.equal(offer.discountCents, Math.round(subtotal * 5 / 100), `${code} receives its own exact five percent discount`);
    assert.equal(offer.hardware.priceCents, prices[code].pack);
    assert.equal(offer.webPlan.priceCents, prices[code].plan);
    assert.equal(offer.totalCents, offer.discountedSubtotalCents + offer.taxCents);
  }
}

assert.equal(calculatePrereservationOffer('starter', component('professional', 100), component('starter', 100)).available, false, 'mixed codes are rejected');
assert.equal(calculatePrereservationOffer('enterprise', component('enterprise', 0), component('enterprise', 100)).available, false, 'zero Enterprise pack price requires contact');
assert.equal(calculatePrereservationOffer('enterprise', component('enterprise', 100), component('enterprise', null)).available, false, 'missing Enterprise plan price requires contact');
assert.equal(calculatePrereservationOffer('enterprise', component('enterprise', 100, { is_active: false }), component('enterprise', 100)).available, false, 'inactive Enterprise pack requires contact');
assert.equal(calculatePrereservationOffer('enterprise', component('enterprise', 100), component('enterprise', -1)).available, false, 'negative Enterprise plan price requires contact');
const mixedTaxOffer = calculatePrereservationOffer('starter', component('starter', 10000, { tax_rate: '10.00' }), component('starter', 20000, { tax_rate: '21.00' }));
assert.equal(mixedTaxOffer.available, true);
if (mixedTaxOffer.available) {
  assert.equal(mixedTaxOffer.hardware.taxCents, 950);
  assert.equal(mixedTaxOffer.webPlan.taxCents, 3990);
  assert.equal(mixedTaxOffer.taxCents, 4940, 'tax is rounded independently per component after its allocated discount');
  assert.equal(mixedTaxOffer.totalCents, 33440);
}

type Stored = { id: string; email: string; code: string; tokenHash: string; confirmedAt: string | null };
const stored = new Map<string, Stored>();
const sqlCalls: Array<{ sql: string; params?: unknown[] }> = [];
const pool = {
  async query(sql: string, params: unknown[] = []) {
    sqlCalls.push({ sql, params });
    if (sql.includes('INSERT INTO store.public_prereservations')) {
      const [email, campaign, code, , tokenHash] = params as string[];
      assert.equal(campaign, PRERESERVATION_CAMPAIGN);
      const key = `${email}:${code}`;
      const previous = stored.get(key);
      stored.set(key, { id: previous?.id ?? `record-${stored.size + 1}`, email, code, tokenHash, confirmedAt: previous?.confirmedAt ?? null });
      return { rows: [{ id: stored.get(key)!.id }] };
    }
    if (sql.includes('SELECT id FROM store.public_prereservations')) {
      const [tokenHash, campaign, code] = params as string[];
      return { rows: [...stored.values()].filter((row) => row.tokenHash === tokenHash && row.code === code && campaign === PRERESERVATION_CAMPAIGN).map((row) => ({ id: row.id })) };
    }
    if (sql.includes('FROM (SELECT $1::text AS code)')) {
      const code = params[0] as keyof typeof prices;
      const value = prices[code];
      return { rows: value ? [{ pack_code: code, pack_name: `Pack ${code}`, pack_price_cents: value.pack, pack_tax_rate: '21.00', pack_is_active: true, plan_code: code, plan_name: code, plan_price_cents: value.plan, plan_tax_rate: '21.00', plan_is_active: true }] : [] };
    }
    if (sql.includes('SELECT id, confirmed_at FROM store.public_prereservations')) {
      const [tokenHash, campaign, code] = params as string[];
      const row = [...stored.values()].find((value) => value.tokenHash === tokenHash && value.code === code && campaign === PRERESERVATION_CAMPAIGN);
      return { rows: row ? [{ id: row.id, confirmed_at: row.confirmedAt }] : [] };
    }
    if (sql.includes('UPDATE store.public_prereservations SET confirmed_at')) {
      const row = [...stored.values()].find((value) => value.id === params[0]);
      if (row && !row.confirmedAt) row.confirmedAt = '2026-08-01T10:00:00.000Z';
      return { rows: row ? [{ confirmed_at: row.confirmedAt }] : [] };
    }
    return { rows: [] };
  }
};

const tokens = ['s'.repeat(43), 'p'.repeat(43), 'e'.repeat(43)];
let tokenIndex = 0;
const app = express();
app.use(express.json());
app.use('/api/public/prereservation', createPrereservationRouter({ pool, now: () => Date.parse('2026-08-01T10:00:00Z'), createToken: () => tokens[tokenIndex++] ?? 'r'.repeat(43) }));
app.use((error: unknown, _req: unknown, res: express.Response, _next: unknown) => error instanceof ZodError ? res.status(400).json({ error: 'Validation error' }) : res.status(500).json({ error: 'Internal server error' }));

const request = async (path: string, options: RequestInit = {}) => {
  const server = app.listen(0);
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    return await fetch(`http://127.0.0.1:${address.port}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};

const accessTokens = new Map<string, string>();
const campaignResponse = await request('/api/public/prereservation/campaign');
assert.equal(campaignResponse.status, 200);
assert.deepEqual((await campaignResponse.json() as any).codes, ['starter', 'professional', 'enterprise']);
for (const code of prereservationCodes) {
  const response = await request('/api/public/prereservation/access', { method: 'POST', body: JSON.stringify({ email: ' PERSON@EXAMPLE.TEST ', code, privacyAccepted: true }) });
  assert.equal(response.status, 201);
  const body = await response.json() as any;
  assert.equal(body.code, code);
  assert.equal(body.email, undefined, 'public responses do not expose the normalized email');
  assert.ok(Date.parse(body.expiresAt) > Date.parse('2026-08-01T10:00:00Z'), 'access tokens have an explicit expiry');
  accessTokens.set(code, body.accessToken);
}
assert.equal(stored.size, 3, 'the same email can register interest independently in all three levels');
assert.ok([...stored.values()].every((row) => row.email === 'person@example.test'), 'emails are normalized before persistence');

const repeated = await request('/api/public/prereservation/access', { method: 'POST', body: JSON.stringify({ email: 'person@example.test', code: 'starter', privacyAccepted: true }) });
assert.equal(repeated.status, 201);
assert.equal(stored.size, 3, 'repeated interest in the same campaign and code is idempotent');
assert.match(sqlCalls.find((call) => call.sql.includes('INSERT INTO store.public_prereservations'))!.sql, /ON CONFLICT \(email, campaign_code, offer_code\)/);

assert.equal((await request('/api/public/prereservation/access', { method: 'POST', body: JSON.stringify({ email: 'bad', code: 'starter', privacyAccepted: true }) })).status, 400);
assert.equal((await request('/api/public/prereservation/access', { method: 'POST', body: JSON.stringify({ email: 'person@example.test', code: 'starter', privacyAccepted: false }) })).status, 400);
assert.equal((await request('/api/public/prereservation/access', { method: 'POST', body: JSON.stringify({ email: 'person@example.test', code: 'unknown', privacyAccepted: true }) })).status, 400);
assert.equal((await request('/api/public/prereservation/offer?code=unknown', { headers: { Authorization: `Bearer ${accessTokens.get('starter')}` } })).status, 400);

for (const code of prereservationCodes) {
  const token = code === 'starter' ? (await repeated.json() as any).accessToken : accessTokens.get(code)!;
  accessTokens.set(code, token);
  const response = await request(`/api/public/prereservation/offer?code=${code}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.offer.code, code);
  assert.equal(body.offer.hardware.priceCents, prices[code].pack);
  assert.equal(body.offer.webPlan.priceCents, prices[code].plan);
}

assert.equal((await request('/api/public/prereservation/offer?code=professional', { headers: { Authorization: `Bearer ${accessTokens.get('starter')}` } })).status, 401, 'a token cannot be reused for a different code');
const confirmation = await request('/api/public/prereservation/confirm', { method: 'POST', headers: { Authorization: `Bearer ${accessTokens.get('professional')}` }, body: JSON.stringify({ code: 'professional' }) });
assert.equal(confirmation.status, 200);
assert.equal((await confirmation.json() as any).alreadyConfirmed, false);
const repeatedConfirmation = await request('/api/public/prereservation/confirm', { method: 'POST', headers: { Authorization: `Bearer ${accessTokens.get('professional')}` }, body: JSON.stringify({ code: 'professional' }) });
assert.equal((await repeatedConfirmation.json() as any).alreadyConfirmed, true, 'confirmation is idempotent');
assert.equal((await request('/api/public/prereservation/confirm', { method: 'POST', headers: { Authorization: `Bearer ${accessTokens.get('professional')}` }, body: JSON.stringify({ code: 'starter' }) })).status, 401, 'confirmation code cannot be manipulated');

const unavailablePool = {
  async query(sql: string, params: unknown[] = []) {
    if (sql.includes('FROM (SELECT $1::text AS code)')) return { rows: [{ pack_code: 'enterprise', pack_name: 'Enterprise', pack_price_cents: prices.enterprise.pack, pack_tax_rate: '21.00', pack_is_active: true, plan_code: 'enterprise', plan_name: 'Enterprise', plan_price_cents: null, plan_tax_rate: '21.00', plan_is_active: true }] };
    return pool.query(sql, params);
  }
};
const unavailableApp = express();
unavailableApp.use(express.json());
unavailableApp.use('/api/public/prereservation', createPrereservationRouter({ pool: unavailablePool, now: () => Date.parse('2026-08-01T10:00:00Z') }));
unavailableApp.use((error: unknown, _req: unknown, res: express.Response, _next: unknown) => error instanceof ZodError ? res.status(400).json({ error: 'Validation error' }) : res.status(500).json({ error: 'Internal server error' }));
const unavailableServer = unavailableApp.listen(0);
try {
  const address = unavailableServer.address(); assert.ok(address && typeof address === 'object');
  const offerResponse = await fetch(`http://127.0.0.1:${address.port}/api/public/prereservation/offer?code=enterprise`, { headers: { Authorization: `Bearer ${accessTokens.get('enterprise')}` } });
  assert.equal(offerResponse.status, 200);
  const unavailableOffer = (await offerResponse.json() as any).offer;
  assert.equal(unavailableOffer.available, false);
  assert.equal(unavailableOffer.totalCents, undefined, 'unavailable Enterprise offers expose no fictitious total');
  assert.equal(unavailableOffer.discountCents, undefined, 'unavailable Enterprise offers expose no fictitious discount');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/public/prereservation/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessTokens.get('enterprise')}` }, body: JSON.stringify({ code: 'enterprise' }) });
  assert.equal(response.status, 409, 'the backend refuses to confirm an Enterprise offer without a valid current price');
} finally { await new Promise<void>((resolve, reject) => unavailableServer.close((error) => error ? reject(error) : resolve())); }

for (let index = 0; index < 3; index += 1) assert.equal((await request('/api/public/prereservation/access', { method: 'POST', body: JSON.stringify({ email: 'person@example.test', code: 'starter', privacyAccepted: true }) })).status, 201);
assert.equal((await request('/api/public/prereservation/access', { method: 'POST', body: JSON.stringify({ email: 'person@example.test', code: 'starter', privacyAccepted: true }) })).status, 429, 'access attempts are rate limited by normalized email, IP and code');

const expiredApp = express();
expiredApp.use(express.json());
expiredApp.use('/api/public/prereservation', createPrereservationRouter({ pool, now: () => Date.parse('2026-09-02T00:00:00Z') }));
expiredApp.use((error: unknown, _req: unknown, res: express.Response, _next: unknown) => error instanceof ZodError ? res.status(400).json({ error: 'Validation error' }) : res.status(500).json({ error: 'Internal server error' }));
const expiredServer = expiredApp.listen(0);
try {
  const address = expiredServer.address(); assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/public/prereservation/access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'late@example.test', code: 'starter', privacyAccepted: true }) });
  assert.equal(response.status, 410, 'the backend rejects access after the campaign deadline');
} finally { await new Promise<void>((resolve, reject) => expiredServer.close((error) => error ? reject(error) : resolve())); }

const routerSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/modules/prereservation/prereservation.routes.ts', import.meta.url), 'utf8'));
assert.doesNotMatch(routerSource, /console\.(log|error)/, 'tokens and emails are not written to logs');
assert.match(routerSource, /consumeRate\(`email:\$\{email\}:\$\{input\.code\}`,[\s\S]*consumeRate\(`ip:\$\{requestIp\(req\)\}`/, 'access attempts are independently rate limited by email and IP');
assert.match(routerSource, /LEFT JOIN store\.packs p ON p\.code = requested\.code/);
assert.match(routerSource, /LEFT JOIN store\.saas_plans s ON s\.code = requested\.code/, 'pack and plan are loaded exclusively from the same selected code');
assert.match(routerSource, /access_expires_at > now\(\)/, 'expired access tokens are rejected');
assert.doesNotMatch(routerSource, /store\.orders|payment|charge/, 'confirmation does not create orders or payments');
