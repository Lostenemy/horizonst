#!/usr/bin/env bash
set -euo pipefail

compose_bin="${COMPOSE_BIN:-docker compose}"

if ! ${compose_bin} ps postgres >/dev/null 2>&1; then
  echo "Postgres service not found. Start the stack first (e.g. ${compose_bin} up -d postgres)." >&2
  exit 1
fi

echo "Applying MQTT schema to Postgres (idempotent)..."
${compose_bin} exec -T postgres psql \
  -U "${DB_USER:-horizonst}" \
  -d "${DB_NAME:-horizonst}" \
  -f /docker-entrypoint-initdb.d/03-mqtt.sql

gatt_client_id="${GATT_MQTT_CLIENT_ID:-mqtt-ui-api-gatt}"
gatt_username="${GATT_MQTT_USERNAME:-${MQTT_USER:-}}"
gatt_password="${GATT_MQTT_PASSWORD:-${MQTT_PASS:-}}"

if [[ -z "${gatt_username}" || -z "${gatt_password}" ]]; then
  echo "Skipping GATT identity migration: define GATT_MQTT_USERNAME/GATT_MQTT_PASSWORD or MQTT_USER/MQTT_PASS." >&2
  echo "Done (schema only)."
  exit 0
fi

echo "Upserting GATT Lab identity in vmq_auth_acl (client_id=${gatt_client_id})..."
${compose_bin} exec -T postgres psql \
  -v ON_ERROR_STOP=1 \
  -v gatt_client_id="${gatt_client_id}" \
  -v gatt_username="${gatt_username}" \
  -v gatt_password="${gatt_password}" \
  -U "${DB_USER:-horizonst}" \
  -d "${DB_NAME:-horizonst}" <<'EOFSQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO vmq_auth_acl (mountpoint, client_id, username, password, publish_acl, subscribe_acl)
VALUES (
  '',
  :'gatt_client_id',
  :'gatt_username',
  crypt(:'gatt_password', gen_salt('bf', 10)),
  '[{"pattern":"devices/+/receive","qos":1}]'::jsonb,
  '[{"pattern":"devices/+/send","qos":1}]'::jsonb
)
ON CONFLICT (mountpoint, client_id, username)
DO UPDATE SET
  password = EXCLUDED.password,
  publish_acl = EXCLUDED.publish_acl,
  subscribe_acl = EXCLUDED.subscribe_acl;
EOFSQL

echo "Done."
