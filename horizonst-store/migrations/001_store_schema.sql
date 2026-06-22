CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS store;

CREATE TABLE IF NOT EXISTS store.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('customer', 'distributor', 'admin')) DEFAULT 'customer',
  status TEXT NOT NULL CHECK (status IN ('pending_email_verification', 'active', 'suspended', 'closed')) DEFAULT 'pending_email_verification',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_reason TEXT
);

CREATE TABLE IF NOT EXISTS store.customer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES store.users(id) ON DELETE RESTRICT,
  company_name TEXT,
  tax_id TEXT,
  billing_address TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'ES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.distributor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES store.users(id) ON DELETE RESTRICT,
  company_name TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  billing_address TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'ES',
  website TEXT,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('pending', 'needs_more_info', 'approved', 'suspended', 'rejected', 'closed')) DEFAULT 'pending',
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  reviewed_by UUID REFERENCES store.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.distributor_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_profile_id UUID NOT NULL REFERENCES store.distributor_profiles(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN ('certificado_censal', 'modelo_036', 'modelo_037', 'cif_empresa', 'certificado_autonomo', 'escrituras', 'otro')),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'replaced')) DEFAULT 'pending',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES store.users(id) ON DELETE SET NULL,
  review_notes TEXT
);

CREATE TABLE IF NOT EXISTS store.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('hardware', 'accessory')),
  price_cents INTEGER NOT NULL,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.saas_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  annual_price_cents INTEGER,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  max_tags INTEGER,
  max_gateways INTEGER,
  is_enterprise BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT,
  full_name TEXT NOT NULL,
  company_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  interest TEXT,
  status TEXT NOT NULL CHECK (status IN ('new', 'contacted', 'qualified', 'discarded', 'converted')) DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES store.users(id) ON DELETE RESTRICT,
  quote_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled')) DEFAULT 'draft',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES store.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS store.quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES store.quotes(id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL CHECK (item_type IN ('product', 'saas_plan', 'custom')),
  product_id UUID REFERENCES store.products(id) ON DELETE RESTRICT,
  saas_plan_id UUID REFERENCES store.saas_plans(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  line_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  line_discount_cents INTEGER NOT NULL DEFAULT 0,
  line_tax_cents INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS store.settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES store.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO store.products (sku, name, category, price_cents)
VALUES
  ('gateway_ble', 'Gateway BLE HorizonST', 'hardware', 19000),
  ('gateway_antenna', 'Antena para Gateway BLE', 'accessory', 15000),
  ('tag_ble', 'Tag BLE HorizonST', 'hardware', 7500),
  ('poe_power_supply', 'Fuente PoE', 'accessory', 15000)
ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, price_cents = EXCLUDED.price_cents, updated_at = now();

INSERT INTO store.saas_plans (code, name, annual_price_cents, max_tags, max_gateways, is_enterprise)
VALUES
  ('starter', 'Starter', 58000, 12, 5, false),
  ('professional', 'Professional', 80000, 20, 10, false),
  ('enterprise', 'Enterprise', NULL, NULL, NULL, true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, annual_price_cents = EXCLUDED.annual_price_cents, max_tags = EXCLUDED.max_tags, max_gateways = EXCLUDED.max_gateways, is_enterprise = EXCLUDED.is_enterprise, updated_at = now();

INSERT INTO store.settings (key, value, description)
VALUES
  ('default_distributor_discount_percent', '{"value":10}', 'Descuento distribuidor por defecto en porcentaje'),
  ('currency', '{"value":"EUR"}', 'Divisa por defecto para importes en céntimos'),
  ('default_tax_rate', '{"value":21}', 'IVA por defecto en porcentaje')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = now();
