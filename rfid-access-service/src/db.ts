import { Pool, QueryResult, QueryResultRow } from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

let pool: Pool | null = null;
const databaseName = config.db.database.replace(/[^a-zA-Z0-9_-]/g, '');

const getAdminPool = (): Pool => {
  return new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.adminDatabase,
    ssl: config.db.ssl
  });
};

const createDatabaseIfMissing = async (): Promise<void> => {
  const adminPool = getAdminPool();
  try {
    const existing = await adminPool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) as exists',
      [databaseName]
    );

    if (!existing.rows[0]?.exists) {
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      logger.info({ database: databaseName }, 'Created RFID access database');
    }
  } finally {
    await adminPool.end();
  }
};

const ensureSchema = async (client: Pool): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workers (
      dni TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      apellidos TEXT NOT NULL,
      empresa TEXT NOT NULL,
      cif TEXT NOT NULL,
      centro TEXT NOT NULL,
      email TEXT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id_tarjeta TEXT PRIMARY KEY,
      dni TEXT REFERENCES workers(dni) ON DELETE SET NULL,
      centro TEXT,
      estado TEXT NOT NULL DEFAULT 'activa',
      notas TEXT,
      asignada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

const seedInitialData = async (client: Pool): Promise<void> => {
  const { rows: workerCount } = await client.query<{ count: string }>('SELECT COUNT(*) AS count FROM workers');
  if (Number.parseInt(workerCount[0]?.count ?? '0', 10) === 0) {
    await client.query(
      `INSERT INTO workers (dni, nombre, apellidos, empresa, cif, centro, email, activo)
       VALUES
       ('12345678A', 'María', 'García Ruiz', 'Instalaciones Norte S.L.', 'B12345678', 'C-VAL-001', 'maria.garcia@example.com', TRUE),
       ('98765432B', 'Diego', 'Martín Ortega', 'Elecnor Proyectos', 'A87654321', 'C-MAD-023', 'diego.martin@example.com', TRUE),
       ('44556677C', 'Laura', 'Santos Pérez', 'Logística Sur', 'B19283746', 'C-BCN-012', 'laura.santos@example.com', FALSE)
      ;`
    );
  }

  const { rows: cardCount } = await client.query<{ count: string }>('SELECT COUNT(*) AS count FROM cards');
  if (Number.parseInt(cardCount[0]?.count ?? '0', 10) === 0) {
    await client.query(
      `INSERT INTO cards (id_tarjeta, dni, centro, estado, notas)
       VALUES
       ('RFID-0001', '12345678A', 'C-VAL-001', 'activa', 'Acceso a nave principal'),
       ('RFID-0002', '98765432B', 'C-MAD-023', 'activa', 'Autorización completa');`
    );
  }
};

export const initDatabase = async (): Promise<Pool> => {
  if (pool) {
    return pool;
  }

  await createDatabaseIfMissing();
  pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: databaseName,
    ssl: config.db.ssl
  });

  await ensureSchema(pool);
  await seedInitialData(pool);

  return pool;
};

export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> => {
  if (!pool) {
    await initDatabase();
  }
  return (pool as Pool).query<T>(text, params);
};

export const queryRows = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> => {
  const { rows } = await query<T>(text, params);
  return rows;
};

export const db = {
  query,
  queryRows
};
