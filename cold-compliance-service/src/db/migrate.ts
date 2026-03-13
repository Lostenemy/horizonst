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
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO cold_compliance_migrations(filename) VALUES($1)', [file]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
}
