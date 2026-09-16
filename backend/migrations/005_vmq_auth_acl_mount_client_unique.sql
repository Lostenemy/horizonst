-- El initdb de db/mqtt.sql no vuelve a ejecutarse sobre volúmenes existentes.
-- Bloquear escrituras evita que aparezcan duplicados entre el preflight y el índice.
LOCK TABLE vmq_auth_acl IN SHARE MODE;

DO $$
DECLARE
  duplicate_groups bigint;
BEGIN
  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT 1
    FROM vmq_auth_acl
    GROUP BY mountpoint, client_id
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'vmq_auth_acl: % duplicate (mountpoint, client_id) group(s); resolve them before creating vmq_auth_acl_mount_client_unique', duplicate_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS vmq_auth_acl_mount_client_unique
ON vmq_auth_acl(mountpoint, client_id);
