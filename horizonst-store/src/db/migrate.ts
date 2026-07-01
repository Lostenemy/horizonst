import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { closePool, pool } from './pool.js';

type QueryResult = { rowCount: number | null };
type MigrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  release: () => void;
};
type MigrationPool = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  connect: () => Promise<MigrationClient>;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const migrationsDir = path.join(root, 'migrations');

export const runMigrations = async (migrationPool: MigrationPool = pool, directory: string = migrationsDir): Promise<void> => {
  await migrationPool.query('CREATE SCHEMA IF NOT EXISTS store');
  await migrationPool.query(`CREATE TABLE IF NOT EXISTS store.schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const existing = await migrationPool.query('SELECT 1 FROM store.schema_migrations WHERE filename = $1', [file]);
    if (existing.rowCount) continue;
    const sql = await readFile(path.join(directory, file), 'utf8');
    const client = await migrationPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO store.schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

const isEntrypoint = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isEntrypoint) {
  runMigrations().then(closePool).catch(async (error) => {
    console.error(error);
    await closePool();
    process.exit(1);
  });
}
