-- Identidad observada mediante la lectura MQTT 2002. No modifica datos existentes.
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS reported_device_name VARCHAR(64),
  ADD COLUMN IF NOT EXISTS reported_product_model VARCHAR(64),
  ADD COLUMN IF NOT EXISTS reported_ble_mac CHAR(12),
  ADD COLUMN IF NOT EXISTS reported_eth_mac CHAR(12),
  ADD COLUMN IF NOT EXISTS reported_company_name VARCHAR(128),
  ADD COLUMN IF NOT EXISTS reported_hardware_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS reported_software_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS reported_firmware_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS reported_function_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS reported_sl_ble_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS identity_observed_at TIMESTAMPTZ;

ALTER TABLE gateways
  ADD CONSTRAINT gateways_reported_identity_check CHECK (
    (reported_device_name IS NULL AND reported_product_model IS NULL
      AND reported_ble_mac IS NULL AND reported_eth_mac IS NULL
      AND reported_company_name IS NULL AND reported_hardware_version IS NULL
      AND reported_software_version IS NULL AND reported_firmware_version IS NULL
      AND reported_function_version IS NULL AND reported_sl_ble_version IS NULL
      AND identity_observed_at IS NULL)
    OR
    (reported_device_name IS NOT NULL AND reported_product_model IS NOT NULL
      AND reported_ble_mac ~ '^[0-9a-f]{12}$' AND reported_eth_mac ~ '^[0-9a-f]{12}$'
      AND reported_company_name IS NOT NULL AND reported_hardware_version IS NOT NULL
      AND reported_software_version IS NOT NULL AND reported_firmware_version IS NOT NULL
      AND reported_function_version IS NOT NULL AND reported_sl_ble_version IS NOT NULL
      AND identity_observed_at IS NOT NULL)
  );

CREATE TABLE hardware_gateway_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gateway_id INTEGER NOT NULL REFERENCES gateways(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  msg_id INTEGER NOT NULL CHECK (msg_id = 2002),
  read_type VARCHAR(64) NOT NULL CHECK (read_type = 'gateway_identity'),
  request_payload JSONB NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'published', 'response_observed', 'timed_out', 'publish_error')
  ),
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id VARCHAR(128),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 120000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  response_observed_at TIMESTAMPTZ,
  response_payload JSONB,
  error_message TEXT
);

CREATE INDEX idx_hardware_gateway_reads_gateway_created
  ON hardware_gateway_reads(gateway_id, created_at DESC);
CREATE INDEX idx_hardware_gateway_reads_company_created
  ON hardware_gateway_reads(company_id, created_at DESC);
CREATE UNIQUE INDEX uq_hardware_gateway_reads_active_gateway
  ON hardware_gateway_reads(gateway_id) WHERE status IN ('pending', 'published');

COMMENT ON TABLE hardware_gateway_reads IS
  'Diario de lecturas técnicas; response_observed no implica correlación inequívoca con la solicitud.';
COMMENT ON COLUMN gateways.identity_observed_at IS
  'Fecha de una respuesta MQTT 2002 válida observada para la MAC central activa.';
