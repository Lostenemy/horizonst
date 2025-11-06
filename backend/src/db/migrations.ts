import { pool } from './pool';

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
      ALTER COLUMN retain SET DEFAULT FALSE`
];

export const runMigrations = async (): Promise<void> => {
  for (const text of statements) {
    await pool.query(text);
  }
};

