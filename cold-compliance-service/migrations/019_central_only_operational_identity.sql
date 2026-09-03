UPDATE tag_gateway_presence_state presence
SET hardware_device_id = tag.hardware_device_id
FROM tags tag
WHERE presence.hardware_device_id IS NULL
  AND presence.tag_uid = regexp_replace(lower(tag.tag_uid), '[-:]', '', 'g');

UPDATE tag_gateway_presence_state presence
SET hardware_gateway_id = gateway.hardware_gateway_id
FROM gateways gateway
WHERE presence.hardware_gateway_id IS NULL
  AND presence.gateway_mac = regexp_replace(lower(gateway.gateway_mac), '[-:]', '', 'g');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tags WHERE hardware_device_id IS NULL) THEN
    RAISE EXCEPTION 'tags contains rows without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT hardware_device_id FROM tags
    GROUP BY hardware_device_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'tags contains duplicate hardware_device_id values';
  END IF;

  IF EXISTS (SELECT 1 FROM gateways WHERE hardware_gateway_id IS NULL) THEN
    RAISE EXCEPTION 'gateways contains rows without hardware_gateway_id';
  END IF;

  IF EXISTS (
    SELECT hardware_gateway_id FROM gateways
    GROUP BY hardware_gateway_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'gateways contains duplicate hardware_gateway_id values';
  END IF;

  IF EXISTS (SELECT 1 FROM worker_tag_assignments WHERE hardware_device_id IS NULL) THEN
    RAISE EXCEPTION 'worker_tag_assignments contains rows without hardware_device_id';
  END IF;

  IF EXISTS (SELECT 1 FROM cold_room_sessions WHERE hardware_device_id IS NULL) THEN
    RAISE EXCEPTION 'cold_room_sessions contains rows without hardware_device_id';
  END IF;

  IF EXISTS (SELECT 1 FROM ble_alarm_sessions WHERE hardware_device_id IS NULL) THEN
    RAISE EXCEPTION 'ble_alarm_sessions contains rows without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT hardware_device_id FROM ble_alarm_sessions
    GROUP BY hardware_device_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions contains duplicate hardware_device_id values';
  END IF;

  IF EXISTS (SELECT 1 FROM presence_operational_state WHERE hardware_device_id IS NULL) THEN
    RAISE EXCEPTION 'presence_operational_state contains rows without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT hardware_device_id FROM presence_operational_state
    GROUP BY hardware_device_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'presence_operational_state contains duplicate hardware_device_id values';
  END IF;

  IF EXISTS (
    SELECT worker_id, hardware_device_id, assigned_at
    FROM worker_tag_assignments
    GROUP BY worker_id, hardware_device_id, assigned_at
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'worker_tag_assignments contains duplicate central assignment history';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tag_gateway_presence_state
    WHERE hardware_device_id IS NULL
       OR hardware_gateway_id IS NULL
  ) THEN
    RAISE EXCEPTION 'tag_gateway_presence_state contains rows without complete central identity';
  END IF;

  IF EXISTS (
    SELECT hardware_device_id, hardware_gateway_id
    FROM tag_gateway_presence_state
    GROUP BY hardware_device_id, hardware_gateway_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'tag_gateway_presence_state contains duplicate central device/gateway pairs';
  END IF;
END
$$;

ALTER TABLE tags
  ALTER COLUMN hardware_device_id SET NOT NULL;

ALTER TABLE gateways
  ALTER COLUMN hardware_gateway_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_hardware_device_id_required
  ON tags(hardware_device_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gateways_hardware_gateway_id_required
  ON gateways(hardware_gateway_id);

DROP INDEX IF EXISTS uq_tags_hardware_device_id;
DROP INDEX IF EXISTS uq_gateways_hardware_gateway_id;

ALTER TABLE worker_tag_assignments
  ALTER COLUMN hardware_device_id SET NOT NULL;

ALTER TABLE cold_room_sessions
  ALTER COLUMN hardware_device_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_worker_tag_assignments_central_history'
      AND conrelid = 'worker_tag_assignments'::regclass
  ) THEN
    ALTER TABLE worker_tag_assignments
      ADD CONSTRAINT uq_worker_tag_assignments_central_history
      UNIQUE (worker_id, hardware_device_id, assigned_at);
  END IF;
END
$$;

ALTER TABLE worker_tag_assignments
  DROP CONSTRAINT IF EXISTS worker_tag_assignments_worker_id_tag_id_assigned_at_key;

DROP INDEX IF EXISTS uq_cold_room_sessions_one_open_per_tag;
DROP INDEX IF EXISTS idx_cold_room_sessions_active;

ALTER TABLE tag_gateway_presence_state
  DROP CONSTRAINT IF EXISTS tag_gateway_presence_state_pkey,
  ALTER COLUMN hardware_device_id SET NOT NULL,
  ALTER COLUMN hardware_gateway_id SET NOT NULL;

ALTER TABLE tag_gateway_presence_state
  ADD CONSTRAINT tag_gateway_presence_state_pkey
  PRIMARY KEY (hardware_device_id, hardware_gateway_id);

ALTER TABLE presence_operational_state
  DROP CONSTRAINT IF EXISTS presence_operational_state_pkey,
  ALTER COLUMN hardware_device_id SET NOT NULL;

ALTER TABLE presence_operational_state
  ADD CONSTRAINT presence_operational_state_pkey PRIMARY KEY (hardware_device_id);

DROP INDEX IF EXISTS uq_presence_operational_state_hardware_device_id;

ALTER TABLE ble_alarm_sessions
  DROP CONSTRAINT IF EXISTS ble_alarm_sessions_pkey,
  ALTER COLUMN hardware_device_id SET NOT NULL;

ALTER TABLE ble_alarm_sessions
  ADD CONSTRAINT ble_alarm_sessions_pkey PRIMARY KEY (hardware_device_id);

DROP INDEX IF EXISTS uq_ble_alarm_sessions_hardware_device_id;

COMMENT ON TABLE tags IS
  'Overlay operativo de Horneo para dispositivos cuya identidad técnica pertenece a Hardware Manager.';

COMMENT ON TABLE gateways IS
  'Overlay operativo de Horneo para gateways cuya identidad técnica pertenece a Hardware Manager.';

COMMENT ON COLUMN tag_gateway_presence_state.hardware_device_id IS
  'Identidad operativa obligatoria del dispositivo en Hardware Manager.';

COMMENT ON COLUMN tag_gateway_presence_state.hardware_gateway_id IS
  'Identidad operativa obligatoria del gateway en Hardware Manager.';
