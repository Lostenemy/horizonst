ALTER TABLE store.public_prereservations
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_email_last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_email_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commercial_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commercial_email_last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commercial_email_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE store.public_prereservations
  DROP CONSTRAINT IF EXISTS public_prereservations_confirmation_email_attempts_check;
ALTER TABLE store.public_prereservations
  ADD CONSTRAINT public_prereservations_confirmation_email_attempts_check
  CHECK (confirmation_email_attempts >= 0);

ALTER TABLE store.public_prereservations
  DROP CONSTRAINT IF EXISTS public_prereservations_commercial_email_attempts_check;
ALTER TABLE store.public_prereservations
  ADD CONSTRAINT public_prereservations_commercial_email_attempts_check
  CHECK (commercial_email_attempts >= 0);
