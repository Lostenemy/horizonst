-- runMigrations applies every migration inside one BEGIN/COMMIT transaction.
-- This preflight deliberately performs no repair: inconsistent data must be
-- reviewed before the legacy overlay foreign keys are hardened.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM presence_operational_state
    WHERE tag_id IS NULL OR hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'presence_operational_state contains unexpected NULL overlay or central references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ble_alarm_sessions
    WHERE tag_id IS NULL OR hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions contains unexpected NULL overlay or central references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM presence_operational_state state
    LEFT JOIN tags overlay ON overlay.id = state.tag_id
    WHERE overlay.id IS NULL
  ) THEN
    RAISE EXCEPTION 'presence_operational_state contains orphan tag_id references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ble_alarm_sessions session
    LEFT JOIN tags overlay ON overlay.id = session.tag_id
    WHERE overlay.id IS NULL
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions contains orphan tag_id references';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'presence_operational_state'::regclass
      AND attname IN ('tag_id', 'hardware_device_id')
      AND attnotnull
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'presence_operational_state tag_id and hardware_device_id must be NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'ble_alarm_sessions'::regclass
      AND attname IN ('tag_id', 'hardware_device_id')
      AND attnotnull
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions tag_id and hardware_device_id must be NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'presence_operational_state_tag_id_fkey'
      AND conrelid = 'presence_operational_state'::regclass
      AND confrelid = 'tags'::regclass
      AND contype = 'f'
      AND confdeltype = 'c'
      AND pg_get_constraintdef(oid) = 'FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE'
  ) THEN
    RAISE EXCEPTION 'expected presence_operational_state_tag_id_fkey ON DELETE CASCADE was not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ble_alarm_sessions_tag_id_fkey'
      AND conrelid = 'ble_alarm_sessions'::regclass
      AND confrelid = 'tags'::regclass
      AND contype = 'f'
      AND confdeltype = 'c'
      AND pg_get_constraintdef(oid) = 'FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE'
  ) THEN
    RAISE EXCEPTION 'expected ble_alarm_sessions_tag_id_fkey ON DELETE CASCADE was not found';
  END IF;
END
$$;

ALTER TABLE presence_operational_state
  DROP CONSTRAINT presence_operational_state_tag_id_fkey,
  ADD CONSTRAINT presence_operational_state_tag_id_fkey
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE RESTRICT;

ALTER TABLE ble_alarm_sessions
  DROP CONSTRAINT ble_alarm_sessions_tag_id_fkey,
  ADD CONSTRAINT ble_alarm_sessions_tag_id_fkey
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE RESTRICT;

COMMENT ON COLUMN presence_operational_state.hardware_device_id IS
  'Identidad operativa obligatoria gobernada por Hardware Manager.';
COMMENT ON COLUMN presence_operational_state.tag_id IS
  'Referencia local e histórica al overlay tags de Horneo; no gobierna la identidad operativa.';
COMMENT ON COLUMN ble_alarm_sessions.hardware_device_id IS
  'Identidad operativa obligatoria gobernada por Hardware Manager.';
COMMENT ON COLUMN ble_alarm_sessions.tag_id IS
  'Referencia local e histórica al overlay tags de Horneo; no gobierna la identidad operativa.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM presence_operational_state state
    LEFT JOIN tags overlay ON overlay.id = state.tag_id
    WHERE state.tag_id IS NULL
       OR state.hardware_device_id IS NULL
       OR overlay.id IS NULL
  ) THEN
    RAISE EXCEPTION 'presence_operational_state postflight integrity check failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ble_alarm_sessions session
    LEFT JOIN tags overlay ON overlay.id = session.tag_id
    WHERE session.tag_id IS NULL
       OR session.hardware_device_id IS NULL
       OR overlay.id IS NULL
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions postflight integrity check failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'presence_operational_state_tag_id_fkey'
      AND conrelid = 'presence_operational_state'::regclass
      AND confrelid = 'tags'::regclass
      AND contype = 'f'
      AND confdeltype = 'r'
      AND pg_get_constraintdef(oid) = 'FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE RESTRICT'
  ) THEN
    RAISE EXCEPTION 'presence_operational_state_tag_id_fkey was not hardened to ON DELETE RESTRICT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ble_alarm_sessions_tag_id_fkey'
      AND conrelid = 'ble_alarm_sessions'::regclass
      AND confrelid = 'tags'::regclass
      AND contype = 'f'
      AND confdeltype = 'r'
      AND pg_get_constraintdef(oid) = 'FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE RESTRICT'
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions_tag_id_fkey was not hardened to ON DELETE RESTRICT';
  END IF;
END
$$;
