INSERT INTO companies(code, name, active)
VALUES ('horneo', 'Horneo', TRUE)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    active = TRUE,
    updated_at = NOW();

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS rssi_threshold INTEGER NOT NULL DEFAULT -127;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gateways_rssi_threshold_check'
  ) THEN
    ALTER TABLE gateways ADD CONSTRAINT gateways_rssi_threshold_check
      CHECK (rssi_threshold BETWEEN -127 AND 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_principals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(64) NOT NULL UNIQUE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_principals_code_format CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CONSTRAINT service_principals_scopes_check CHECK (scopes <@ ARRAY['hardware.read']::TEXT[])
);
CREATE INDEX IF NOT EXISTS idx_service_principals_company
  ON service_principals(company_id, active, code);

CREATE TABLE IF NOT EXISTS service_principal_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_principal_id UUID NOT NULL REFERENCES service_principals(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_hint VARCHAR(16) NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  rotated_from_token_id UUID REFERENCES service_principal_tokens(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_service_tokens_principal_active
  ON service_principal_tokens(service_principal_id, created_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE technical_audit_log
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(16) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS actor_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS actor_service_id UUID REFERENCES service_principals(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS hardware_gateway_commands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gateway_id INTEGER NOT NULL REFERENCES gateways(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  msg_id INTEGER NOT NULL,
  command_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  actor_type VARCHAR(16) NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_service_id UUID REFERENCES service_principals(id) ON DELETE SET NULL,
  actor_code VARCHAR(64),
  request_id VARCHAR(128),
  idempotency_key VARCHAR(128),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 120000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  ack_at TIMESTAMPTZ,
  ack_msg_id INTEGER,
  result_code INTEGER,
  result_message TEXT,
  response_payload JSONB,
  CONSTRAINT hardware_gateway_commands_status_check CHECK (
    status IN ('pending', 'published', 'ack_success', 'ack_error', 'timed_out', 'publish_error')
  ),
  CONSTRAINT hardware_gateway_commands_actor_check CHECK (
    (actor_type = 'user' AND actor_user_id IS NOT NULL AND actor_service_id IS NULL)
    OR (actor_type = 'service' AND actor_user_id IS NULL AND actor_service_id IS NOT NULL)
    OR (actor_type = 'system' AND actor_user_id IS NULL AND actor_service_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_hardware_gateway_commands_gateway_created
  ON hardware_gateway_commands(gateway_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hardware_gateway_commands_company_created
  ON hardware_gateway_commands(company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hardware_gateway_commands_active_gateway
  ON hardware_gateway_commands(gateway_id)
  WHERE status IN ('pending', 'published');
CREATE UNIQUE INDEX IF NOT EXISTS uq_hardware_gateway_commands_idempotency
  ON hardware_gateway_commands(company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
