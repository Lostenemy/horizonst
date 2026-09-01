CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT companies_code_format CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CONSTRAINT companies_code_unique UNIQUE (code)
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(32);
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('ADMIN', 'USER', 'hardware_readonly', 'hardware_technician', 'hardware_superadmin')
);

CREATE TABLE IF NOT EXISTS company_user_memberships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  role VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, company_id),
  CONSTRAINT company_membership_role_check CHECK (
    role IN ('hardware_readonly', 'hardware_technician')
  )
);
CREATE INDEX IF NOT EXISTS idx_company_memberships_company
  ON company_user_memberships(company_id, user_id);

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_gateways_company
  ON gateways(company_id, active, id);

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(32) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devices_device_type_check'
  ) THEN
    ALTER TABLE devices ADD CONSTRAINT devices_device_type_check CHECK (
      device_type IN ('tag', 'b5', 'sensor', 'beacon', 'unknown')
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devices_status_check'
  ) THEN
    ALTER TABLE devices ADD CONSTRAINT devices_status_check CHECK (
      status IN ('active', 'inactive', 'maintenance', 'retired', 'unknown')
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_devices_company
  ON devices(company_id, active, id);
CREATE INDEX IF NOT EXISTS idx_devices_company_type
  ON devices(company_id, device_type);

CREATE TABLE IF NOT EXISTS technical_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(96) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id TEXT NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  request_id VARCHAR(128),
  result VARCHAR(32) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_technical_audit_company_created
  ON technical_audit_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_technical_audit_entity_created
  ON technical_audit_log(entity_type, entity_id, created_at DESC);
