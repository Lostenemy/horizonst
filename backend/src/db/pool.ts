import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config';
import { attachDatabaseLifecycle } from '../lifecycle';

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
  connectionTimeoutMillis: 2_000
});

export const databaseLifecycle = attachDatabaseLifecycle(pool);

export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: any[] = []
): Promise<QueryResult<T>> => {
  return pool.query<T>(text, params);
};
