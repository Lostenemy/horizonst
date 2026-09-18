-- Inventario declarado con evidencia; no se consulta hardware durante la migración.
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS product_model VARCHAR(64),
  ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS firmware_evidence VARCHAR(256),
  ADD COLUMN IF NOT EXISTS firmware_recorded_at TIMESTAMPTZ;

ALTER TABLE gateways
  ADD CONSTRAINT gateways_firmware_record_check CHECK (
    (product_model IS NULL AND firmware_version IS NULL AND firmware_evidence IS NULL AND firmware_recorded_at IS NULL)
    OR (product_model IS NOT NULL AND firmware_version IS NOT NULL AND firmware_evidence IS NOT NULL AND firmware_recorded_at IS NOT NULL)
  );

-- El ACK 1150 solo confirma aceptación; 3151 informa después del estado BLE.
ALTER TABLE hardware_gateway_commands
  ADD COLUMN IF NOT EXISTS connection_state VARCHAR(24),
  ADD COLUMN IF NOT EXISTS connection_report_at TIMESTAMPTZ;

ALTER TABLE hardware_gateway_commands
  ADD CONSTRAINT hardware_gateway_commands_connection_state_check CHECK (
    connection_state IS NULL OR connection_state IN ('awaiting_report', 'established', 'rejected', 'timed_out')
  );

COMMENT ON COLUMN gateways.firmware_evidence IS 'Referencia verificable de inspección/manual o lectura 2002 hecha fuera de esta migración; nunca un secreto.';
COMMENT ON COLUMN hardware_gateway_commands.connection_state IS 'Estado BLE asíncrono de 1150; ack_success solo acredita aceptación del comando.';
