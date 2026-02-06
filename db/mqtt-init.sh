#!/usr/bin/env sh
set -e

export PGPASSWORD="${DB_PASSWORD}"

if [ -n "${MQTT_CLIENT_ID}" ] && [ -n "${MQTT_USERNAME}" ] && [ -n "${MQTT_PASSWORD_HASH}" ]; then
psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d "${DB_NAME:-horizonst}" <<EOFSQL
INSERT INTO vmq_auth_acl (mountpoint, client_id, username, password, publish_acl, subscribe_acl)
VALUES (
  '',
  '${MQTT_CLIENT_ID}',
  '${MQTT_USERNAME}',
  '${MQTT_PASSWORD_HASH}',
  '${MQTT_PUBLISH_ACL_JSON:-[]}'::jsonb,
  '${MQTT_SUBSCRIBE_ACL_JSON:-[]}'::jsonb
)
ON CONFLICT DO NOTHING;
EOFSQL
else
  echo "MQTT seed skipped: MQTT_CLIENT_ID/MQTT_USERNAME/MQTT_PASSWORD_HASH not set."
fi

GATT_CLIENT_ID="${GATT_MQTT_CLIENT_ID:-mqtt-ui-api-gatt}"
GATT_USERNAME="${GATT_MQTT_USERNAME:-${MQTT_USER:-}}"
GATT_PASSWORD="${GATT_MQTT_PASSWORD:-${MQTT_PASS:-}}"

if [ -n "${GATT_CLIENT_ID}" ] && [ -n "${GATT_USERNAME}" ] && [ -n "${GATT_PASSWORD}" ]; then
  psql -v ON_ERROR_STOP=1 \
    -v gatt_client_id="${GATT_CLIENT_ID}" \
    -v gatt_username="${GATT_USERNAME}" \
    -v gatt_password="${GATT_PASSWORD}" \
    -U "${DB_USER}" -d "${DB_NAME:-horizonst}" <<'EOFSQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO vmq_auth_acl (mountpoint, client_id, username, password, publish_acl, subscribe_acl)
VALUES (
  '',
  :'gatt_client_id',
  :'gatt_username',
  crypt(:'gatt_password', gen_salt('bf', 10)),
  '[{"pattern":"/MK110/+/receive","qos":1}]'::jsonb,
  '[{"pattern":"/MK110/+/send","qos":1}]'::jsonb
)
ON CONFLICT (mountpoint, client_id, username)
DO UPDATE SET
  password = EXCLUDED.password,
  publish_acl = EXCLUDED.publish_acl,
  subscribe_acl = EXCLUDED.subscribe_acl;
EOFSQL
else
  echo "GATT seed skipped: missing GATT_MQTT_USERNAME/GATT_MQTT_PASSWORD (or MQTT_USER/MQTT_PASS fallback)."
fi
