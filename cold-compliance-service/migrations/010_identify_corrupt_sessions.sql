-- Detect potentially corrupt historical sessions caused by gateway-relative timestamps.
-- This migration DOES NOT modify existing rows in cold_room_sessions.

CREATE TABLE IF NOT EXISTS cold_room_sessions_corruption_review (
  session_id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_seconds integer,
  source_event_id text,
  payload_timestamp text,
  detected_reason text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT NOW(),
  reviewed boolean NOT NULL DEFAULT false,
  reviewer_notes text
);

INSERT INTO cold_room_sessions_corruption_review (
  session_id,
  started_at,
  ended_at,
  duration_seconds,
  source_event_id,
  payload_timestamp,
  detected_reason
)
SELECT
  s.id,
  s.started_at,
  s.ended_at,
  s.duration_seconds,
  s.source_event_id,
  pe.payload->>'timestamp' AS payload_timestamp,
  CASE
    WHEN s.started_at < '2025-01-01T00:00:00Z'::timestamptz THEN 'started_at_before_2025'
    ELSE 'absurd_duration_seconds'
  END AS detected_reason
FROM cold_room_sessions s
LEFT JOIN presence_events pe ON pe.event_id = s.source_event_id
WHERE s.started_at < '2025-01-01T00:00:00Z'::timestamptz
   OR COALESCE(s.duration_seconds, EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))::int) > 259200
ON CONFLICT (session_id) DO UPDATE
SET started_at = EXCLUDED.started_at,
    ended_at = EXCLUDED.ended_at,
    duration_seconds = EXCLUDED.duration_seconds,
    source_event_id = EXCLUDED.source_event_id,
    payload_timestamp = EXCLUDED.payload_timestamp,
    detected_reason = EXCLUDED.detected_reason,
    detected_at = NOW();
