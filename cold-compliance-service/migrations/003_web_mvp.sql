CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  dni TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('supervisor','administrador','superadministrador')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  password_hash TEXT NOT NULL,
  shift TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alarm_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  buzzer_shaker_minutes INT NOT NULL CHECK (buzzer_shaker_minutes > 0),
  alarm_minutes INT NOT NULL CHECK (alarm_minutes > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW worker_tag_assignments_history AS
SELECT a.*, w.full_name AS worker_name, t.tag_uid AS tag_mac
FROM worker_tag_assignments a
JOIN workers w ON w.id = a.worker_id
JOIN tags t ON t.id = a.tag_id;

INSERT INTO app_users(first_name, last_name, email, phone, dni, role, status, password_hash, shift)
VALUES(
  'Super',
  'Administrador',
  'super@horizonst.local',
  NULL,
  'SUPER0001',
  'superadministrador',
  'active',
  crypt('20025@BLELoRa?', gen_salt('bf')),
  'general'
)
ON CONFLICT (email) DO NOTHING;
