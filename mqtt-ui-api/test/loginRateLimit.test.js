import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createLoginRateLimit } from '../src/loginRateLimit.js';
import { createTrustedProxy } from '../src/trustedProxy.js';

test('login limiter blocks repeated attempts and ignores forged forwarded addresses', () => {
  let time = 0;
  const limit = createLoginRateLimit(() => time);
  let passed = 0;
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json() { return this; } };
  for (let i = 0; i < 15; i++) limit({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': String(i) } }, res, () => passed++);
  assert.equal(passed, 10);
  assert.equal(res.code, 429);
  assert.equal(res.headers['Retry-After'], '900');
  time = 900_000;
  limit({ socket: { remoteAddress: '127.0.0.1' } }, res, () => passed++);
  assert.equal(passed, 11);
});

async function withLoginServer(trustedAddress, run) {
  const app = express();
  app.set('trust proxy', createTrustedProxy(trustedAddress));
  app.post('/login', createLoginRateLimit(() => 0), (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    const login = (forwardedFor) => fetch(`http://127.0.0.1:${address.port}/login`, {
      method: 'POST',
      headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}
    });
    await run(login);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('two client IPs behind the trusted Nginx peer have independent 10-attempt budgets', async () => {
  await withLoginServer('127.0.0.1', async (login) => {
    for (let i = 0; i < 10; i++) {
      const first = await login('198.51.100.10');
      const second = await login('198.51.100.20');
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal((await first.json()).ip, '198.51.100.10');
      assert.equal((await second.json()).ip, '198.51.100.20');
    }
    assert.equal((await login('198.51.100.10')).status, 429);
    assert.equal((await login('198.51.100.20')).status, 429);
  });
});

test('only the nearest forwarded address counts; client-prepended addresses cannot evade the budget', async () => {
  await withLoginServer('127.0.0.1', async (login) => {
    for (let i = 0; i < 10; i++) {
      const response = await login(`203.0.113.${i + 1}, 198.51.100.10`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ip, '198.51.100.10');
    }
    const blocked = await login('203.0.113.99, 198.51.100.10');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '900');
  });
});

test('an untrusted direct peer cannot spoof its identity with X-Forwarded-For', async () => {
  await withLoginServer('192.0.2.44', async (login) => {
    for (let i = 0; i < 10; i++) {
      const response = await login(`203.0.113.${i + 1}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ip, '127.0.0.1');
    }
    assert.equal((await login('203.0.113.99')).status, 429);
  });
  assert.equal(createTrustedProxy('not-an-ip')('127.0.0.1', 0), false);
  assert.equal(createTrustedProxy('127.0.0.1')('127.0.0.1', 1), false);
});

test('the MQTT UI app uses the exact-peer trust policy before login limiting', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /app\.set\('trust proxy', createTrustedProxy\(process\.env\.UI_TRUSTED_PROXY_IP/);
  assert.doesNotMatch(source, /app\.set\(['"]trust proxy['"], true\)/);
});
