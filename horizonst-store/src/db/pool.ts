import pg from 'pg';
import { env } from '../config/env.js';
import { attachDatabaseLifecycle } from '../lifecycle.js';

export const pool = new pg.Pool(
  env.databaseUrl
    ? { connectionString: env.databaseUrl, connectionTimeoutMillis: 2_000 }
    : {
        host: env.db.host,
        port: env.db.port,
        user: env.db.user,
        password: env.db.password,
        database: env.db.database,
        connectionTimeoutMillis: 2_000
      }
);

export const databaseLifecycle = attachDatabaseLifecycle(pool);

export const closePool = async (): Promise<void> => {
  await databaseLifecycle.close();
};
