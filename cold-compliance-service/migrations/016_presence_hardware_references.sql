-- Additive logical references to the central Hardware Manager. They are not
-- foreign keys because the authoritative rows live in a separate database.
ALTER TABLE tag_gateway_presence_state
  ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER,
  ADD COLUMN IF NOT EXISTS hardware_gateway_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_tag_gateway_presence_state_hardware
  ON tag_gateway_presence_state(hardware_device_id, hardware_gateway_id, last_presence_at DESC)
  WHERE hardware_device_id IS NOT NULL AND hardware_gateway_id IS NOT NULL;

COMMENT ON COLUMN tag_gateway_presence_state.hardware_device_id IS
  'Logical reference to Hardware Manager devices.id; nullable for historical/fallback observations.';
COMMENT ON COLUMN tag_gateway_presence_state.hardware_gateway_id IS
  'Logical reference to Hardware Manager gateways.id; nullable for historical/fallback observations.';
