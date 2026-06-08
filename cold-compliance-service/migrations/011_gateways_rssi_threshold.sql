ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS rssi_threshold INT NOT NULL DEFAULT -127;

ALTER TABLE gateways
  DROP CONSTRAINT IF EXISTS gateways_rssi_threshold_check;

ALTER TABLE gateways
  ADD CONSTRAINT gateways_rssi_threshold_check CHECK (rssi_threshold BETWEEN -127 AND 0);
