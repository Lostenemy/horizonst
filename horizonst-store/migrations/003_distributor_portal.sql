ALTER TABLE store.distributor_profiles
  ADD COLUMN IF NOT EXISTS contact_person TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES store.users(id) ON DELETE RESTRICT;

UPDATE store.distributor_profiles
SET approved_at = COALESCE(approved_at, reviewed_at),
    approved_by = COALESCE(approved_by, reviewed_by)
WHERE validation_status = 'approved';

ALTER TABLE store.distributor_documents
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE store.distributor_documents
SET created_at = uploaded_at
WHERE uploaded_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS store_distributor_profiles_company_name_idx ON store.distributor_profiles (company_name);
CREATE INDEX IF NOT EXISTS store_distributor_documents_created_at_idx ON store.distributor_documents (created_at);
