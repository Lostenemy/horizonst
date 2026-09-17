import fs from 'node:fs';
import path from 'node:path';
import { db } from './pool';

export async function runMigrations(): Promise<void> {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  await db.query(`
    CREATE TABLE IF NOT EXISTS cold_compliance_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const file of files) {
    const exists = await db.query('SELECT 1 FROM cold_compliance_migrations WHERE filename = $1', [file]);
    if (exists.rowCount) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO cold_compliance_migrations(filename) VALUES($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
