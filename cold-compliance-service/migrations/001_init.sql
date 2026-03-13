CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dni TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  plant_id UUID REFERENCES plants(id),
  role TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_uid TEXT UNIQUE NOT NULL,
  model TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker_tag_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id),
  tag_id UUID NOT NULL REFERENCES tags(id),
  assigned_at TIMESTAMPTZ NOT NULL,
  unassigned_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (worker_id, tag_id, assigned_at)
);
CREATE INDEX IF NOT EXISTS idx_worker_tag_assignments_active ON worker_tag_assignments(worker_id, tag_id) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS cold_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID REFERENCES plants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  target_temperature NUMERIC(5,2),
  max_continuous_minutes INT NOT NULL DEFAULT 45,
  pre_alert_minutes INT NOT NULL DEFAULT 40,
  required_break_minutes INT NOT NULL DEFAULT 15,
  max_daily_minutes INT NOT NULL DEFAULT 360,
  dead_man_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dead_man_minutes INT NOT NULL DEFAULT 3,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plant_id, code)
);

CREATE TABLE IF NOT EXISTS gateways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_mac TEXT UNIQUE NOT NULL,
  cold_room_id UUID REFERENCES cold_rooms(id),
  plant_id UUID REFERENCES plants(id),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presence_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  gateway_mac TEXT NOT NULL,
  tag_uid TEXT NOT NULL,
  camera_code TEXT,
  event_type TEXT NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL,
  rssi INT,
  battery INT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presence_events_tag_ts ON presence_events(tag_uid, event_ts DESC);

CREATE TABLE IF NOT EXISTS cold_room_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID REFERENCES workers(id),
  tag_id UUID REFERENCES tags(id),
  cold_room_id UUID REFERENCES cold_rooms(id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  source_event_id TEXT UNIQUE,
  close_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cold_room_sessions_active ON cold_room_sessions(tag_id, started_at DESC) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS workday_accumulators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workday_date DATE NOT NULL,
  worker_id UUID REFERENCES workers(id),
  cold_room_id UUID REFERENCES cold_rooms(id),
  accumulated_seconds INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workday_date, worker_id, cold_room_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID REFERENCES workers(id),
  tag_id UUID REFERENCES tags(id),
  cold_room_id UUID REFERENCES cold_rooms(id),
  severity TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID REFERENCES workers(id),
  tag_id UUID REFERENCES tags(id),
  cold_room_id UUID REFERENCES cold_rooms(id),
  incident_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_by TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  author_user TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retries INT NOT NULL DEFAULT 0,
  last_error TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_type, entity_id, action)
);

CREATE TABLE IF NOT EXISTS exported_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL,
  format TEXT NOT NULL,
  requested_by TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
