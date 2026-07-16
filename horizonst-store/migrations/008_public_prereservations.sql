ALTER TABLE store.leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE store.leads ADD CONSTRAINT leads_source_check
  CHECK (source IN ('demo', 'appcc_guide', 'contact_form', 'landing', 'public_prereservation_2026'));
ALTER TABLE store.leads ADD COLUMN IF NOT EXISTS campaign_code TEXT;
ALTER TABLE store.leads ADD COLUMN IF NOT EXISTS offer_code TEXT;
ALTER TABLE store.leads DROP CONSTRAINT IF EXISTS leads_prereservation_context_check;
ALTER TABLE store.leads ADD CONSTRAINT leads_prereservation_context_check CHECK (
  (source = 'public_prereservation_2026' AND campaign_code = 'prereservation_2026' AND offer_code IN ('starter', 'professional', 'enterprise')) OR
  (source <> 'public_prereservation_2026' AND campaign_code IS NULL AND offer_code IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS store_leads_prereservation_identity_idx
  ON store.leads (lower(email), campaign_code, offer_code)
  WHERE source = 'public_prereservation_2026';

CREATE TABLE IF NOT EXISTS store.public_prereservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL UNIQUE REFERENCES store.leads(id) ON DELETE RESTRICT,
  email TEXT NOT NULL CHECK (email = lower(btrim(email))),
  campaign_code TEXT NOT NULL,
  offer_code TEXT NOT NULL CHECK (offer_code IN ('starter', 'professional', 'enterprise')),
  privacy_accepted BOOLEAN NOT NULL CHECK (privacy_accepted = true),
  privacy_accepted_at TIMESTAMPTZ NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_interest_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, campaign_code, offer_code)
);

CREATE INDEX IF NOT EXISTS store_public_prereservations_token_idx
  ON store.public_prereservations (access_token_hash, access_expires_at);
CREATE INDEX IF NOT EXISTS store_public_prereservations_campaign_offer_idx
  ON store.public_prereservations (campaign_code, offer_code, created_at);
