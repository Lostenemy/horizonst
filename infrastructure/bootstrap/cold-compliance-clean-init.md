# Inicialización limpia de `cold_compliance`

## Objetivo

Crear `cold_compliance` desde migraciones versionadas e importar solo usuarios técnicos/aplicación aprobados, sin sesiones ni datos históricos.

## Aplicar migraciones

```bash
createdb cold_compliance
for migration in cold-compliance-service/migrations/*.sql; do
  psql "$COLD_COMPLIANCE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

Las migraciones esperadas en el bootstrap actual son:

1. `001_init.sql`
2. `002_tag_control.sql`
3. `003_web_mvp.sql`
4. `004_alerts_archive_metadata.sql`
5. `005_ble_alarm_sessions.sql`
6. `006_alarm_visibility_grace_minutes.sql`
7. `007_tags_physical_alarm_followup_delay.sql`
8. `008_presence_operational_state.sql`
9. `009_tags_physical_alarm_action_durations.sql`

## Importar usuarios técnicos/aplicación

Exportar en origen únicamente los usuarios aprobados y copiar el CSV fuera de Git. Después ejecutar en destino:

```bash
psql "$COLD_COMPLIANCE_DATABASE_URL" \
  -v app_users_csv=/root/horizonst-clean-bootstrap/private/cold_app_users.csv \
  -f infrastructure/bootstrap/app-users-import-template.sql
```

## Validaciones obligatorias

```sql
SELECT count(*) AS auth_sessions FROM auth_sessions;
SELECT count(*) AS password_reset_tokens FROM password_reset_tokens;
SELECT count(*) AS presence_events FROM presence_events;
SELECT count(*) AS cold_room_sessions FROM cold_room_sessions;
SELECT count(*) AS alerts FROM alerts;
SELECT count(*) AS incidents FROM incidents;
SELECT count(*) AS ble_alarm_sessions FROM ble_alarm_sessions;
```

Todas las tablas anteriores deben devolver `0` inmediatamente después del bootstrap, salvo registros generados explícitamente durante una prueba controlada posterior.
