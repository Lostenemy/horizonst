#!/usr/bin/env bash
set -euo pipefail

required_environment=(
  DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__HOST
  DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__PORT
  DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__DATABASE
  DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__USER
  DOCKER_VERNEMQ_VMQ_DIVERSITY__POSTGRES__PASSWORD
)

for variable_name in "${required_environment[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Required VerneMQ environment variable is empty: %s\n' "${variable_name}" >&2
    exit 1
  fi
done

# The official 1.13.0 start_vernemq command appends DOCKER_VERNEMQ_* values to
# this writable file. Always restore the versioned, secret-free baseline first
# so a restarted container cannot retain stale plugin or database settings.
install -m 0600 /opt/horizonst/vernemq.conf /vernemq/etc/vernemq.conf

exec /usr/sbin/start_vernemq "$@"
