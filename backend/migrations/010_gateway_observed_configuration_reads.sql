-- Amplía el diario 009 sin modificar sus filas y conserva el significado
-- conservador de response_observed (no es un ACK correlacionado).
ALTER TABLE hardware_gateway_reads
  DROP CONSTRAINT hardware_gateway_reads_msg_id_check,
  DROP CONSTRAINT hardware_gateway_reads_read_type_check,
  DROP CONSTRAINT hardware_gateway_reads_status_check;

ALTER TABLE hardware_gateway_reads
  ADD CONSTRAINT hardware_gateway_reads_msg_type_check CHECK (
    (msg_id = 2002 AND read_type = 'gateway_identity') OR
    (msg_id = 2011 AND read_type = 'led_state') OR
    (msg_id = 2040 AND read_type = 'ble_scan_switch') OR
    (msg_id = 2041 AND read_type = 'filter_relation') OR
    (msg_id = 2057 AND read_type = 'duplicate_rule')
  ),
  ADD CONSTRAINT hardware_gateway_reads_status_check CHECK (
    status IN ('pending', 'published', 'response_observed', 'invalid_response', 'timed_out', 'publish_error')
  );

CREATE UNIQUE INDEX gateways_id_company_unique
  ON gateways(id, company_id);

CREATE TABLE hardware_gateway_observed_settings (
  gateway_id INTEGER NOT NULL,
  company_id UUID NOT NULL,
  read_type VARCHAR(64) NOT NULL CHECK (
    read_type IN ('led_state', 'ble_scan_switch', 'filter_relation', 'duplicate_rule')
  ),
  msg_id INTEGER NOT NULL,
  observed_value JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (gateway_id, read_type),
  CONSTRAINT hardware_gateway_observed_settings_gateway_company_fk
    FOREIGN KEY (gateway_id, company_id) REFERENCES gateways(id, company_id) ON DELETE CASCADE,
  CONSTRAINT hardware_gateway_observed_settings_msg_type_check CHECK (
    (msg_id = 2011 AND read_type = 'led_state') OR
    (msg_id = 2040 AND read_type = 'ble_scan_switch') OR
    (msg_id = 2041 AND read_type = 'filter_relation') OR
    (msg_id = 2057 AND read_type = 'duplicate_rule')
  ),
  CONSTRAINT hardware_gateway_observed_settings_value_check CHECK (
    jsonb_typeof(observed_value) = 'object' AND (
      (read_type = 'led_state'
        AND observed_value ?& ARRAY['net_led', 'sys_led', 'server_led']
        AND observed_value - ARRAY['net_led', 'sys_led', 'server_led']::text[] = '{}'::jsonb
        AND jsonb_typeof(observed_value->'net_led') = 'number'
        AND jsonb_typeof(observed_value->'sys_led') = 'number'
        AND jsonb_typeof(observed_value->'server_led') = 'number'
        AND observed_value->>'net_led' IN ('0', '1')
        AND observed_value->>'sys_led' IN ('0', '1')
        AND observed_value->>'server_led' IN ('0', '1'))
      OR (read_type = 'ble_scan_switch'
        AND observed_value ?& ARRAY['scan_switch']
        AND observed_value - ARRAY['scan_switch']::text[] = '{}'::jsonb
        AND jsonb_typeof(observed_value->'scan_switch') = 'number'
        AND observed_value->>'scan_switch' IN ('0', '1'))
      OR (read_type = 'filter_relation'
        AND observed_value ?& ARRAY['relation']
        AND observed_value - ARRAY['relation']::text[] = '{}'::jsonb
        AND jsonb_typeof(observed_value->'relation') = 'number'
        AND observed_value->>'relation' ~ '^[0-8]$')
      OR (read_type = 'duplicate_rule'
        AND observed_value ?& ARRAY['rule']
        AND observed_value - ARRAY['rule']::text[] = '{}'::jsonb
        AND jsonb_typeof(observed_value->'rule') = 'number'
        AND observed_value->>'rule' ~ '^[0-3]$')
    )
  )
);

CREATE INDEX idx_hardware_gateway_observed_settings_company
  ON hardware_gateway_observed_settings(company_id, observed_at DESC);

COMMENT ON TABLE hardware_gateway_observed_settings IS
  'Última configuración observada por gateway; los esquemas están validados solo para MKGW3 V2.0.12/function V2.4.';
COMMENT ON COLUMN hardware_gateway_observed_settings.observed_value IS
  'Valor tipado observado; no habilita capacidades de escritura ni constituye un ACK correlacionado.';
