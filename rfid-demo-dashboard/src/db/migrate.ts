import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';
import { logger } from '../logger.js';

export const runMigrations = async (): Promise<void> => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationPath = path.resolve(__dirname, '../../migrations/001_rfid_demo_dashboard.sql');
  const sql = await readFile(migrationPath, 'utf8');
  await pool.query(sql);
  logger.info('Database migrations applied', { migrationPath });
};
