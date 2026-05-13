\set ON_ERROR_STOP on

-- Plantilla de seed del administrador principal para la base horizonst.
-- Uso recomendado en horizonst.es, con valores generados fuera de Git:
--   psql "$HORIZONST_DATABASE_URL" \
--     -v admin_email='admin@horizonst.es' \
--     -v admin_password_hash='<PASSWORD_HASH_GENERADO_FUERA_DE_GIT>' \
--     -v admin_password_salt='<PASSWORD_SALT_GENERADO_FUERA_DE_GIT>' \
--     -v admin_display_name='Administrador HorizonST' \
--     -f infrastructure/bootstrap/horizonst-admin-seed-template.sql
--
-- No usar contraseñas reales, hashes nuevos ni salts reales en archivos versionados.

BEGIN;

INSERT INTO users (email, password_hash, password_salt, role, display_name)
VALUES (:'admin_email', :'admin_password_hash', :'admin_password_salt', 'ADMIN', :'admin_display_name')
ON CONFLICT (email) DO UPDATE
SET role = EXCLUDED.role,
    display_name = EXCLUDED.display_name,
    password_hash = EXCLUDED.password_hash,
    password_salt = EXCLUDED.password_salt,
    updated_at = NOW();

COMMIT;
