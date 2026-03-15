CREATE TABLE IF NOT EXISTS public.rfid_demo_read_events (
  id BIGSERIAL PRIMARY KEY,
  epc VARCHAR(128) NOT NULL,
  reader_mac VARCHAR(32) NOT NULL,
  antenna INTEGER,
  direction VARCHAR(8) NOT NULL CHECK (direction IN ('IN', 'OUT', 'IGNORED')),
  is_registered BOOLEAN NOT NULL,
  raw_payload JSONB NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ignored_by_debounce BOOLEAN NOT NULL DEFAULT FALSE,
  debounce_window_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rfid_demo_read_events_processed_at
  ON public.rfid_demo_read_events (processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfid_demo_read_events_epc_processed_at
  ON public.rfid_demo_read_events (epc, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfid_demo_read_events_registered_processed_at
  ON public.rfid_demo_read_events (is_registered, processed_at DESC);

CREATE TABLE IF NOT EXISTS public.rfid_demo_inventory_state (
  epc VARCHAR(128) PRIMARY KEY,
  is_active BOOLEAN NOT NULL,
  is_registered BOOLEAN NOT NULL,
  last_reader_mac VARCHAR(32) NOT NULL,
  last_antenna INTEGER,
  last_direction VARCHAR(8) NOT NULL CHECK (last_direction IN ('IN', 'OUT')),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_event_ts TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfid_demo_inventory_state_active_updated
  ON public.rfid_demo_inventory_state (is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfid_demo_inventory_state_registered_updated
  ON public.rfid_demo_inventory_state (is_registered, updated_at DESC);
