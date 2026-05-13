\set ON_ERROR_STOP on

-- Plantilla de import técnico de vmq_auth_acl.
-- Uso:
--   psql "$HORIZONST_DATABASE_URL" -v acl_csv=/ruta/privada/vmq_auth_acl.csv -f infrastructure/bootstrap/mqtt-acl-import-template.sql
-- El CSV debe generarse fuera de Git con columnas:
--   mountpoint,client_id,username,password,publish_acl,subscribe_acl

BEGIN;

CREATE TEMP TABLE tmp_vmq_auth_acl_import (
  mountpoint text NOT NULL,
  client_id text NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  publish_acl text NOT NULL,
  subscribe_acl text NOT NULL
) ON COMMIT DROP;

\copy tmp_vmq_auth_acl_import (mountpoint, client_id, username, password, publish_acl, subscribe_acl) FROM :'acl_csv' WITH (FORMAT csv, HEADER true)

DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*) INTO row_count FROM tmp_vmq_auth_acl_import;
  IF row_count <> 16 THEN
    RAISE EXCEPTION 'vmq_auth_acl import aborted: expected 16 rows, got %', row_count;
  END IF;
END $$;

INSERT INTO vmq_auth_acl (mountpoint, client_id, username, password, publish_acl, subscribe_acl)
SELECT
  mountpoint,
  client_id,
  username,
  password,
  publish_acl::jsonb,
  subscribe_acl::jsonb
FROM tmp_vmq_auth_acl_import
ON CONFLICT (mountpoint, client_id) DO UPDATE
SET username = EXCLUDED.username,
    password = EXCLUDED.password,
    publish_acl = EXCLUDED.publish_acl,
    subscribe_acl = EXCLUDED.subscribe_acl;

COMMIT;
