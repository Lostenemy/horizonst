import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closePool, pool } from './pool.js';

const filename = '016_auth_rate_limits.sql';
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations', filename);

type QueryResult = { rows: Array<Record<string, unknown>> };
type Client = { query: (sql: string, params?: unknown[]) => Promise<QueryResult>; release: () => void };
type MigrationPool = { connect: () => Promise<Client> };

// Registro independiente: 011–015 permanecen pendientes en store.schema_migrations.
export const runSecurityMigration = async (migrationPool: MigrationPool = pool, sqlPath = migrationPath): Promise<void> => {
  const sql = await readFile(sqlPath, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = await migrationPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('store.security_migrations'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS store');
    await client.query(`CREATE TABLE IF NOT EXISTS store.security_migrations (
      filename TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const previous = await client.query('SELECT sha256 FROM store.security_migrations WHERE filename = $1', [filename]);
    if (previous.rows.length && previous.rows[0].sha256 !== checksum) {
      throw new Error(`Security migration ${filename} changed after application`);
    }
    if (!previous.rows.length) {
      await client.query(sql);
      await client.query('INSERT INTO store.security_migrations (filename, sha256) VALUES ($1, $2)', [filename, checksum]);
    }
    // CREATE TABLE IF NOT EXISTS no valida una tabla preexistente incompatible.
    const structure = await client.query(`SELECT
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'store.auth_rate_limits'::regclass AND attname = 'bucket_key' AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped) AS bucket_key,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'store.auth_rate_limits'::regclass AND attname = 'attempts' AND atttypid = 'integer'::regtype AND attnotnull AND NOT attisdropped) AS attempts,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'store.auth_rate_limits'::regclass AND attname = 'expires_at' AND atttypid = 'timestamp with time zone'::regtype AND attnotnull AND NOT attisdropped) AS expires_at,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'store.auth_rate_limits'::regclass AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (bucket_key)') AS primary_key,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'store' AND tablename = 'auth_rate_limits' AND indexname = 'auth_rate_limits_expiry_idx' AND indexdef LIKE '%(expires_at)%') AS expiry_index`);
    const shape = structure.rows[0];
    if (!shape || ['bucket_key', 'attempts', 'expires_at', 'primary_key', 'expiry_index'].some((key) => shape[key] !== true)) {
      throw new Error('store.auth_rate_limits has an incompatible structure');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const isEntrypoint = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isEntrypoint) {
  runSecurityMigration().then(closePool).catch(async (error) => {
    console.error(error);
    await closePool();
    process.exit(1);
  });
}
