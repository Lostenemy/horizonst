-- Aplicación transaccional por el runner. No altera sesiones ni leases existentes.
-- Es una operación controlada, NO una detección ni prueba de conexión/ubicación BLE.
CREATE TABLE controlled_b5_presence_operations (
  hardware_device_id INTEGER PRIMARY KEY REFERENCES tags(hardware_device_id) ON DELETE RESTRICT,
  operation_id UUID UNIQUE NOT NULL,
  session_id UUID NOT NULL REFERENCES cold_room_sessions(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL,
  alert_reference TEXT NOT NULL CHECK (length(alert_reference) BETWEEN 1 AND 200),
  started_at TIMESTAMPTZ NOT NULL,
  hard_deadline TIMESTAMPTZ NOT NULL,
  protect_until TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  outcome TEXT NOT NULL CHECK (outcome IN ('running','confirmed','unverified','failed')),
  CHECK (hard_deadline > started_at AND hard_deadline <= started_at + INTERVAL '120 seconds'),
  CHECK (protect_until >= started_at AND protect_until <= hard_deadline),
  CHECK ((outcome = 'running' AND completed_at IS NULL) OR (outcome <> 'running' AND completed_at IS NOT NULL))
);
COMMENT ON TABLE controlled_b5_presence_operations IS
  'Exclusión/protección finita de una sesión por operación automática B5 identificada; nunca renueva last_presence_at. Sin secretos; company_id procede del ámbito central validado.';
