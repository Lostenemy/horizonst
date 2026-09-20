\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE provisioning_input ON COMMIT DROP AS
SELECT :'principal_code'::text AS principal_code,
       :'company_id'::uuid AS company_id,
       :'token_hash'::text AS token_hash,
       :'mqtt_source_client_id'::text AS mqtt_source_client_id,
       :'mqtt_backend_client_id'::text AS mqtt_backend_client_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM service_principals
    WHERE code = (SELECT principal_code FROM provisioning_input)
      AND company_id <> (SELECT company_id FROM provisioning_input)
  ) THEN
    RAISE EXCEPTION 'service principal code already belongs to another company';
  END IF;
END $$;

INSERT INTO service_principals(code, company_id, scopes, active)
VALUES (:'principal_code', :'company_id'::uuid, ARRAY['hardware.read', 'hardware.command']::text[], TRUE)
ON CONFLICT (code) DO UPDATE
SET scopes = EXCLUDED.scopes, active = TRUE, updated_at = NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM service_principal_tokens
    WHERE token_hash = (SELECT token_hash FROM provisioning_input)
      AND service_principal_id <> (
        SELECT id FROM service_principals WHERE code = (SELECT principal_code FROM provisioning_input)
      )
  ) THEN
    RAISE EXCEPTION 'service token hash already belongs to another principal';
  END IF;
END $$;

INSERT INTO service_principal_tokens(service_principal_id, token_hash, token_hint)
SELECT id, :'token_hash', :'token_hint'
FROM service_principals WHERE code = :'principal_code'
ON CONFLICT (token_hash) DO UPDATE SET revoked_at = NULL;

UPDATE service_principal_tokens
SET revoked_at = COALESCE(revoked_at, NOW())
WHERE service_principal_id = (SELECT id FROM service_principals WHERE code = :'principal_code')
  AND token_hash <> :'token_hash'
  AND revoked_at IS NULL;

DO $$
DECLARE
  source_count integer;
BEGIN
  SELECT count(*) INTO source_count
  FROM vmq_auth_acl
  WHERE mountpoint = '' AND client_id = (SELECT mqtt_source_client_id FROM provisioning_input);
  IF source_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one source MQTT identity, found %', source_count;
  END IF;
END $$;

INSERT INTO vmq_auth_acl(mountpoint, client_id, username, password, publish_acl, subscribe_acl)
SELECT '', :'mqtt_backend_client_id', username, password,
       '[{"pattern":"gw/+/subscribe"}]'::jsonb,
       '[{"pattern":"devices/MK4"},{"pattern":"gw/+/publish"}]'::jsonb
FROM vmq_auth_acl
WHERE mountpoint = '' AND client_id = :'mqtt_source_client_id'
ON CONFLICT (mountpoint, client_id) DO UPDATE
SET username = EXCLUDED.username,
    password = EXCLUDED.password,
    publish_acl = EXCLUDED.publish_acl,
    subscribe_acl = EXCLUDED.subscribe_acl;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM service_principals
    WHERE code = (SELECT principal_code FROM provisioning_input)
      AND company_id = (SELECT company_id FROM provisioning_input)
      AND active
      AND scopes = ARRAY['hardware.read', 'hardware.command']::text[]
  ) THEN RAISE EXCEPTION 'service principal verification failed'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vmq_auth_acl
    WHERE mountpoint = ''
      AND client_id = (SELECT mqtt_backend_client_id FROM provisioning_input)
      AND publish_acl = '[{"pattern":"gw/+/subscribe"}]'::jsonb
      AND subscribe_acl = '[{"pattern":"devices/MK4"},{"pattern":"gw/+/publish"}]'::jsonb
  ) THEN RAISE EXCEPTION 'backend MQTT ACL verification failed'; END IF;
END $$;

COMMIT;
