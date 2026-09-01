ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS hardware_gateway_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gateways_hardware_gateway_id
  ON gateways(hardware_gateway_id)
  WHERE hardware_gateway_id IS NOT NULL;

COMMENT ON COLUMN gateways.hardware_gateway_id IS
  'Referencia lógica a horizonst.gateways.id. No existe FK SQL porque horizonst y cold_compliance son bases distintas.';
