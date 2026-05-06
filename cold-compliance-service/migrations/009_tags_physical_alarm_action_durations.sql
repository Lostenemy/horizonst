ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS physical_alarm_buzzer_duration_ms INT,
  ADD COLUMN IF NOT EXISTS physical_alarm_vibration_duration_ms INT;

UPDATE tags
SET physical_alarm_buzzer_duration_ms = 3000
WHERE physical_alarm_buzzer_duration_ms IS NULL
   OR physical_alarm_buzzer_duration_ms < 100
   OR physical_alarm_buzzer_duration_ms > 60000;

UPDATE tags
SET physical_alarm_vibration_duration_ms = 3000
WHERE physical_alarm_vibration_duration_ms IS NULL
   OR physical_alarm_vibration_duration_ms < 100
   OR physical_alarm_vibration_duration_ms > 60000;

ALTER TABLE tags
  ALTER COLUMN physical_alarm_buzzer_duration_ms SET DEFAULT 3000,
  ALTER COLUMN physical_alarm_buzzer_duration_ms SET NOT NULL,
  ALTER COLUMN physical_alarm_vibration_duration_ms SET DEFAULT 3000,
  ALTER COLUMN physical_alarm_vibration_duration_ms SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tags_physical_alarm_buzzer_duration_ms_range'
  ) THEN
    ALTER TABLE tags
      ADD CONSTRAINT tags_physical_alarm_buzzer_duration_ms_range
      CHECK (physical_alarm_buzzer_duration_ms BETWEEN 100 AND 60000) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tags_physical_alarm_vibration_duration_ms_range'
  ) THEN
    ALTER TABLE tags
      ADD CONSTRAINT tags_physical_alarm_vibration_duration_ms_range
      CHECK (physical_alarm_vibration_duration_ms BETWEEN 100 AND 60000) NOT VALID;
  END IF;
END $$;

ALTER TABLE tags
  VALIDATE CONSTRAINT tags_physical_alarm_buzzer_duration_ms_range,
  VALIDATE CONSTRAINT tags_physical_alarm_vibration_duration_ms_range;
