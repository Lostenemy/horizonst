ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;
