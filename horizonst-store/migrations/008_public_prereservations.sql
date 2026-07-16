CREATE TABLE IF NOT EXISTS store.public_prereservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
