import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer } from '../src/server.js';

const staticRoot = await mkdtemp(path.join(tmpdir(), 'horizonst-store-routing-'));
const indexMarker = '<!doctype html><html><body>HorizonST SPA routing test</body></html>';
await writeFile(path.join(staticRoot, 'index.html'), indexMarker, 'utf8');
await mkdir(path.join(staticRoot, 'prerender', 'production'), { recursive: true });
await mkdir(path.join(staticRoot, 'prerender', 'staging'), { recursive: true });
await writeFile(path.join(staticRoot, 'prerender', 'production', 'index.html'), '<h1>Public production</h1>');
await writeFile(path.join(staticRoot, 'prerender', 'staging', 'index.html'), '<h1>Public staging</h1>');

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
  const publicGet = (route: string, host = 'horizonst.es') => new Promise<Response>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: address.port, path: route, headers: { host } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers as HeadersInit })));
    }).on('error', reject);
  });
  const home = await publicGet('/'); assert.equal(home.status, 200); assert.match(await home.text(), /Public production/);
  const staging = await publicGet('/', 'horizonst.com.es'); assert.equal(staging.status, 200); assert.match(await staging.text(), /Public staging/); assert.match(staging.headers.get('x-robots-tag') ?? '', /noindex/);
  const robots = await publicGet('/robots.txt'); assert.match(robots.headers.get('content-type') ?? '', /^text\/plain/); assert.match(await robots.text(), /Sitemap: https:\/\/horizonst\.es\/sitemap\.xml/);
  const sitemap = await publicGet('/sitemap.xml'); assert.match(sitemap.headers.get('content-type') ?? '', /^application\/xml/); assert.match(await sitemap.text(), /https:\/\/horizonst\.es\/info-faqs/);
  for (const route of ['/inexistente', '/missing.js', '/prerender/production/index.html']) assert.equal((await publicGet(route)).status, 404, `${route} cannot fall through to the SPA`);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(staticRoot, { recursive: true, force: true });
}
