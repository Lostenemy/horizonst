# Bootstrap limpio de producción para `horizonst.es`

Este documento define el procedimiento seguro para preparar un servidor nuevo de producción para `horizonst.es` sin afectar ni cambiar el despliegue actual de `horizonst.com.es`.

## Principios de la migración limpia

- El servidor destino se considera **nuevo y vacío**.
- No se reutilizan volúmenes, dumps completos ni datos históricos del servidor origen.
- No se modifica `docker-compose.yml` para este bootstrap salvo necesidad operativa documentada y revisada.
- Se aplican primero estructuras y migraciones versionadas desde Git.
- Solo se importan datos técnicos mínimos, generados fuera de Git y copiados manualmente al destino.
- No se guardan contraseñas reales, hashes sensibles nuevos, dumps reales ni CSV reales en el repositorio.

## Bases de datos implicadas

| Base | Uso | Bootstrap limpio |
| --- | --- | --- |
| `horizonst` | Plataforma principal, usuarios base, inventario BLE/RFID y alarmas | Crear estructura con `db/schema.sql`; seed de admin específico para `horizonst.es`; importar solo usuarios de aplicación aprobados si procede. |
| `cold_compliance` | Servicio de cumplimiento de frío | Aplicar migraciones `001` a `009`; importar solo usuarios técnicos/aplicación aprobados si procede; no importar sesiones ni eventos. |
| `rfid_access` | Servicio RFID de acceso | Crear estructura según los artefactos vigentes del servicio antes del corte; no importar logs históricos ni datos de demo. |
| `rfid_demo` | Dashboard demo RFID | Crear únicamente si se mantiene la demo; aplicar solo `rfid-demo-dashboard/migrations/001_rfid_demo_dashboard.sql`; no aplicar seeds demo en producción. |

## Orden de aplicación recomendado

1. Aprovisionar servidor, DNS, certificados y variables de entorno para `horizonst.es`.
2. Crear bases vacías: `horizonst`, `cold_compliance`, `rfid_access` y opcionalmente `rfid_demo`.
3. Aplicar esquemas principales:
   - `psql "$HORIZONST_DATABASE_URL" -f db/schema.sql`
   - `psql "$HORIZONST_DATABASE_URL" -f db/mqtt.sql`
4. Aplicar seed seguro del administrador principal mediante `infrastructure/bootstrap/horizonst-clean-init.md` y un script local no versionado.
5. Importar las 16 entradas técnicas actuales de `vmq_auth_acl` usando `infrastructure/bootstrap/mqtt-acl-import-template.sql` y un CSV/SQL externo generado en el origen.
6. Aplicar migraciones de `cold_compliance` en orden lexicográfico desde `001_init.sql` hasta `009_tags_physical_alarm_action_durations.sql`.
7. Importar usuarios técnicos/aplicación aprobados mediante `infrastructure/bootstrap/app-users-import-template.sql` y un CSV/SQL externo generado en el origen.
8. Configurar buzones y alias de correo de `horizonst.es` desde cero, sin migrar mensajes antiguos.
9. Levantar servicios y ejecutar la checklist de validación.

## Datos que NO se migran

No se deben migrar ni copiar al servidor `horizonst.es`:

- Dumps completos de PostgreSQL.
- Datos de negocio históricos: dispositivos, lugares, categorías, trabajadores, asignaciones, tarjetas RFID reales y entidades operativas no aprobadas explícitamente.
- Logs, eventos y telemetría: `mqtt_messages`, `device_records`, `rfid_access_logs`, `presence_events`, `cold_room_sessions`, `workday_accumulators`, `alerts`, `incidents`, `incident_notes`, `audit_log`, `sync_queue`, `exported_reports`, `ble_alarm_sessions`, `rfid_demo_read_events`, `rfid_demo_inventory_state` y `rfid_demo_cycle_history`.
- Sesiones y tokens: `auth_sessions` y `password_reset_tokens`.
- Correos antiguos, buzones con contenido, colas de correo o backups de maildir.
- Seeds de demo: `rfid-demo-dashboard/migrations/seed_demo_tags.sql` y `rfid-demo-dashboard/migrations/seed_demo_activity.sql`.
- Contraseñas reales, hashes nuevos sensibles, claves DKIM privadas o secretos en Git.

## Datos técnicos que SÍ se migran

Solo se migran, previa revisión manual:

- Las **16 entradas actuales** de `vmq_auth_acl`, porque son configuración técnica requerida por VerneMQ.
- Usuarios técnicos/de aplicación seleccionados, sin sesiones asociadas ni tokens de recuperación.
- Configuración mínima de correo de `horizonst.es` recreada desde cero.
- Opcionalmente reglas o catálogos técnicos indispensables si se aprueban como parte del corte y se documentan fuera de Git.

