-- Referencias únicamente: no cuerpos, destinatarios ni credenciales. Sin backfill.
CREATE TABLE IF NOT EXISTS store.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_history_id UUID NOT NULL REFERENCES store.quote_status_history(id) ON DELETE RESTRICT,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('quote_available', 'quote_accepted_commercial', 'order_confirmation')),
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('customer', 'commercial')),
  order_id UUID REFERENCES store.orders(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'dispatching', 'smtp_accepted', 'rejected_temporary', 'rejected_permanent', 'failed_before_send', 'uncertain', 'cancelled')),
  attempt_id UUID,
  lease_until TIMESTAMPTZ,
  smtp_code INTEGER CHECK (smtp_code BETWEEN 200 AND 599),
  result_code TEXT CHECK (result_code IN ('accepted', 'smtp_rejected', 'before_data', 'transport_uncertain', 'lease_expired', 'operator_cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES store.users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  UNIQUE (status_history_id, notification_type, recipient_role),
  CHECK ((notification_type = 'quote_accepted_commercial') = (recipient_role = 'commercial')),
  CHECK ((notification_type = 'quote_available') = (order_id IS NULL)),
  CHECK ((attempt_id IS NULL) = (started_at IS NULL)),
  CHECK (state <> 'dispatching' OR (attempt_id IS NOT NULL AND lease_until IS NOT NULL AND finished_at IS NULL)),
  CHECK (state NOT IN ('smtp_accepted','rejected_temporary','rejected_permanent','failed_before_send','uncertain') OR (attempt_id IS NOT NULL AND finished_at IS NOT NULL)),
  CHECK (state <> 'smtp_accepted' OR (smtp_code = 250 AND result_code = 'accepted')),
  CHECK (state <> 'rejected_temporary' OR (smtp_code BETWEEN 400 AND 499 AND result_code = 'smtp_rejected')),
  CHECK (state <> 'rejected_permanent' OR (smtp_code BETWEEN 500 AND 599 AND result_code = 'smtp_rejected')),
  CHECK (state <> 'cancelled' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND result_code = 'operator_cancelled'))
);
CREATE INDEX IF NOT EXISTS notification_deliveries_expiry_idx
  ON store.notification_deliveries(lease_until) WHERE state = 'dispatching';
COMMENT ON TABLE store.notification_deliveries IS 'Intenciones SMTP durables. smtp_accepted no acredita recepción ni lectura. Nunca reenviar automáticamente.';
