CREATE TABLE IF NOT EXISTS store.distributor_resource_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  description TEXT,
  original_filename TEXT NOT NULL CHECK (length(btrim(original_filename)) > 0),
  storage_key TEXT UNIQUE NOT NULL CHECK (length(btrim(storage_key)) > 0),
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('uploaded', 'bundled')) DEFAULT 'uploaded',
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 20971520),
  visibility TEXT NOT NULL CHECK (visibility IN ('global', 'targeted')),
  category TEXT NOT NULL CHECK (category IN ('commercial', 'technical', 'pricing', 'legal', 'training', 'other')),
  created_by UUID REFERENCES store.users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.distributor_resource_assignments (
  document_id UUID NOT NULL REFERENCES store.distributor_resource_documents(id) ON DELETE CASCADE,
  distributor_user_id UUID NOT NULL REFERENCES store.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, distributor_user_id)
);

CREATE INDEX IF NOT EXISTS store_distributor_resources_visibility_active_idx
  ON store.distributor_resource_documents (visibility, active, published_at DESC);
CREATE INDEX IF NOT EXISTS store_distributor_resource_assignments_user_idx
  ON store.distributor_resource_assignments (distributor_user_id, document_id);

INSERT INTO store.distributor_resource_documents
  (id, title, description, original_filename, storage_key, storage_kind, mime_type, file_size_bytes, visibility, category, active)
VALUES
  ('00000000-0000-4000-8000-000000000014', 'Dossier HorizonST · Soluciones de frío',
   'Presentación comercial de las soluciones HorizonST para control y trazabilidad de la cadena de frío.',
   'HorizonST_Frio.pdf', 'distributors/HorizonST_Frio.pdf', 'bundled', 'application/pdf', 1042254, 'global', 'commercial', true)
ON CONFLICT (id) DO NOTHING;
