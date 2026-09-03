DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM presence_operational_state
    WHERE hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'presence_operational_state contains rows without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT hardware_device_id
    FROM presence_operational_state
    WHERE hardware_device_id IS NOT NULL
    GROUP BY hardware_device_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'presence_operational_state contains duplicate hardware_device_id values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ble_alarm_sessions
    WHERE hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions contains rows without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT hardware_device_id
    FROM ble_alarm_sessions
    WHERE hardware_device_id IS NOT NULL
    GROUP BY hardware_device_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'ble_alarm_sessions contains duplicate hardware_device_id values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM worker_tag_assignments
    WHERE active = TRUE
      AND hardware_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'active worker_tag_assignments contain rows without hardware_device_id';
  END IF;

  IF EXISTS (
    SELECT hardware_device_id
    FROM worker_tag_assignments
    WHERE active = TRUE
      AND hardware_device_id IS NOT NULL
    GROUP BY hardware_device_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'a hardware device has more than one active worker assignment';
  END IF;

  IF EXISTS (
    SELECT worker_id
    FROM worker_tag_assignments
    WHERE active = TRUE
    GROUP BY worker_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'a worker has more than one active hardware assignment';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_tag_assignments_one_active_hardware_device
  ON worker_tag_assignments(hardware_device_id)
  WHERE active = TRUE
    AND hardware_device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_tag_assignments_one_active_worker
  ON worker_tag_assignments(worker_id)
  WHERE active = TRUE;
