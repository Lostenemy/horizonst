#!/bin/sh
set -eu

if [ "${TRACE_BOOTSTRAP:-false}" = "true" ]; then
  echo 'TRACE_BOOTSTRAP must remain disabled because runner environments contain secrets' >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
compose_file=${COMPOSE_FILE:-/opt/horizonst-production/docker-compose.production.yml}
env_file=${ENV_FILE:-/opt/horizonst-production/config/.env}
central_database=${CENTRAL_DATABASE:-horizonst}
horneo_database=${HORNEO_DATABASE:-cold_compliance}

test -f "$compose_file"
test -f "$env_file"
test -f "$script_dir/sql/horneo-inventory-preflight.sql"
test -f "$script_dir/sql/central-inventory-bootstrap.sql"
test -f "$script_dir/sql/horneo-inventory-reconcile.sql"

umask 077
exchange_dir=$(mktemp -d "${TMPDIR:-/tmp}/horizonst-inventory-bootstrap.XXXXXX")
inventory_file=$exchange_dir/horneo-inventory.tsv
mapping_file=$exchange_dir/central-mapping.tsv
: > "$inventory_file"
: > "$mapping_file"
chmod 0600 "$inventory_file" "$mapping_file"

cleanup_exchange() {
  for exchange_file in "$inventory_file" "$mapping_file"; do
    if [ -f "$exchange_file" ] && [ ! -L "$exchange_file" ]; then
      rm -f -- "$exchange_file"
    fi
  done
  if [ -d "$exchange_dir" ] && [ ! -L "$exchange_dir" ]; then
    rmdir -- "$exchange_dir" 2>/dev/null ||
      echo "Protected exchange directory preserved because it is not empty: $exchange_dir" >&2
  fi
}
trap cleanup_exchange EXIT HUP INT TERM

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

psql_database() {
  database=$1
  compose exec -T postgres sh -eu -c \
    'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$database"
}

sql_scalar() {
  database=$1
  sql=$2
  printf '%s\n' "$sql" | psql_database "$database"
}

apply_horneo_migration() {
  migration_name=$1
  migration_path=$repo_root/cold-compliance-service/migrations/$migration_name
  case "$migration_name" in
    0[1-2][0-9]_*.sql) ;;
    *) echo "Refusing unexpected Horneo migration name: $migration_name" >&2; exit 1 ;;
  esac
  test -f "$migration_path"
  if [ "$(sql_scalar "$horneo_database" "SELECT count(*) FROM cold_compliance_migrations WHERE filename = '$migration_name'")" = "1" ]; then
    return
  fi
  {
    printf '%s\n' 'BEGIN;'
    printf '%s\n' "DO \$\$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('horizonst.production.horneo_migrations')); END \$\$;"
    cat "$migration_path"
    printf "\nINSERT INTO cold_compliance_migrations(filename) VALUES('%s');\n" "$migration_name"
    printf '%s\n' 'COMMIT;'
  } | psql_database "$horneo_database"
}

echo '1/8 Applying Backend migrations 001-011 with the application runner'
compose run --rm --no-deps app node -e \
  "const { runMigrations } = require('./dist/db/migrations.js'); const { pool } = require('./dist/db/pool.js'); runMigrations().then(() => pool.end()).catch(async error => { console.error(error); await pool.end(); process.exit(1); });"

test "$(sql_scalar "$central_database" 'SELECT count(*) FROM app_schema_migrations')" = "11"
test "$(sql_scalar "$central_database" "SELECT count(*) FROM app_schema_migrations WHERE checksum IS NULL OR checksum = ''")" = "0"
test "$(sql_scalar "$central_database" "SELECT count(*) FROM companies WHERE code = 'horneo'")" = "1"

echo '2/8 Validating and exporting the complete Horneo technical inventory'
cat "$script_dir/sql/horneo-inventory-preflight.sql" | psql_database "$horneo_database"
printf "%s\n" "COPY (
  SELECT 'gateway', id::text, regexp_replace(lower(gateway_mac), '[-:]', '', 'g'), NULL::boolean
  FROM gateways
  UNION ALL
  SELECT 'tag', id::text, regexp_replace(lower(tag_uid), '[-:]', '', 'g'), active
  FROM tags
  ORDER BY 1, 2
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\\t', NULL '\\N');" |
  psql_database "$horneo_database" > "$inventory_file"
chmod 0600 "$inventory_file"
test -s "$inventory_file"

