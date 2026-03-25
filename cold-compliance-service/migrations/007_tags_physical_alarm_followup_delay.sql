ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS physical_alarm_followup_delay_ms INT NOT NULL DEFAULT 45000 CHECK (physical_alarm_followup_delay_ms >= 0);
