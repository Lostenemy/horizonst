import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database
});

export const query = async <T>(text: string, params: any[] = []): Promise<T[]> => {
  const result = await pool.query<T>(text, params);
  return result.rows;
};
