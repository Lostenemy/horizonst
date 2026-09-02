ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_hardware_device_id
  ON tags(hardware_device_id)
  WHERE hardware_device_id IS NOT NULL;

COMMENT ON COLUMN tags.hardware_device_id IS
  'Logical cross-database reference to horizonst.devices.id; deliberately no PostgreSQL foreign key.';
