import assert from 'node:assert/strict';
import express from 'express';
import { configureTrustProxy } from '../src/config/trust-proxy.js';

const app = express();
configureTrustProxy(app);
assert.equal(app.get('trust proxy'), 1, 'the application trusts exactly one proxy hop');
app.get('/ip', (req, res) => res.json({ ip: req.ip }));

const server = app.listen(0);
try {
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/ip`, { headers: { 'X-Forwarded-For': '203.0.113.99, 198.51.100.42' } });
  const body = await response.json() as any;
  assert.equal(body.ip, '198.51.100.42', 'req.ip uses only the address supplied by the single trusted proxy hop');
  assert.notEqual(body.ip, '203.0.113.99', 'an arbitrary earlier forwarded value is not trusted as the client IP');
} finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

const readme = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../README.md', import.meta.url), 'utf8'));
assert.match(readme, /proxy_set_header X-Real-IP \$remote_addr/);
assert.match(readme, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/);
assert.match(readme, /proxy_set_header X-Forwarded-Proto \$scheme/);
assert.match(readme, /trust proxy = 1/);
const trustProxySource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/config/trust-proxy.ts', import.meta.url), 'utf8'));
assert.doesNotMatch(trustProxySource, /set\('trust proxy', true\)/);
