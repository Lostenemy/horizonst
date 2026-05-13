# Inicialización limpia de la base `horizonst`

## Objetivo

Crear una base `horizonst` limpia para `horizonst.es`, aplicando estructuras versionadas y datos técnicos mínimos sin modificar los defaults actuales de `horizonst.com.es`.

## Orden recomendado

```bash
createdb horizonst
psql "$HORIZONST_DATABASE_URL" -f db/schema.sql
psql "$HORIZONST_DATABASE_URL" -f db/mqtt.sql
```

## Seed seguro del administrador principal

No reutilizar `db/seed.sql` para `horizonst.es` porque contiene el usuario histórico `admin@horizonst.com.es`.

Generar fuera de Git el hash y salt con el backend vigente o con el procedimiento operativo aprobado. Después ejecutar la plantilla parametrizada sin escribir secretos en el repositorio:

```bash
psql "$HORIZONST_DATABASE_URL" \
  -v admin_email='admin@horizonst.es' \
  -v admin_password_hash='<PASSWORD_HASH_GENERADO_FUERA_DE_GIT>' \
  -v admin_password_salt='<PASSWORD_SALT_GENERADO_FUERA_DE_GIT>' \
  -v admin_display_name='Administrador HorizonST' \
  -f infrastructure/bootstrap/horizonst-admin-seed-template.sql
```

## Import técnico de `vmq_auth_acl`

1. Generar el CSV en el servidor origen fuera de Git.
2. Copiarlo manualmente al destino por canal seguro.
3. Ejecutar la plantilla:

```bash
psql "$HORIZONST_DATABASE_URL" \
  -v acl_csv=/root/horizonst-clean-bootstrap/private/vmq_auth_acl.csv \
  -f infrastructure/bootstrap/mqtt-acl-import-template.sql
```

## Tablas que deben quedar vacías en bootstrap limpio

Validar que no se han importado datos históricos:

```sql
SELECT 'mqtt_messages' AS table_name, count(*) FROM mqtt_messages
UNION ALL SELECT 'device_records', count(*) FROM device_records
UNION ALL SELECT 'rfid_access_logs', count(*) FROM rfid_access_logs
UNION ALL SELECT 'alarms', count(*) FROM alarms;
```
