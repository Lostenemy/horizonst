#!/usr/bin/env bash
set -euo pipefail

config_file=/vernemq/etc/vernemq.conf
versioned_config=/opt/horizonst/vernemq.conf

if grep -Eq '^[[:space:]]*vmq_diversity\.postgres\.password[[:space:]]*=' "${versioned_config}"; then
  printf 'The versioned VerneMQ baseline contains a PostgreSQL password\n' >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*vmq_diversity\.postgres\.(host|port|database|user)[[:space:]]*=' "${versioned_config}"; then
  printf 'The versioned VerneMQ baseline contains a fixed PostgreSQL connection setting\n' >&2
  exit 1
fi

last_config_value() {
  local key="$1"
  awk -F= -v requested_key="${key}" '
    {
      current_key = $1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", current_key)
      if (current_key == requested_key) {
        value = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        result = value
      }
    }
    END {
      if (result == "") exit 1
      print result
    }
  ' "${config_file}"
}

assert_config_equals() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(last_config_value "${key}")"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'Unexpected effective VerneMQ setting: %s\n' "${key}" >&2
    exit 1
  fi
}

plugin_output="$(/vernemq/bin/vmq-admin plugin show)"

if ! grep -q 'vmq_diversity' <<<"${plugin_output}"; then
  printf 'vmq_diversity is not active\n' >&2
  exit 1
fi
if grep -q 'vmq_passwd' <<<"${plugin_output}"; then
  printf 'vmq_passwd is unexpectedly active\n' >&2
  exit 1
fi
if grep -q 'vmq_acl' <<<"${plugin_output}"; then
  printf 'vmq_acl is unexpectedly active\n' >&2
  exit 1
fi

assert_config_equals plugins.vmq_diversity on
assert_config_equals plugins.vmq_passwd off
assert_config_equals plugins.vmq_acl off
assert_config_equals allow_anonymous off
assert_config_equals listener.tcp.default 0.0.0.0:1883
assert_config_equals vmq_diversity.auth_postgres.enabled on
assert_config_equals vmq_diversity.auth_postgres.script /vernemq/share/lua/auth/postgres.lua
assert_config_equals vmq_diversity.postgres.password_hash_method bcrypt
assert_config_equals vmq_diversity.postgres.host "${DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__HOST:?}"
assert_config_equals vmq_diversity.postgres.port "${DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__PORT:?}"
assert_config_equals vmq_diversity.postgres.database "${DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__DATABASE:?}"
assert_config_equals vmq_diversity.postgres.user "${DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__USER:?}"
assert_config_equals vmq_diversity.postgres.password "${DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__PASSWORD:?}"

printf 'VerneMQ runtime configuration is valid\n'
