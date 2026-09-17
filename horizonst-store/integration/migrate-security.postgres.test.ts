import assert from 'node:assert/strict';
import pg from 'pg';
import { runSecurityMigration } from '../src/db/migrate-security.js';

const connectionString = process.env.STORE_SECURITY_MIGRATION_TEST_DATABASE_URL;
if (!connectionString) throw new Error('STORE_SECURITY_MIGRATION_TEST_DATABASE_URL is required');
const database = new URL(connectionString).pathname.slice(1);
if (!/(?:^|_)test(?:_|$)/i.test(database)) throw new Error('Refusing to reset a database whose name is not explicitly a test database');

const pool = new pg.Pool({ connectionString, max: 2 });
try {
  await pool.query('DROP SCHEMA IF EXISTS store CASCADE');
  await pool.query('CREATE SCHEMA store');
  await pool.query('CREATE TABLE store.schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (let number = 1; number <= 10; number += 1) {
    await pool.query('INSERT INTO store.schema_migrations (filename) VALUES ($1)', [`${String(number).padStart(3, '0')}_existing.sql`]);
  }

  await runSecurityMigration(pool);
  await runSecurityMigration(pool);

  const regular = await pool.query('SELECT filename FROM store.schema_migrations ORDER BY filename');
  assert.equal(regular.rowCount, 10);
  assert.equal(regular.rows.some(({ filename }) => /^01[1-6]_/.test(filename)), false);
  const security = await pool.query('SELECT filename, sha256 FROM store.security_migrations');
  assert.deepEqual(security.rows.map(({ filename }) => filename), ['016_auth_rate_limits.sql']);
  assert.match(security.rows[0].sha256, /^[a-f0-9]{64}$/);
  const structure = await pool.query(`SELECT
    to_regclass('store.auth_rate_limits') IS NOT NULL AS has_table,
    to_regclass('store.auth_rate_limits_expiry_idx') IS NOT NULL AS has_index`);
  assert.deepEqual(structure.rows[0], { has_table: true, has_index: true });
} finally {
  await pool.query('DROP SCHEMA IF EXISTS store CASCADE');
  await pool.end();
}
