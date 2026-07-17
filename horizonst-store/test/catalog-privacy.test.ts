import assert from 'node:assert/strict';
import express from 'express';
import { createCatalogRouter } from '../src/modules/catalog/catalog.routes.js';

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

{
  const calls: string[] = [];
  const plans = [
    { code: 'starter', annual_price_cents: 60000, is_enterprise: false },
    { code: 'professional', annual_price_cents: 90000, is_enterprise: false },
    { code: 'enterprise', annual_price_cents: 120000, is_enterprise: false }
  ];
  const pool = { async query(sql: string) { calls.push(sql); return { rows: plans }; } };
  const app = express();
  app.use('/api/catalog', createCatalogRouter({ pool, authMiddleware: (_req, res) => res.status(401).json({ error: 'Authentication required' }) }));
  assert.equal((await request(app, '/api/catalog/products')).status, 404, 'individual products are not exposed in the customer catalog');
  const plansResponse = await request(app, '/api/catalog/saas-plans');
  assert.equal(plansResponse.status, 200, 'active plan prices are public');
  const plansBody = await plansResponse.json() as any;
  assert.deepEqual(plansBody.saasPlans, plans);
  assert.deepEqual(plansBody.saasPlans.find((plan: any) => plan.code === 'enterprise'), { code: 'enterprise', annual_price_cents: 120000, is_enterprise: false });
  assert.equal(plansBody.saasPlans.find((plan: any) => plan.code === 'starter').annual_price_cents, 60000);
  assert.equal(plansBody.saasPlans.find((plan: any) => plan.code === 'professional').annual_price_cents, 90000);
  assert.equal((await request(app, '/api/catalog/packs')).status, 401, 'pack prices require authentication');
  assert.equal(calls.length, 1, 'unavailable product and rejected pack requests do not query the database');
  assert.match(calls[0], /FROM store\.saas_plans[\s\S]*WHERE is_active = true/, 'the public plan endpoint only returns active records');
}

{
  const calls: any[] = [];
  const packs = [{ id: '11111111-1111-4111-8111-111111111111', code: 'starter', name: 'PACK Starter', price_cents: 325000, tax_rate: '21.00', coverage_square_meters: 500, items: [{ name: 'Gateway BLE HorizonST', quantity: 5 }, { name: 'Antenas y accesorios de instalación', quantity: 5 }, { name: 'Inyector PoE de alimentación', quantity: 1 }, { name: 'Tag BLE personal con alarma', quantity: 10 }] }];
  const pool = { async query(sql: string) { calls.push(sql); return { rows: sql.includes('FROM store.packs') ? packs : [] }; } };
  const app = express();
  app.use('/api/catalog', createCatalogRouter({ pool, authMiddleware: (_req, _res, next) => next() }));
  assert.equal((await request(app, '/api/catalog/products')).status, 404, 'authenticated customers cannot browse individual products either');
  assert.equal((await request(app, '/api/catalog/saas-plans')).status, 200);
  const response = await request(app, '/api/catalog/packs');
  assert.equal(response.status, 200, 'authenticated users can access packs');
  const body = await response.json() as any;
  assert.deepEqual(body.packs[0], packs[0]);
  assert.equal(body.packs[0].coverage_square_meters, 500);
  assert.match(calls.find((sql) => sql.includes('FROM store.packs')), /p\.coverage_square_meters/);
  assert.equal(calls.length, 2, 'customers can access packs and public plans without querying individual products');
}
