-- Adición transaccional por el runner. Sin backfill ni cambios de históricos.
-- Un cierre lógico genera exactamente un trabajo; los efectos SQL y su
-- finalización se confirman juntos. Una orden física incierta NO se reenvía.
CREATE TABLE presence_close_outbox (
  session_id UUID PRIMARY KEY REFERENCES cold_room_sessions(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT CHECK (last_error_code IN ('effects_failed','effects_timeout'))
);
CREATE INDEX presence_close_outbox_pending_idx
  ON presence_close_outbox(available_at, created_at) WHERE completed_at IS NULL;
COMMENT ON TABLE presence_close_outbox IS
  'Efectos posteriores al cierre canónico; clave idempotente de sesión. Sin payload MQTT ni credenciales. Procesar efectos y completed_at en la misma transacción.';

CREATE TABLE physical_alarm_outbox (
  dispatch_key TEXT PRIMARY KEY CHECK (length(dispatch_key) BETWEEN 1 AND 200),
  hardware_device_id INTEGER NOT NULL REFERENCES tags(hardware_device_id) ON DELETE RESTRICT,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','claimed','dispatching','completed','review_required')),
  claim_id UUID,
  lease_until TIMESTAMPTZ,
  available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result_code TEXT CHECK (result_code IN
    ('confirmed','unverified','failed','excluded_before_dispatch','interrupted_dispatch')),
  exclusion_count INTEGER NOT NULL DEFAULT 0 CHECK (exclusion_count >= 0),
  last_excluded_at TIMESTAMPTZ,
  CHECK ((state = 'pending' AND claim_id IS NULL AND lease_until IS NULL)
      OR (state IN ('claimed','dispatching') AND claim_id IS NOT NULL AND lease_until IS NOT NULL)
      OR (state IN ('completed','review_required') AND claim_id IS NOT NULL AND lease_until IS NULL))
);
CREATE INDEX physical_alarm_outbox_pending_idx
  ON physical_alarm_outbox(available_at, created_at) WHERE state = 'pending';
CREATE UNIQUE INDEX physical_alarm_outbox_one_live_device_idx
  ON physical_alarm_outbox(hardware_device_id) WHERE state IN ('claimed','dispatching');
COMMENT ON TABLE physical_alarm_outbox IS
  'Intentos físicos durables con propiedad UUID. Exclusión antes de envío permite reintento; dispatching expirado exige revisión, nunca repetición automática de órdenes inciertas.';