echo '3/8 Bootstrapping the central inventory in one central-database transaction'
{
  cat <<'SQL'
BEGIN ISOLATION LEVEL SERIALIZABLE;
DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('horizonst.production.inventory_bootstrap')); END $$;
CREATE TEMP TABLE bootstrap_horneo_inventory(
  kind TEXT NOT NULL,
  overlay_id UUID NOT NULL,
  normalized_mac TEXT NOT NULL,
  source_active BOOLEAN
) ON COMMIT PRESERVE ROWS;
\copy bootstrap_horneo_inventory(kind, overlay_id, normalized_mac, source_active) FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', NULL '\N')
SQL
  cat "$inventory_file"
  printf '%s\n' '\.'
  cat "$script_dir/sql/central-inventory-bootstrap.sql"
  printf '%s\n' 'COMMIT;'
  printf "%s\n" "\\copy (SELECT kind, overlay_id, central_id, normalized_mac, source_active FROM bootstrap_horneo_mapping ORDER BY kind, overlay_id) TO STDOUT WITH (FORMAT csv, DELIMITER E'\\t', NULL '\\N')"
} | psql_database "$central_database" > "$mapping_file"
chmod 0600 "$mapping_file"
test -s "$mapping_file"

echo '4/8 Applying Horneo migrations 012-016 with a deliberate checkpoint'
for migration in \
  012_presence_storage_hardening.sql \
  013_hardware_gateway_reference.sql \
  014_inspection_report_sessions_index.sql \
  015_hardware_device_reference.sql \
  016_presence_hardware_references.sql
do
  apply_horneo_migration "$migration"
done

echo '5/8 Reconciling central IDs in one Horneo-database transaction'
{
  cat <<'SQL'
BEGIN ISOLATION LEVEL SERIALIZABLE;
DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('horizonst.production.inventory_reconcile')); END $$;
CREATE TEMP TABLE bootstrap_central_mapping(
  kind TEXT NOT NULL,
  overlay_id UUID NOT NULL,
  central_id INTEGER NOT NULL,
  normalized_mac TEXT NOT NULL,
  source_active BOOLEAN
);
\copy bootstrap_central_mapping(kind, overlay_id, central_id, normalized_mac, source_active) FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', NULL '\N')
SQL
  cat "$mapping_file"
  printf '%s\n' '\.'
  cat "$script_dir/sql/horneo-inventory-reconcile.sql"
  printf '%s\n' 'COMMIT;'
} | psql_database "$horneo_database"

echo '6/8 Verifying the mandatory checkpoint before Horneo 017'
cat <<'SQL' | psql_database "$horneo_database"
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gateways WHERE hardware_gateway_id IS NULL)
     OR EXISTS (SELECT 1 FROM tags WHERE hardware_device_id IS NULL)
     OR EXISTS (SELECT hardware_gateway_id FROM gateways GROUP BY 1 HAVING count(*) > 1)
     OR EXISTS (SELECT hardware_device_id FROM tags GROUP BY 1 HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'bootstrap checkpoint failed before migration 017';
  END IF;
END
$$;
SELECT (SELECT count(*) FROM gateways),
       (SELECT count(*) FROM tags),
       (SELECT count(*) FROM gateways WHERE hardware_gateway_id IS NOT NULL),
       (SELECT count(*) FROM tags WHERE hardware_device_id IS NOT NULL);
SQL

echo '7/8 Applying Horneo migrations 017-021'
for migration in \
  017_operational_hardware_device_id.sql \
  018_central_operational_conflict_keys.sql \
  019_central_only_operational_identity.sql \
  020_overlay_tag_foreign_keys_restrict.sql \
  021_auth_rate_limits.sql
do
  apply_horneo_migration "$migration"
done

echo '8/8 Running postflight cardinality checks'
cat <<'SQL' | psql_database "$horneo_database"
SELECT
  (SELECT count(*) FROM gateways) AS gateways,
  (SELECT count(*) FROM tags) AS tags,
  (SELECT count(*) FROM presence_events) AS presence_events,
  (SELECT count(*) FROM alerts) AS alerts,
  (SELECT count(*) FROM incidents) AS incidents,
  (SELECT count(*) FROM gateways WHERE hardware_gateway_id IS NULL) AS gateway_gaps,
  (SELECT count(*) FROM tags WHERE hardware_device_id IS NULL) AS tag_gaps;
SQL

echo 'Central inventory bootstrap and Horneo reconciliation completed'
