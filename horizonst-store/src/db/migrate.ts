import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, pool } from './pool.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const migrationsDir = path.join(root, 'migrations');

const run = async (): Promise<void> => {
  await pool.query('CREATE SCHEMA IF NOT EXISTS store');
  await pool.query(`CREATE TABLE IF NOT EXISTS store.schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const existing = await pool.query('SELECT 1 FROM store.schema_migrations WHERE filename = $1', [file]);
    if (existing.rowCount) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO store.schema_migrations (filename) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

run().then(closePool).catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
