#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_ROOT:=/opt/backups}"
: "${PG_DIR:=$BACKUP_ROOT/postgres}"
: "${LOG_DIR:=$BACKUP_ROOT/logs}"
: "${RETENTION_DAYS:=14}"
: "${MIN_FREE_PERCENT:=15}"
: "${POSTGRES_CONTAINER:=horizonst-postgres-1}"
: "${POSTGRES_USER:=horizonst}"

TS="$(date +%Y%m%d_%H%M%S)"
FINAL_FILE="$PG_DIR/pg_dumpall_${TS}.sql.gz"
TMP_FILE="$PG_DIR/.pg_dumpall_${TS}.sql.gz.tmp"
LOG_FILE="$LOG_DIR/backup_horizonst_${TS}.log"

log() {
  local level="$1"
  shift
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$level" "$*" | tee -a "$LOG_FILE"
}

cleanup_tmp() {
  if [[ -f "$TMP_FILE" ]]; then
    rm -f "$TMP_FILE"
  fi
}

require_positive_integer() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    log ERROR "$name must be a positive integer; got '$value'."
    exit 1
  fi
}

free_percent() {
  local path="$1"
  df -P "$path" | awk 'NR == 2 { printf "%d", ($4 * 100) / $2 }'
}

file_size_human() {
  du -h "$1" | awk '{print $1}'
}

abort_if_low_space() {
  local free_pct
  free_pct="$(free_percent "$BACKUP_ROOT")"

  log INFO "Free space on filesystem containing $BACKUP_ROOT: ${free_pct}% (minimum required: ${MIN_FREE_PERCENT}%)."
  if (( free_pct < MIN_FREE_PERCENT )); then
    log ERROR "Aborting backup because free disk space is below MIN_FREE_PERCENT=${MIN_FREE_PERCENT}%."
    exit 1
  fi
}

validate_container() {
  if ! docker container inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
    log ERROR "PostgreSQL container '$POSTGRES_CONTAINER' does not exist or Docker is not reachable."
    exit 1
  fi

  local running
  running="$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER")"
  if [[ "$running" != "true" ]]; then
    log ERROR "PostgreSQL container '$POSTGRES_CONTAINER' exists but is not running."
    exit 1
  fi

  log INFO "Validated PostgreSQL container: $POSTGRES_CONTAINER."
}

run_backup() {
  log INFO "Starting PostgreSQL backup to temporary file: $TMP_FILE."

  if docker exec "$POSTGRES_CONTAINER" pg_dumpall -U "$POSTGRES_USER" | gzip -9 > "$TMP_FILE"; then
    if [[ ! -s "$TMP_FILE" ]]; then
      log ERROR "Backup temporary file is empty: $TMP_FILE."
      cleanup_tmp
      exit 1
    fi

    mv "$TMP_FILE" "$FINAL_FILE"
    log INFO "Backup completed successfully: $FINAL_FILE ($(file_size_human "$FINAL_FILE"))."
  else
    local status=$?
    log ERROR "pg_dumpall or gzip failed with exit code $status; removing temporary file."
    cleanup_tmp
    exit "$status"
  fi
}

cleanup_old_backups() {
  log INFO "Removing compressed PostgreSQL backups older than ${RETENTION_DAYS} days from $PG_DIR."
  find "$PG_DIR" -type f -name 'pg_dumpall_*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete | tee -a "$LOG_FILE"

  log INFO "Removing legacy uncompressed PostgreSQL backups older than ${RETENTION_DAYS} days from $PG_DIR."
  find "$PG_DIR" -type f -name 'pg_dumpall_*.sql' -mtime "+$RETENTION_DAYS" -print -delete | tee -a "$LOG_FILE"
}

main() {
  mkdir -p "$PG_DIR" "$LOG_DIR"
  touch "$LOG_FILE"

  trap cleanup_tmp EXIT

  require_positive_integer RETENTION_DAYS "$RETENTION_DAYS"
  require_positive_integer MIN_FREE_PERCENT "$MIN_FREE_PERCENT"

  log INFO "HorizonST PostgreSQL backup started."
  log INFO "Configuration: BACKUP_ROOT=$BACKUP_ROOT PG_DIR=$PG_DIR LOG_DIR=$LOG_DIR RETENTION_DAYS=$RETENTION_DAYS MIN_FREE_PERCENT=$MIN_FREE_PERCENT POSTGRES_CONTAINER=$POSTGRES_CONTAINER POSTGRES_USER=$POSTGRES_USER."

  abort_if_low_space
  validate_container
  run_backup
  cleanup_old_backups

  log INFO "HorizonST PostgreSQL backup finished."
}

main "$@"
