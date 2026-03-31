CREATE TABLE IF NOT EXISTS presence_operational_state (
  tag_id UUID PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id),
  cold_room_id UUID REFERENCES cold_rooms(id),
  inside BOOLEAN NOT NULL DEFAULT FALSE,
  in_alarm BOOLEAN NOT NULL DEFAULT FALSE,
  in_grace BOOLEAN NOT NULL DEFAULT FALSE,
  grace_until TIMESTAMPTZ,
  grace_started_at TIMESTAMPTZ,
  last_alarm_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((in_grace = FALSE) OR (grace_until IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_presence_operational_state_inside ON presence_operational_state(inside) WHERE inside = TRUE;
CREATE INDEX IF NOT EXISTS idx_presence_operational_state_grace ON presence_operational_state(in_grace, grace_until) WHERE in_grace = TRUE;
