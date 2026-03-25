ALTER TABLE alarm_rules
  ADD COLUMN IF NOT EXISTS alarm_visibility_grace_minutes INT NOT NULL DEFAULT 15 CHECK (alarm_visibility_grace_minutes > 0);
