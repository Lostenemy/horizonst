\set ON_ERROR_STOP on

-- Plantilla de import de usuarios técnicos/aplicación aprobados para cold_compliance.app_users.
-- Uso:
--   psql "$COLD_COMPLIANCE_DATABASE_URL" -v app_users_csv=/ruta/privada/cold_app_users.csv -f infrastructure/bootstrap/app-users-import-template.sql
-- El CSV debe generarse fuera de Git con columnas:
--   first_name,last_name,email,phone,dni,role,status,password_hash,shift
-- No importar auth_sessions ni password_reset_tokens.

BEGIN;

CREATE TEMP TABLE tmp_app_users_import (
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  dni text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  password_hash text NOT NULL,
  shift text
) ON COMMIT DROP;

\copy tmp_app_users_import (first_name, last_name, email, phone, dni, role, status, password_hash, shift) FROM :'app_users_csv' WITH (FORMAT csv, HEADER true)

DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM tmp_app_users_import
  WHERE role NOT IN ('supervisor', 'administrador', 'superadministrador')
     OR status NOT IN ('active', 'inactive')
     OR email !~ '^[^@]+@[^@]+$';

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'app_users import aborted: % invalid rows', invalid_count;
  END IF;
END $$;

INSERT INTO app_users (first_name, last_name, email, phone, dni, role, status, password_hash, shift)
SELECT first_name, last_name, email, phone, dni, role, status, password_hash, shift
FROM tmp_app_users_import
ON CONFLICT (email) DO UPDATE
SET first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    phone = EXCLUDED.phone,
    dni = EXCLUDED.dni,
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    password_hash = EXCLUDED.password_hash,
    shift = EXCLUDED.shift,
    updated_at = NOW();

-- Defensa explícita: este bootstrap limpio nunca importa sesiones ni tokens.
DELETE FROM auth_sessions;
DELETE FROM password_reset_tokens;

COMMIT;