## Generación de artefactos externos fuera de Git

Ejecutar en el servidor origen y copiar manualmente al servidor destino por canal seguro. Los archivos generados no deben añadirse al repositorio.

### Exportar ACL MQTT

```bash
mkdir -p /root/horizonst-clean-bootstrap/private
psql "$HORIZONST_DATABASE_URL" \
  -c "\\copy (SELECT mountpoint, client_id, username, password, publish_acl::text, subscribe_acl::text FROM vmq_auth_acl ORDER BY mountpoint, client_id) TO '/root/horizonst-clean-bootstrap/private/vmq_auth_acl.csv' WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)"
```

Validar que contiene exactamente 16 filas de datos además de la cabecera:

```bash
python3 - <<'PY'
import csv
with open('/root/horizonst-clean-bootstrap/private/vmq_auth_acl.csv', newline='') as fh:
    rows = list(csv.DictReader(fh))
print(len(rows))
assert len(rows) == 16
PY
```

### Exportar usuarios técnicos/aplicación aprobados

Ajustar manualmente el filtro `WHERE` antes de ejecutar. No exportar usuarios finales ni datos de negocio.

```bash
mkdir -p /root/horizonst-clean-bootstrap/private
psql "$COLD_COMPLIANCE_DATABASE_URL" \
  -c "\\copy (SELECT first_name, last_name, email, phone, dni, role, status, password_hash, shift FROM app_users WHERE email IN ('usuario-tecnico@example.invalid') ORDER BY email) TO '/root/horizonst-clean-bootstrap/private/cold_app_users.csv' WITH (FORMAT csv, HEADER true, FORCE_QUOTE *)"
```

## Correo para `horizonst.es`

Recrear buzones y alias desde cero, sin migrar correos:

- `notificaciones@horizonst.es`
- `admin@horizonst.es`
- `no_reply@horizonst.es`
- `contacto@horizonst.es` -> `notificaciones@horizonst.es`
- `soporte@horizonst.es` -> `notificaciones@horizonst.es`
- `postmaster@horizonst.es` -> `notificaciones@horizonst.es`
- `abuse@horizonst.es` -> `notificaciones@horizonst.es`

Usar `infrastructure/bootstrap/mail-accounts-horizonst-es.example` como plantilla operativa y sustituir contraseñas mediante un canal secreto fuera de Git.

## Checklist de validación

- [ ] `docker-compose.yml` no ha sido modificado para el bootstrap limpio.
- [ ] Las bases nuevas existen y están vacías antes de aplicar esquemas.
- [ ] `db/schema.sql` y `db/mqtt.sql` se aplican sin errores en `horizonst`.
- [ ] El admin principal de `horizonst.es` existe con email del nuevo dominio y contraseña rotada fuera de Git.
- [ ] `SELECT count(*) FROM vmq_auth_acl;` devuelve `16` tras el import técnico.
- [ ] Las migraciones `cold-compliance-service/migrations/001_*.sql` a `009_*.sql` se aplican en orden y sin errores.
- [ ] `SELECT count(*) FROM auth_sessions;` devuelve `0`.
- [ ] `SELECT count(*) FROM password_reset_tokens;` devuelve `0`.
- [ ] No existen datos en tablas históricas o de eventos salvo los generados durante la validación controlada.
- [ ] Buzones y alias de `horizonst.es` creados, con contraseñas nuevas y sin maildir migrado.
- [ ] Servicios levantan y healthchecks responden.
- [ ] VerneMQ autentica clientes esperados con ACL importada.
- [ ] Backups iniciales del servidor limpio quedan configurados después del bootstrap.

## Rollback

Como el destino es un servidor nuevo, el rollback principal es destruir y recrear el entorno limpio:

1. Detener servicios del destino.
2. Eliminar bases y volúmenes creados durante la prueba de bootstrap.
3. Eliminar artefactos externos copiados manualmente al destino.
4. Corregir scripts locales o variables de entorno.
5. Repetir el bootstrap desde esquemas versionados.

El despliegue actual `horizonst.com.es` no debe verse afectado porque no se modifica su `docker-compose.yml`, no se cambian puertos, redes, volúmenes ni servicios, y no se ejecutan scripts destructivos en el origen.

## Advertencias de seguridad

- No commitear archivos CSV/SQL reales generados desde producción.
- No commitear secretos, hashes nuevos, contraseñas, claves DKIM privadas, dumps ni backups.
- Verificar que los artefactos privados no quedan dentro del árbol Git antes de hacer commit.
- Rotar contraseñas técnicas y credenciales de correo durante el corte a `horizonst.es`.
- Ejecutar imports con usuarios PostgreSQL de privilegios mínimos cuando sea posible.
- Revisar manualmente cualquier usuario técnico exportado antes de importarlo al destino.
