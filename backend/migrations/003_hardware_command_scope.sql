BEGIN;

ALTER TABLE service_principals
  DROP CONSTRAINT IF EXISTS service_principals_scopes_check;

ALTER TABLE service_principals
  ADD CONSTRAINT service_principals_scopes_check CHECK (
    scopes <@ ARRAY['hardware.read', 'hardware.command']::text[]
  );

COMMIT;
