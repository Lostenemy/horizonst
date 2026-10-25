import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, closePool } from './pool.js';

const filename = '017_notification_deliveries.sql';
// Dedicated ledger: do NOT mark or apply pending commercial migrations 011–015.
export async function runNotificationMigration(db = pool) {
  const sql = await readFile(new URL(`../../migrations/${filename}`, import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('store.notification_migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS store.notification_migrations
      (filename TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const previous = await client.query('SELECT sha256 FROM store.notification_migrations WHERE filename=$1', [filename]);
    if (previous.rows.length && previous.rows[0].sha256 !== checksum) throw new Error('notification_migration_checksum_mismatch');
    // If the regular runner applied 017, verify columns and constraint shape, not just IF NOT EXISTS.
    if (!previous.rows.length) {
      const existing = await client.query("SELECT to_regclass('store.notification_deliveries') AS relation");
      if (existing.rows[0].relation) {
        const regular = await client.query('SELECT 1 FROM store.schema_migrations WHERE filename=$1', [filename]);
        if (!regular.rows.length) throw new Error('notification_untracked_existing_table');
      }
      await client.query(sql);
      await client.query('INSERT INTO store.notification_migrations(filename,sha256) VALUES($1,$2)', [filename, checksum]);
    }
    const columns = await client.query(`SELECT attname, attnotnull, format_type(atttypid,atttypmod) AS type FROM pg_attribute
      WHERE attrelid='store.notification_deliveries'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`);
    const expected = ['id:uuid','status_history_id:uuid','notification_type:text','recipient_role:text','order_id:uuid',
      'state:text','attempt_id:uuid','lease_until:timestamp with time zone','smtp_code:integer','result_code:text',
      'created_at:timestamp with time zone','started_at:timestamp with time zone','finished_at:timestamp with time zone',
      'reviewed_by:uuid','reviewed_at:timestamp with time zone'];
    if (columns.rows.map(r => `${r.attname}:${r.type}`).join('|') !== expected.join('|')) throw new Error('notification_schema_incompatible');
    if (columns.rows.filter(r => r.attnotnull).map(r => r.attname).join('|') !==
      'id|status_history_id|notification_type|recipient_role|state|created_at') throw new Error('notification_schema_incompatible');
    const constraints = await client.query(`SELECT
      count(*) FILTER (WHERE contype='c')=14 AS checks,
      count(*) FILTER (WHERE contype='f' AND confdeltype='r')=3 AS restrict_fks,
      count(*) FILTER (WHERE contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (id)')=1 AS primary_key,
      count(*) FILTER (WHERE contype='u' AND pg_get_constraintdef(oid)='UNIQUE (status_history_id, notification_type, recipient_role)')=1 AS event_unique
      FROM pg_constraint WHERE conrelid='store.notification_deliveries'::regclass`);
    if (Object.values(constraints.rows[0]).some(v => v !== true)) throw new Error('notification_constraints_incompatible');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  runNotificationMigration().then(closePool).catch(async () => {
    console.error('notification_migration_failed'); await closePool().catch(() => undefined); process.exitCode = 1;
  });
}
