import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSecurityMigration } from '../src/db/migrate-security.js';

const sqlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations/016_auth_rate_limits.sql');
const sql = await readFile(sqlPath, 'utf8');
const calls: Array<{ query: string; params?: unknown[] }> = [];
let recordedHash: string | undefined;
let incompatible = false;
const client = {
  async query(query: string, params?: unknown[]) {
    calls.push({ query, params });
    if (query.startsWith('SELECT sha256 FROM')) return { rows: recordedHash ? [{ sha256: recordedHash }] : [] };
    if (query.startsWith('INSERT INTO store.security_migrations')) recordedHash = params?.[1] as string;
    if (query.startsWith('SELECT\n      EXISTS')) return { rows: [{ bucket_key: !incompatible, attempts: true, expires_at: true, primary_key: true, expiry_index: true }] };
    return { rows: [] };
  },
  release() { calls.push({ query: 'RELEASE' }); }
};
const migrationPool = { async connect() { return client; } };

await runSecurityMigration(migrationPool, sqlPath);
assert.equal(calls.filter(({ query }) => query === sql).length, 1);
assert.match(recordedHash ?? '', /^[a-f0-9]{64}$/);
assert.equal(calls.some(({ query }) => query.includes('store.schema_migrations')), false);
assert.equal(calls.at(-2)?.query, 'COMMIT');
assert.equal(calls.at(-1)?.query, 'RELEASE');

calls.length = 0;
await runSecurityMigration(migrationPool, sqlPath);
assert.equal(calls.filter(({ query }) => query === sql).length, 0, 'idempotent rerun');
assert.equal(calls.at(-2)?.query, 'COMMIT');

calls.length = 0;
incompatible = true;
await assert.rejects(runSecurityMigration(migrationPool, sqlPath), /incompatible structure/);
assert.equal(calls.at(-2)?.query, 'ROLLBACK');
incompatible = false;

calls.length = 0;
recordedHash = 'changed';
await assert.rejects(runSecurityMigration(migrationPool, sqlPath), /changed after application/);
assert.equal(calls.at(-2)?.query, 'ROLLBACK');
