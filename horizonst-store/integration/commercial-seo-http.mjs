import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { createServer } from '../dist/server.js';

const root = path.resolve('web/dist');
const pages = ['/', '/planes', '/info-faqs', '/contacto', '/colaboraciones', '/colaboraciones/instaladores', '/colaboraciones/asesorias-prl', '/colaboraciones/ingenierias-frio', '/aviso-legal', '/privacidad'];
const app = createServer(root); const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const port = server.address().port;
const get = (url, host = 'horizonst.es') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: url, headers: { host } }, response => {
    const chunks = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
  }).on('error', reject);
});
try {
  for (const route of pages) {
    const response = await get(route); const html = await response.text();
    assert.equal(response.status, 200, route); assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.match(html, /<html lang="es">/); assert.match(html, /<title>[^<]+\| HorizonST<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]+">/); assert.ok(html.includes(`<link rel="canonical" href="https://horizonst.es${route}">`));
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, route); assert.match(html, /<nav /); assert.match(html, /href="\/info-faqs"/); assert.match(html, /data-prerendered="true"/);
    assert.doesNotMatch(html, /horizonst\.accessToken|horizonst\.refreshToken|distributor_profiles|password_hash/);
    if (route === '/planes') assert.match(html, /Los precios y las campañas se consultan en tiempo real y requieren JavaScript/);
    console.log(JSON.stringify({ route, status: response.status, bytes: Buffer.byteLength(html), title: html.match(/<title>([^<]+)/)?.[1], h1: html.match(/<h1[^>]*>([^<]+)/)?.[1] }));
    const stage = await get(route, 'horizonst.com.es'); const stageHtml = await stage.text();
    assert.equal(stage.status, 200); assert.match(stage.headers.get('x-robots-tag') ?? '', /noindex/); assert.match(stageHtml, /name="robots" content="noindex, nofollow"/);
    assert.ok(stageHtml.includes(`<link rel="canonical" href="https://horizonst.es${route}">`));
    assert.ok(stageHtml.includes('https://tienda.horizonst.com.es'), 'staging navigation stays in its environment');
    assert.ok(html.includes('https://tienda.horizonst.es'), 'production navigation stays in its environment');
  }
  const robots = await get('/robots.txt'); assert.match(robots.headers.get('content-type') ?? '', /^text\/plain/); assert.match(await robots.text(), /Sitemap: https:\/\/horizonst\.es\/sitemap\.xml/);
  const stageRobots = await get('/robots.txt', 'horizonst.com.es'); assert.match(await stageRobots.text(), /Disallow: \//);
  const sitemap = await get('/sitemap.xml'); const xml = await sitemap.text(); assert.match(sitemap.headers.get('content-type') ?? '', /^application\/xml/);
  for (const route of pages) assert.ok(xml.includes(`<loc>https://horizonst.es${route}</loc>`));
  assert.equal((xml.match(/<url>/g) ?? []).length, pages.length);
  for (const route of ['/missing', '/assets/missing.js', '/prerender/production/index.html']) assert.equal((await get(route)).status, 404);
  const api = await get('/api/not-real'); assert.equal(api.status, 404); assert.match(api.headers.get('content-type') ?? '', /^application\/json/);
  const store = await get('/login', 'tienda.horizonst.es'); assert.equal(store.status, 200); assert.match(store.headers.get('x-robots-tag') ?? '', /noindex/);
  console.log('Commercial initial HTML, sitemap, robots, noindex and 404: passed');
} finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
