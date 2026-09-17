import assert from 'node:assert/strict';
import express from 'express';
import { authRouter } from '../src/modules/auth/auth.routes.js';
import { pool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';

const originalQuery = pool.query;
const originalEnabled = env.mail.enabled;
const originalMode = process.env.NODE_ENV;
let knownAccount = true;
let storedHashes: string[] = [];
pool.query = async (sql: string, values: any[]) => {
  if (sql.includes('auth_rate_limits')) return { rows: [{ attempts: 1, retry_after: 900 }] };
  if (sql.startsWith('SELECT id FROM store.users')) return { rows: knownAccount ? [{ id: 'user-1' }] : [] };
  if (sql.startsWith('INSERT INTO store.password_reset_tokens')) { storedHashes.push(values[1]); return { rows: [] }; }
  throw new Error('Unexpected query');
};
env.mail.enabled = false;
const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.on('listening', resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  let expected: unknown;
  for (const mode of ['development', 'test', 'production']) {
    process.env.NODE_ENV = mode;
    for (knownAccount of [true, false]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/request-password-reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'user@example.test' })
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(Object.keys(body), ['message']);
      if (expected) assert.deepEqual(body, expected); else expected = body;
    }
  }
  assert.equal(storedHashes.length, 3);
  for (const value of storedHashes) assert.match(value, /^[a-f0-9]{64}$/);
} finally {
  pool.query = originalQuery;
  env.mail.enabled = originalEnabled;
  if (originalMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalMode;
  await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
}
console.log('Store recovery HTTP: generic response without tokens in every mode OK');
