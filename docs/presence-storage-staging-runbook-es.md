# Presencia y almacenamiento: despliegue seguro en staging

Este cambio separa estado técnico reciente, estado operativo e histórico de negocio. La migración `012_presence_storage_hardening.sql` es aditiva: no borra ni reescribe históricos. El mantenimiento automático usa lotes acotados; no ejecuta `TRUNCATE`, `VACUUM FULL`, `DROP` ni borrados masivos.

## Preflight y backup

Desde `/opt/horizonst`, con la rama revisada ya descargada:

```bash
git status -sb
git rev-parse HEAD
docker compose ps
docker compose exec -T postgres pg_dump -Fc -U "$DB_USER" -d cold_compliance > /var/backups/horizonst/cold_compliance-before-presence-hardening.dump
docker compose exec -T postgres pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" > /var/backups/horizonst/horizonst-before-mqtt-retention.dump
```

Comprobar antes de desplegar que el índice único puede crearse sin elegir ni borrar sesiones:

```bash
docker compose exec -T postgres psql -U "$DB_USER" -d cold_compliance -v ON_ERROR_STOP=1 -c "SELECT tag_id, count(*) FROM cold_room_sessions WHERE ended_at IS NULL GROUP BY tag_id HAVING count(*) > 1;"
```

Si devuelve filas, detener el despliegue y resolverlas manualmente tras revisar cada sesión. La migración fallará de forma segura y se revertirá completa.

## Despliegue gradual

1. Configurar, como mínimo:

```text
MQTT_RAW_RETENTION_HOURS=48
PRESENCE_HEARTBEAT_RETENTION_DAYS=7
SYNC_QUEUE_ENABLED=false
SYNC_QUEUE_SYNCED_RETENTION_HOURS=24
TAG_ALARM_BLE_SESSION_TTL_MS=120000
PRESENCE_RSSI_ENTRY_MARGIN_DB=5
```

2. Construir imágenes sin sustituir servicios desplegados:

```bash
docker compose build app cold_compliance_service
```

3. En ventana autorizada, actualizar primero el servicio de presencia y luego backend. El reinicio/despliegue requiere autorización operativa explícita:

```bash
docker compose up -d --no-deps cold_compliance_service
docker compose up -d --no-deps app
```

4. Verificar estructuras y políticas:

```bash
docker compose exec -T postgres psql -U "$DB_USER" -d cold_compliance -c "\d+ tag_gateway_presence_state"
docker compose exec -T postgres psql -U "$DB_USER" -d cold_compliance -c "SELECT filename, applied_at FROM cold_compliance_migrations WHERE filename='012_presence_storage_hardening.sql';"
docker compose exec -T postgres psql -U "$DB_USER" -d cold_compliance -c "SELECT status, count(*) FROM sync_queue GROUP BY status;"
docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT min(received_at), max(received_at), count(*) FROM mqtt_messages;"
docker compose logs --since=15m cold_compliance_service app | grep -E "maintenance|presence timeout|BLE session|failed"
```

5. Validar con MQTT/hardware real: entrada, heartbeat válido, salida por 45 s de ausencia, reentrada de gracia, buzzer, fallo inducido de vibración/desconexión y cierre posterior de presencia. Durante la espera BLE, enviar otro heartbeat y comprobar que su ingesta no espera a la secuencia física. Confirmar que Hardware Manager conserva `gw/+/publish`, que Horneo sólo mantiene suscripciones exactas `gw/{gatewayMac}/publish` obtenidas del inventario y que los comandos salen desde Hardware Manager por `gw/{gatewayMac}/subscribe`.

## Limpieza controlada del histórico existente

No ejecutar durante el despliegue. Medir primero y ejecutar lotes pequeños en una ventana separada, con backup verificado:

```sql
-- cold_compliance: repetir por lotes observando locks, WAL y espacio libre.
WITH expired AS (
  SELECT id FROM presence_events
  WHERE event_type IN ('heartbeat','telemetry','movement')
    AND created_at < now() - interval '7 days'
  ORDER BY created_at LIMIT 10000
)
DELETE FROM presence_events p USING expired e WHERE p.id=e.id;

WITH expired AS (
  SELECT id FROM sync_queue
  WHERE status='synced' AND synced_at < now() - interval '24 hours'
  ORDER BY synced_at LIMIT 10000
)
DELETE FROM sync_queue q USING expired e WHERE q.id=e.id;

WITH expired AS (
  SELECT id FROM audit_log
  WHERE action='presence_event_ingested' AND created_at < now() - interval '7 days'
  ORDER BY created_at LIMIT 10000
)
DELETE FROM audit_log a USING expired e WHERE a.id=e.id;

-- horizonst: repetir por lotes.
WITH expired AS (
  SELECT id FROM mqtt_messages
  WHERE received_at < now() - interval '48 hours'
  ORDER BY received_at LIMIT 10000
)
DELETE FROM mqtt_messages m USING expired e WHERE m.id=e.id;
```

Después usar `VACUUM (ANALYZE)` normal. `VACUUM FULL` queda excluido hasta disponer de espacio adicional, ventana de bloqueo y autorización específica.

## Transición posterior de MQTT a particiones

No se automatiza el cambio de la tabla de 5,9 GB porque convertirla en sitio requiere tabla paralela, espacio temporal y un corte coordinado. La fase recomendada es: crear `mqtt_messages_v2 PARTITION BY RANGE (received_at)` con particiones diarias y una partición por defecto; dual-write temporal; copiar solo las últimas 48 horas por lotes; comparar conteos/API; hacer el cambio de nombres en una transacción breve; eliminar particiones expiradas con `DROP TABLE` únicamente tras backup y autorización. El job por lotes incluido limita el crecimiento desde el primer despliegue y es compatible con esa transición.

## Rollback

Volver a la imagen/commit anterior de ambos servicios. Las columnas, tabla e índices nuevos pueden permanecer: son compatibles y no alteran APIs. Rehabilitar la duplicación solo si existe un consumidor real con `SYNC_QUEUE_ENABLED=true`. No eliminar `tag_gateway_presence_state` ni restaurar dumps salvo que una revisión confirme corrupción; el rollback normal es únicamente de aplicación. Si se necesita restauración, hacerlo en bases nuevas y comparar antes de sustituir las bases de staging.
