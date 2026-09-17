import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { pool } from '../db/pool';
import { authenticate } from '../middleware/auth';
import { credentialVersion, signToken } from '../utils/jwt';
import { hashPassword, verifyPasswordAsync } from '../utils/crypto';

const originalQuery = pool.query;
afterEach(() => { pool.query = originalQuery; });
const invoke = async (token: string, row: unknown) => {
  (pool as any).query = async (sql: string) => {
    assert.equal(sql, 'SELECT id, role, password_hash FROM users WHERE id = $1');
    return { rows: row ? [row] : [] };
  };
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  const res: any = { code: 200, status(code: number) { this.code = code; return this; }, json() { return this; } };
  let passed = false;
  await authenticate(req, res, () => { passed = true; });
  return { req, res, passed };
};
const signed = () => signToken({ userId: 1, role: 'hardware_superadmin', credentialVersion: credentialVersion('old-hash') });

test('JWT observes current role, deletion and changed password instead of historical claims', async () => {
  const demoted = await invoke(signed(), { id: 1, role: 'hardware_readonly', password_hash: 'old-hash' });
  assert.equal(demoted.passed, true);
  assert.equal(demoted.req.user.role, 'hardware_readonly');
  for (const user of [null, { id: 1, role: 'hardware_superadmin', password_hash: 'new-hash' }]) {
    const result = await invoke(signed(), user);
    assert.equal(result.res.code, 401);
    assert.equal(result.passed, false);
  }
});

test('legacy JWT without credential version fails closed and does not disclose hash', async () => {
  const token = signToken({ userId: 1, role: 'ADMIN' });
  const result = await invoke(token, { id: 1, role: 'ADMIN', password_hash: 'old-hash' });
  assert.equal(result.res.code, 401);
  assert.equal(result.passed, false);
  assert.ok(!Buffer.from(signed().split('.')[1], 'base64url').toString().includes('old-hash'));
});

test('async PBKDF2 preserves existing password format and rejects incorrect input', async () => {
  const { hash, salt } = hashPassword('fixture-password');
  assert.equal(await verifyPasswordAsync('fixture-password', hash, salt), true);
  assert.equal(await verifyPasswordAsync('wrong', hash, salt), false);
});
