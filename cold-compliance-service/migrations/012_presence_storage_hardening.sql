-- Additive-only transition: no historical rows are deleted or rewritten here.
CREATE TABLE IF NOT EXISTS tag_gateway_presence_state (
  tag_uid TEXT NOT NULL,
  gateway_mac TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_presence_at TIMESTAMPTZ,
  last_rssi INT,
  last_battery INT,
  last_event_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tag_uid, gateway_mac),
  CHECK (tag_uid = lower(tag_uid) AND tag_uid !~ '[:-]'),
  CHECK (gateway_mac = lower(gateway_mac) AND gateway_mac !~ '[:-]')
);

CREATE INDEX IF NOT EXISTS idx_tag_gateway_presence_state_tag_seen
  ON tag_gateway_presence_state(tag_uid, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_tag_gateway_presence_state_presence
  ON tag_gateway_presence_state(tag_uid, last_presence_at DESC)
  WHERE last_presence_at IS NOT NULL;

-- Seed only currently open sessions so deploying the new reader cannot close a
-- valid legacy session merely because current-state writes had not started yet.
INSERT INTO tag_gateway_presence_state(
  tag_uid, gateway_mac, last_seen_at, last_presence_at, last_rssi, last_battery, last_event_id, updated_at
)
SELECT regexp_replace(lower(t.tag_uid), '[-:]', '', 'g'),
       regexp_replace(lower(latest.gateway_mac), '[-:]', '', 'g'),
       latest.event_ts, latest.event_ts, latest.rssi, latest.battery, latest.event_id, NOW()
FROM cold_room_sessions s
JOIN tags t ON t.id = s.tag_id
JOIN LATERAL (
  SELECT DISTINCT ON (pe.gateway_mac)
         pe.gateway_mac, pe.event_ts, pe.rssi, pe.battery, pe.event_id
  FROM presence_events pe
  WHERE pe.tag_uid = regexp_replace(lower(t.tag_uid), '[-:]', '', 'g')
    AND pe.event_ts >= s.started_at
    AND pe.event_type IN ('enter', 'heartbeat', 'movement')
  ORDER BY pe.gateway_mac, pe.event_ts DESC
) latest ON TRUE
WHERE s.ended_at IS NULL
ON CONFLICT (tag_uid, gateway_mac)
DO UPDATE SET last_seen_at = GREATEST(tag_gateway_presence_state.last_seen_at, EXCLUDED.last_seen_at),
              last_presence_at = GREATEST(tag_gateway_presence_state.last_presence_at, EXCLUDED.last_presence_at),
              last_rssi = EXCLUDED.last_rssi,
              last_battery = COALESCE(EXCLUDED.last_battery, tag_gateway_presence_state.last_battery),
              last_event_id = EXCLUDED.last_event_id,
              updated_at = NOW();

-- This fails safely if legacy duplicate open sessions exist. Operations must
-- resolve those rows explicitly; the migration never chooses a row to delete.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cold_room_sessions_one_open_per_tag
  ON cold_room_sessions(tag_id)
  WHERE ended_at IS NULL;

ALTER TABLE ble_alarm_sessions
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disconnect_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disconnect_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_ble_alarm_sessions_lease
  ON ble_alarm_sessions(lease_expires_at)
  WHERE is_active = TRUE;

-- Retention indexes on the multi-GB legacy tables are intentionally deferred;
-- creating them inside this transactional migrator could exhaust staging disk.
