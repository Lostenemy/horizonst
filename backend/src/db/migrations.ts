import { pool } from './pool';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS category_photos (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES device_categories(id) ON DELETE CASCADE,
      title VARCHAR(160),
      image_data TEXT NOT NULL,
      mime_type TEXT,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`,
  `CREATE TABLE IF NOT EXISTS place_photos (
      id SERIAL PRIMARY KEY,
      place_id INTEGER REFERENCES places(id) ON DELETE CASCADE,
      title VARCHAR(160),
      image_data TEXT NOT NULL,
      mime_type TEXT,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`,
  `ALTER TABLE category_photos
      ADD COLUMN IF NOT EXISTS title VARCHAR(160),
      ADD COLUMN IF NOT EXISTS image_data TEXT,
      ADD COLUMN IF NOT EXISTS mime_type TEXT,
      ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`,
  `ALTER TABLE place_photos
      ADD COLUMN IF NOT EXISTS title VARCHAR(160),
      ADD COLUMN IF NOT EXISTS image_data TEXT,
      ADD COLUMN IF NOT EXISTS mime_type TEXT,
      ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`,
  `UPDATE category_photos SET image_data = '' WHERE image_data IS NULL`,
  `ALTER TABLE category_photos ALTER COLUMN image_data SET NOT NULL`,
  `UPDATE place_photos SET image_data = '' WHERE image_data IS NULL`,
  `ALTER TABLE place_photos ALTER COLUMN image_data SET NOT NULL`,
  `ALTER TABLE mqtt_messages
      ADD COLUMN IF NOT EXISTS payload_raw TEXT,
      ADD COLUMN IF NOT EXISTS payload_encoding TEXT DEFAULT 'plain',
      ADD COLUMN IF NOT EXISTS client_id TEXT,
      ADD COLUMN IF NOT EXISTS qos SMALLINT,
      ADD COLUMN IF NOT EXISTS retain BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE mqtt_messages
      ALTER COLUMN payload_encoding SET DEFAULT 'plain'`,
  `ALTER TABLE mqtt_messages
      ALTER COLUMN retain SET DEFAULT FALSE`,
  `CREATE TABLE IF NOT EXISTS rfid_cards (
      id SERIAL PRIMARY KEY,
      card_uid VARCHAR(64) UNIQUE NOT NULL,
      dni VARCHAR(20) NOT NULL,
      first_name VARCHAR(120) NOT NULL,
      last_name VARCHAR(160) NOT NULL,
      company_name VARCHAR(180) NOT NULL,
      company_cif VARCHAR(32) NOT NULL,
      center_code VARCHAR(64) NOT NULL,
      notes TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`,
  `CREATE TABLE IF NOT EXISTS rfid_access_logs (
      id BIGSERIAL PRIMARY KEY,
      card_uid VARCHAR(64) NOT NULL,
      dni VARCHAR(20),
      center_code VARCHAR(64),
      company_cif VARCHAR(32),
      antenna_id VARCHAR(64),
      direction VARCHAR(16),
      reader_id VARCHAR(64),
      event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      access_allowed BOOLEAN,
      api_status VARCHAR(32),
      api_error TEXT,
      request_payload JSONB,
      api_response JSONB,
      raw_message TEXT,
      gpio_command_topic TEXT,
      gpio_command_payload TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_rfid_cards_uid ON rfid_cards(card_uid)`,
  `CREATE INDEX IF NOT EXISTS idx_rfid_access_logs_card ON rfid_access_logs(card_uid)`,
  `CREATE INDEX IF NOT EXISTS idx_rfid_access_logs_created ON rfid_access_logs(created_at DESC)`
];

const runVersionedMigrations = async (): Promise<void> => {
  const migrationsDir = process.env.APP_MIGRATIONS_DIR || path.resolve(__dirname, '..', '..', 'migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS app_schema_migrations (
       name TEXT PRIMARY KEY,
       checksum TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );

  for (const name of files) {
    const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const existing = await pool.query<{ checksum: string }>(
      'SELECT checksum FROM app_schema_migrations WHERE name = $1',
      [name]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration checksum mismatch: ${name}`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO app_schema_migrations(name, checksum) VALUES($1, $2)',
        [name, checksum]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

export const runMigrations = async (): Promise<void> => {
  for (const text of statements) {
    await pool.query(text);
  }
  await runVersionedMigrations();
};

