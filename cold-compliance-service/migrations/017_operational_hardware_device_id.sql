ALTER TABLE worker_tag_assignments
  ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER;

ALTER TABLE cold_room_sessions
  ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER;

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER;

ALTER TABLE ble_alarm_sessions
  ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER;

ALTER TABLE presence_operational_state
  ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER;

UPDATE worker_tag_assignments
SET hardware_device_id = t.hardware_device_id
FROM tags t
WHERE worker_tag_assignments.tag_id = t.id
  AND worker_tag_assignments.hardware_device_id IS NULL;

UPDATE cold_room_sessions
SET hardware_device_id = t.hardware_device_id
FROM tags t
WHERE cold_room_sessions.tag_id = t.id
  AND cold_room_sessions.hardware_device_id IS NULL;

UPDATE alerts
SET hardware_device_id = t.hardware_device_id
FROM tags t
WHERE alerts.tag_id = t.id
  AND alerts.hardware_device_id IS NULL;

UPDATE incidents
SET hardware_device_id = t.hardware_device_id
FROM tags t
WHERE incidents.tag_id = t.id
  AND incidents.hardware_device_id IS NULL;

UPDATE ble_alarm_sessions
SET hardware_device_id = t.hardware_device_id
FROM tags t
WHERE ble_alarm_sessions.tag_id = t.id
  AND ble_alarm_sessions.hardware_device_id IS NULL;

UPDATE presence_operational_state
SET hardware_device_id = t.hardware_device_id
FROM tags t
WHERE presence_operational_state.tag_id = t.id
  AND presence_operational_state.hardware_device_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM worker_tag_assignments
    WHERE tag_id IS NOT NULL AND hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'worker_tag_assignments contains tag references without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cold_room_sessions
    WHERE tag_id IS NOT NULL AND hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'cold_room_sessions contains tag references without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM alerts
    WHERE tag_id IS NOT NULL AND hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'alerts contains tag references without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM incidents
    WHERE tag_id IS NOT NULL AND hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'incidents contains tag references without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ble_alarm_sessions
    WHERE tag_id IS NOT NULL AND hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions contains tag references without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM presence_operational_state
    WHERE tag_id IS NOT NULL AND hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'presence_operational_state contains tag references without hardware_device_id';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_worker_tag_assignments_hardware_device_id
  ON worker_tag_assignments(hardware_device_id)
  WHERE hardware_device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cold_room_sessions_hardware_device_id
  ON cold_room_sessions(hardware_device_id)
  WHERE hardware_device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_hardware_device_id
  ON alerts(hardware_device_id)
  WHERE hardware_device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_hardware_device_id
  ON incidents(hardware_device_id)
  WHERE hardware_device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ble_alarm_sessions_hardware_device_id
  ON ble_alarm_sessions(hardware_device_id)
  WHERE hardware_device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_presence_operational_state_hardware_device_id
  ON presence_operational_state(hardware_device_id)
  WHERE hardware_device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cold_room_sessions_one_open_per_hardware_device
  ON cold_room_sessions(hardware_device_id)
  WHERE ended_at IS NULL
    AND hardware_device_id IS NOT NULL;
