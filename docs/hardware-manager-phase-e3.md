# Hardware Manager — Fase E.3

## Alcance

E.3 cierra el uso operacional de identidades locales en Horneo. `tags` y `gateways` no se eliminan: permanecen como overlays de configuración local enlazados obligatoriamente con Hardware Manager.

Las columnas `tag_id`, `tag_uid` y `gateway_mac` se conservan para presentación, trazabilidad, compatibilidad HTTP e histórico, pero no resuelven la identidad de presencia, sesiones, alarmas, asignaciones o comandos físicos.

## Orden de despliegue

1. Confirmar que el artefacto desplegado corresponde a E.2.3 y que las migraciones hasta `018` están aplicadas.
2. Verificar en PostgreSQL que no existen referencias centrales nulas ni duplicados incompatibles. La migración `019` repite estas comprobaciones y aborta sin cambios si encuentra una inconsistencia.
3. Arrancar el artefacto E.3. Su runner aplica `019_central_only_operational_identity.sql` dentro de una transacción antes de iniciar el servicio.
4. Verificar que el servicio está healthy y que no aparecen `central_unavailable`, `central_not_found`, `central_rejected` ni errores de constraint inesperados.
5. Verificar recepción de presencia y actualización de `tag_gateway_presence_state`, cuya clave primaria pasa a ser `(hardware_device_id, hardware_gateway_id)`.
6. Verificar consultas de realtime, dashboard e informes.
7. No enviar comandos físicos reales durante esta validación salvo autorización expresa.

## Comportamiento ante indisponibilidad central

E.3 no vuelve a resolver dispositivos o gateways por las MAC almacenadas en los overlays. Si el inventario de Hardware Manager no está disponible, el evento operacional se rechaza de forma explícita. El evento MQTT crudo puede conservarse como histórico, pero no actualiza el estado operacional ni abre o prolonga una sesión.

## Rollback de aplicación

El rollback recomendado consiste en restaurar el artefacto E.2.3, commit `5e14694554e3a8e16e27c9738b88793e1555b917`, o su imagen validada.

No es necesario revertir inmediatamente la migración `019`:

- E.2.3 ya escribe y hace UPSERT por `hardware_device_id` en presencia y BLE.
- E.2.3 ya hace UPSERT de presencia actual por la pareja central de dispositivo y gateway.
- Las columnas `tag_id`, `tag_uid` y `gateway_mac` siguen presentes.
- Las FK locales no se eliminan.
- Las restricciones activas de asignación de E.2.3 permanecen.
- La unicidad central de sesiones abiertas permanece.

Después de restaurar E.2.3 se debe verificar recepción de presencia, creación/cierre de sesiones y realtime antes de considerar recuperado el servicio. No usar `HARDWARE_MANAGER_ENABLED=false`: E.2.3 y E.3 requieren identidad central para nuevas operaciones.

## Reversión estructural opcional

Solo si existe una necesidad demostrada de volver a una versión anterior a E.2.3 se preparará una migración inversa nueva y revisada. Antes deberá comprobarse:

- unicidad de `tag_id` en `presence_operational_state` y `ble_alarm_sessions`;
- ausencia de sesiones abiertas duplicadas por `tag_id`;
- ausencia de duplicados de `(worker_id, tag_id, assigned_at)`;
- conservación completa de las referencias locales.

La reversión deberá restaurar las PK e índices legacy antes de retirar las estructuras centrales. No se debe editar ni borrar la migración `019` ya aplicada, ni ejecutar DDL manual en producción sin revisión y autorización.

## Elementos preservados

- Overlays `tags` y `gateways` y su configuración local.
- Contratos HTTP y campos de presentación existentes.
- Alertas e incidentes sin hardware asociado.
- Histórico de `tag_commands`, attempts, responses y templates.
- Topics MQTT `gw/{gatewayMac}/publish` y ejecución física centralizada en Hardware Manager.
- Emergencia manual B5 con `dispatchPhysicalAlarm: false`.
