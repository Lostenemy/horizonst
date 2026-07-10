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
  const app = express();
  app.use('/api/catalog', createCatalogRouter({ authMiddleware: (_req, res) => res.status(401).json({ error: 'Authentication required' }) }));
  assert.equal((await request(app, '/api/catalog/products')).status, 401, 'catalog prices require authentication');
  assert.equal((await request(app, '/api/catalog/saas-plans')).status, 401, 'plan prices require authentication');
}

{
  const calls: any[] = [];
  const pool = { async query(sql: string) { calls.push(sql); return { rows: [] }; } };
  const app = express();
  app.use('/api/catalog', createCatalogRouter({ pool, authMiddleware: (_req, _res, next) => next() }));
  assert.equal((await request(app, '/api/catalog/products')).status, 200);
  assert.equal((await request(app, '/api/catalog/saas-plans')).status, 200);
  assert.equal(calls.length, 2, 'authenticated users can access private catalog');
}
