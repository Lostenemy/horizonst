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
echo "Done."
