import { Pool } from 'pg';
import { env } from '../config/env';
import { attachDatabaseLifecycle } from '../lifecycle';

export const db = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  max: 20,
  connectionTimeoutMillis: 2_000
});

export const databaseLifecycle = attachDatabaseLifecycle(db);
