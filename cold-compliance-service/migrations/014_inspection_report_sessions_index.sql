CREATE INDEX IF NOT EXISTS idx_cold_room_sessions_report_order
  ON cold_room_sessions (started_at DESC, id DESC);
