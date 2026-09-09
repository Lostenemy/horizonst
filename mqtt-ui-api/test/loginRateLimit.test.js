import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoginRateLimit } from '../src/loginRateLimit.js';

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
