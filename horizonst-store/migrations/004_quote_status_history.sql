CREATE TABLE IF NOT EXISTS store.quote_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES store.quotes(id) ON DELETE RESTRICT,
  old_status TEXT NOT NULL CHECK (old_status IN ('draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled')),
  new_status TEXT NOT NULL CHECK (new_status IN ('draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled')),
  comment TEXT,
  changed_by UUID REFERENCES store.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_quote_status_history_quote_id_idx ON store.quote_status_history (quote_id);
CREATE INDEX IF NOT EXISTS store_quote_status_history_changed_by_idx ON store.quote_status_history (changed_by);
CREATE INDEX IF NOT EXISTS store_quote_status_history_created_at_idx ON store.quote_status_history (created_at);
