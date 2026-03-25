CREATE TABLE IF NOT EXISTS ble_alarm_sessions (
  tag_id UUID PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
  tag_uid TEXT NOT NULL,
  gateway_mac TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ble_alarm_sessions_active ON ble_alarm_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_ble_alarm_sessions_tag_uid ON ble_alarm_sessions(tag_uid);
