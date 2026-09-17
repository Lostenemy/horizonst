import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resetStorePassword } from '../src/modules/auth/password-reset.js';
import { credentialVersion, matchesCredentialVersion, signAccessToken, verifyAccessToken } from '../src/modules/auth/token.js';
import { sendPasswordResetEmail } from '../src/modules/shared/mail.js';
import { requireAuth } from '../src/modules/auth/middleware.js';
import { pool } from '../src/db/pool.js';

const require = createRequire(import.meta.url);
const { resetFixture } = require('../../scripts/reset-transaction-fixture.cjs');
const fixture = resetFixture();
const results = await Promise.all([resetStorePassword(fixture.pool, 'fixture', 'new-hash'), resetStorePassword(fixture.pool, 'fixture', 'other-hash')]);
assert.deepEqual(results.sort(), [false, true]);
assert.equal(fixture.state.sessions, 0);
assert.equal(fixture.state.revoked, true);
assert.equal(fixture.released, 2);
const failed = resetFixture(true);
await assert.rejects(resetStorePassword(failed.pool, 'fixture', 'new-hash'), /injected/);
assert.deepEqual(failed.state, { consumed: false, password: 'before', sessions: 2, revoked: false });

const version = credentialVersion('old-hash');
const token = signAccessToken({ sub: 'user-1', email: 'user@example.test', status: 'active', role: 'customer', credentialVersion: version });
const decoded = verifyAccessToken(token);
assert.equal(matchesCredentialVersion(decoded.credentialVersion, 'old-hash'), true);
assert.equal(matchesCredentialVersion(decoded.credentialVersion, 'changed-hash'), false);
assert.equal(matchesCredentialVersion(undefined, 'old-hash'), false);
assert.throws(() => verifyAccessToken(token + '.extra'));

const originalQuery = pool.query;
try {
  let passwordHash = 'old-hash';
  pool.query = async () => ({ rows: [{ id: 'user-1', status: 'active', role: 'customer', password_hash: passwordHash }] });
  const req: any = { header: () => `Bearer ${token}` };
  const res: any = { code: 200, status(code: number) { this.code = code; return this; }, json() { return this; } };
  let passed = 0;
  await requireAuth(req, res, () => passed++);
  assert.equal(passed, 1);
  passwordHash = 'changed-hash';
  await requireAuth(req, res, () => passed++);
  assert.equal(passed, 1);
  assert.equal(res.code, 401);
} finally { pool.query = originalQuery; }

let sent: any;
await sendPasswordResetEmail({ email: 'user@example.test', resetUrl: 'https://store.example.test/reset-password#token=fixture' }, async content => { sent = content; });
assert.equal(sent.to, 'user@example.test');
assert.match(sent.text, /#token=fixture/);
const source = await readFile(new URL('../src/modules/auth/auth.routes.ts', import.meta.url), 'utf8');
const requestSection = source.slice(source.indexOf("authRouter.post('/request-password-reset'"), source.indexOf("authRouter.post('/reset-password'"));
assert.doesNotMatch(requestSection, /resetToken:\s*process|res\.json\([^;]*resetToken|console\.[^(]*\([^;]*resetToken/);
assert.match(requestSection, /await sendPasswordResetEmail/);
console.log('Store security reset: concurrent consumption, rollback, revocation and out-of-band delivery OK');
