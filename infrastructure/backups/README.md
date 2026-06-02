# HorizonST PostgreSQL backups

This directory contains the hardened PostgreSQL backup script intended to be installed at:

```bash
/opt/backups/scripts/backup_horizonst.sh
```

The default backup root is `/opt/backups`, with PostgreSQL dumps stored in `/opt/backups/postgres` and logs in `/opt/backups/logs`.

## Retention policy

By default, the script keeps backups for `RETENTION_DAYS=14` days. It deletes only files older than that threshold matching these patterns:

- `pg_dumpall_*.sql.gz` for current compressed backups.
- `pg_dumpall_*.sql` for legacy uncompressed backups.

Recent backups are not deleted by the script unless they are older than the configured retention window.

## Compression and corruption protection

Backups are compressed in streaming mode so a large uncompressed `.sql` file is never written to disk:

```bash
docker exec horizonst-postgres-1 pg_dumpall -U horizonst | gzip -9 > "$PG_DIR/.pg_dumpall_${TS}.sql.gz.tmp"
```

When `pg_dumpall` and `gzip` both finish successfully, the temporary file is validated as non-empty and then renamed to `pg_dumpall_${TS}.sql.gz`. If the pipeline fails, the temporary file is removed and the script exits with the failing status.

## Disk-space guard

Before starting a backup, the script checks the filesystem containing `BACKUP_ROOT`. If free space is below `MIN_FREE_PERCENT=15`, it logs an error and aborts without creating a backup.

Check current root filesystem usage with:

```bash
df -h /
```

Check backup directory usage with:

```bash
du -sh /opt/backups /opt/backups/postgres /opt/backups/logs
```

## Listing backups

```bash
ls -lh /opt/backups/postgres
```

## Restoring a `.sql.gz` backup

For a full-cluster restore into the HorizonST PostgreSQL container, choose the desired backup file and run:

```bash
gunzip -c /opt/backups/postgres/pg_dumpall_YYYYMMDD_HHMMSS.sql.gz \
  | docker exec -i horizonst-postgres-1 psql -U horizonst
```

For production, restore into a fresh PostgreSQL instance or a verified maintenance window, and validate application health before resuming normal traffic.

## Manual validation

Syntax-check the script:

```bash
bash -n /opt/backups/scripts/backup_horizonst.sh
```

Run a real backup manually:

```bash
/opt/backups/scripts/backup_horizonst.sh
```

If the Docker container is not present in the current environment, validate the script on the staging server where `horizonst-postgres-1` is running.
