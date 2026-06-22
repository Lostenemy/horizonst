CREATE TABLE IF NOT EXISTS store.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES store.users(id) ON DELETE RESTRICT,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET
);

CREATE TABLE IF NOT EXISTS store.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES store.users(id) ON DELETE RESTRICT,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET
);

CREATE TABLE IF NOT EXISTS store.email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES store.users(id) ON DELETE RESTRICT,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET
);

CREATE INDEX IF NOT EXISTS store_refresh_tokens_user_id_idx ON store.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS store_refresh_tokens_expires_at_idx ON store.refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS store_refresh_tokens_active_idx ON store.refresh_tokens (user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS store_password_reset_tokens_user_id_idx ON store.password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS store_password_reset_tokens_expires_at_idx ON store.password_reset_tokens (expires_at);
CREATE INDEX IF NOT EXISTS store_password_reset_tokens_active_idx ON store.password_reset_tokens (user_id, expires_at) WHERE revoked_at IS NULL AND used_at IS NULL;
CREATE INDEX IF NOT EXISTS store_email_verification_tokens_user_id_idx ON store.email_verification_tokens (user_id);
CREATE INDEX IF NOT EXISTS store_email_verification_tokens_expires_at_idx ON store.email_verification_tokens (expires_at);
CREATE INDEX IF NOT EXISTS store_email_verification_tokens_active_idx ON store.email_verification_tokens (user_id, expires_at) WHERE revoked_at IS NULL AND used_at IS NULL;
