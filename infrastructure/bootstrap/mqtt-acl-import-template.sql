\set ON_ERROR_STOP on

-- Plantilla de import técnico de vmq_auth_acl.
-- Uso:
--   psql "$HORIZONST_DATABASE_URL" -v acl_csv=/ruta/privada/vmq_auth_acl.csv -v expected_rows=4 -f infrastructure/bootstrap/mqtt-acl-import-template.sql
-- El CSV debe generarse fuera de Git con columnas:
--   mountpoint,client_id,username,password,publish_acl,subscribe_acl

\if :{?acl_csv}
\else
  \echo 'vmq_auth_acl import aborted: missing required psql variable acl_csv'
  DO $$ BEGIN RAISE EXCEPTION 'missing required psql variable acl_csv'; END $$;
\endif

\if :{?expected_rows}
\else
  \echo 'vmq_auth_acl import aborted: missing required psql variable expected_rows'
  DO $$ BEGIN RAISE EXCEPTION 'missing required psql variable expected_rows'; END $$;
\endif

BEGIN;

CREATE TEMP TABLE tmp_vmq_auth_acl_import_config (
  acl_csv text NOT NULL CHECK (btrim(acl_csv) <> ''),
  expected_rows bigint NOT NULL CHECK (expected_rows >= 0)
) ON COMMIT DROP;

INSERT INTO tmp_vmq_auth_acl_import_config (acl_csv, expected_rows)
VALUES (:'acl_csv', :'expected_rows'::bigint);

CREATE TEMP TABLE tmp_vmq_auth_acl_import (
  mountpoint text NOT NULL,
  client_id text NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  publish_acl text NOT NULL,
  subscribe_acl text NOT NULL
) ON COMMIT DROP;

-- \copy no interpola variables psql en sus argumentos. Construir primero la
-- metaorden permite conservar COPY desde el cliente y citar la ruta recibida.
\set acl_copy_command '\\copy tmp_vmq_auth_acl_import (mountpoint, client_id, username, password, publish_acl, subscribe_acl) FROM ' :'acl_csv' ' WITH (FORMAT csv, HEADER true)'
:acl_copy_command

DO $$
DECLARE
  actual_rows bigint;
  required_rows bigint;
BEGIN
  SELECT count(*) INTO actual_rows FROM tmp_vmq_auth_acl_import;
  SELECT expected_rows INTO required_rows FROM tmp_vmq_auth_acl_import_config;

  IF actual_rows <> required_rows THEN
    RAISE EXCEPTION 'vmq_auth_acl import aborted: expected % rows, got %', required_rows, actual_rows;
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
