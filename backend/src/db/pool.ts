import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database
});

export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: any[] = []
): Promise<QueryResult<T>> => {
  return pool.query<T>(text, params);
};
