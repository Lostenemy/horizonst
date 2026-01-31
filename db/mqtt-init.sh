#!/usr/bin/env sh
set -e

if [ -z "${MQTT_CLIENT_ID}" ] || [ -z "${MQTT_USERNAME}" ] || [ -z "${MQTT_PASSWORD_HASH}" ]; then
  echo "MQTT init skipped: MQTT_CLIENT_ID/MQTT_USERNAME/MQTT_PASSWORD_HASH not set."
  exit 0
fi

export PGPASSWORD="${DB_PASSWORD}"

psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d "${DB_NAME:-horizonst}" <<EOF
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
EOF
