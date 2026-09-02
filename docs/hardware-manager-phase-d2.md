# Hardware Manager — Fase D.2

## Resultado

Hardware Manager mantiene la suscripción global `gw/+/publish`, la persistencia MQTT y la correlación de ACK. Horneo deja de usar esa suscripción global: obtiene del endpoint interno `GET /api/internal/v1/hardware/gateways` el inventario limitado por la empresa de su principal de servicio y mantiene únicamente suscripciones exactas `gw/{gatewayMac}/publish` para gateways activas.

Esta es la transición previa al canal interno normalizado. La ausencia temporal de Hardware Manager conserva las suscripciones exactas ya instaladas, pero nunca habilita de nuevo un comodín. El inventario se refresca cada 30 segundos por defecto; por tanto, una emisión BLE cada 10 segundos no genera consultas centrales por evento.

## Autoridad de comandos B5

Horneo conserva la decisión funcional de alarma, la selección híbrida y fallback de gateways, la deduplicación, el estado de sesión BLE y los tiempos funcionales. La publicación MQTT y la validación de ACK de los comandos físicos se ejecutan exclusivamente en Hardware Manager mediante:

`POST /api/internal/v1/hardware/gateways/:gatewayId/b5-command`

El endpoint exige `hardware.command`, resuelve gateway y dispositivo con el `company_id` del principal autenticado y no acepta empresa, MAC, tópico ni contraseña desde Horneo. La contraseña de sesión B5 reside únicamente en `B5_SESSION_PASSWORD` del backend y se omite del diario técnico.

Los comandos son 1150 (conectar), 1158 (LED), 1160 (buzzer), 1169 (vibración) y 1200 (desconectar). La correlación admite `msg_id`, `msg_id + 2000` y `msg_id + 2001`; sólo `result_code = 0` es éxito. El tópico de salida sigue siendo `gw/{gatewayMac}/subscribe`. Los endpoints heredados de Horneo para RSSI y configuración B5 también delegan en las implementaciones centrales existentes, sin duplicar sus payloads ni su lógica de ACK.

## Migración y configuración

La migración aditiva `backend/migrations/003_hardware_command_scope.sql` amplía el constraint de scopes para aceptar `hardware.read` y `hardware.command`. No modifica principales existentes ni concede el scope nuevo automáticamente.

Antes de activar D.2 en un entorno:

1. Aplicar la migración con el procedimiento habitual revisado del entorno.
2. Añadir `hardware.command` al principal Horneo conservando `hardware.read`.
3. Configurar en Hardware Manager `B5_SESSION_PASSWORD`, `B5_CONNECT_TIMEOUT_MS=12000` y `B5_ACTION_TIMEOUT_MS=8000`.
4. Configurar en Horneo `HARDWARE_MANAGER_ENABLED=true`, su token de servicio y `HARDWARE_MANAGER_MQTT_TOPIC_REFRESH_MS=30000`.
5. Verificar que Horneo muestra sólo tópicos exactos y que Hardware Manager conserva `gw/+/publish`.

No se debe incluir el valor de `B5_SESSION_PASSWORD` en logs, incidencias, tests ni commits.

## Rollback

El rollback operativo consiste en desactivar la activación de D.2 en Horneo y retirar `hardware.command` de su principal. Si además se revierte el esquema, primero debe comprobarse que ningún principal conserva el scope nuevo y después restaurar el constraint anterior:

```sql
BEGIN;
ALTER TABLE service_principals
  DROP CONSTRAINT IF EXISTS service_principals_scopes_check;
ALTER TABLE service_principals
  ADD CONSTRAINT service_principals_scopes_check
  CHECK (scopes <@ ARRAY['hardware.read']::text[]);
COMMIT;
```

No se han ejecutado migraciones, despliegues ni comandos contra hardware durante el desarrollo.
