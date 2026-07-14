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
  const pool = { async query(sql: string) { calls.push(sql); return { rows: [] }; } };
  const app = express();
  app.use('/api/catalog', createCatalogRouter({ pool, authMiddleware: (_req, res) => res.status(401).json({ error: 'Authentication required' }) }));
  assert.equal((await request(app, '/api/catalog/products')).status, 200, 'active product prices are public');
  assert.equal((await request(app, '/api/catalog/saas-plans')).status, 200, 'active plan prices are public');
  assert.equal((await request(app, '/api/catalog/packs')).status, 401, 'pack prices require authentication');
  assert.equal(calls.length, 2, 'rejected private pack requests do not query the database');
  assert.match(calls[0], /FROM store\.products[\s\S]*WHERE is_active = true/, 'the public product endpoint only returns active records');
  assert.match(calls[1], /FROM store\.saas_plans[\s\S]*WHERE is_active = true/, 'the public plan endpoint only returns active records');
}

{
  const calls: any[] = [];
  const packs = [{ id: '11111111-1111-4111-8111-111111111111', code: 'starter', name: 'PACK Starter', price_cents: 325000, tax_rate: '21.00', items: [{ name: 'Gateway BLE HorizonST', quantity: 5 }, { name: 'Antenas y accesorios de instalación', quantity: 5 }, { name: 'Inyector PoE de alimentación', quantity: 1 }, { name: 'Tag BLE personal con alarma', quantity: 10 }] }];
  const pool = { async query(sql: string) { calls.push(sql); return { rows: sql.includes('FROM store.packs') ? packs : [] }; } };
  const app = express();
  app.use('/api/catalog', createCatalogRouter({ pool, authMiddleware: (_req, _res, next) => next() }));
  assert.equal((await request(app, '/api/catalog/products')).status, 200);
  assert.equal((await request(app, '/api/catalog/saas-plans')).status, 200);
  const response = await request(app, '/api/catalog/packs');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as any).packs[0], packs[0]);
  assert.equal(calls.length, 3, 'authenticated users can also access the private pack catalog');
}
