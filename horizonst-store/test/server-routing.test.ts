import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

const staticRoot = await mkdtemp(path.join(tmpdir(), 'horizonst-store-routing-'));
const indexMarker = '<!doctype html><html><body>HorizonST SPA routing test</body></html>';
await writeFile(path.join(staticRoot, 'index.html'), indexMarker, 'utf8');

const app = createServer(staticRoot);
const server = app.listen(0);

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const request = (route: string) => fetch(`http://127.0.0.1:${address.port}${route}`);

  for (const route of ['/api/catalog/products', '/api/ruta-que-no-existe']) {
    const response = await request(route);
    assert.equal(response.status, 404, `${route} returns an API 404`);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/, `${route} returns JSON`);
    assert.deepEqual(await response.json(), { error: 'API route not found' });
  }

  const existingApi = await request('/api/public/prereservation/campaign');
  assert.equal(existingApi.status, 200, 'existing API endpoints still run before the API 404 handler');
  assert.match(existingApi.headers.get('content-type') ?? '', /^application\/json\b/);

  const spaRoutes = [
    '/',
    '/catalog',
    '/cart',
    '/admin/prereservations',
    '/admin/prereservations/11111111-1111-4111-8111-111111111111',
    '/prerreserva/starter',
    '/aviso-legal',
    '/privacidad'
  ];
  for (const route of spaRoutes) {
    const response = await request(route);
    assert.equal(response.status, 200, `${route} continues to load the SPA`);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/);
    assert.equal(await response.text(), indexMarker);
  }
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(staticRoot, { recursive: true, force: true });
}
