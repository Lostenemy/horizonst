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

Horneo mantiene `HARDWARE_MANAGER_COMMAND_TIMEOUT_MS=20000` para comandos individuales. La operación secuencial `configure-emergency-button` usa un presupuesto HTTP independiente, `HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS=45000`, superior al peor caso nominal de cuatro comandos de 8 segundos más margen. No debe reducirse por debajo de 40 segundos.

## Rollback

No se debe usar simplemente `HARDWARE_MANAGER_ENABLED=false` como rollback de D.2. Esa variable controla la integración central, pero no restaura el ejecutor físico local ni la suscripción MQTT global que existían en D.1. Aplicarla de forma aislada puede dejar Horneo sin el camino técnico necesario para presencia o alarmas.

El rollback operativo debe realizarse en este orden:

1. Declarar la ventana de rollback y detener nuevas activaciones de D.2 según el procedimiento operativo del entorno. No modificar todavía el principal de servicio ni la constraint SQL: son compatibles con D.1 y mantenerlos evita retirar una dependencia antes de recuperar Horneo.
2. Restaurar el artefacto de Horneo construido desde D.1, commit `a451caafe5bb708e78899fbe84360a7a0ab7c4d0`, o la imagen anterior de Horneo que haya sido validada y registrada para ese entorno. No reconstruir una combinación de archivos D.1/D.2 ni hacer una reversión parcial sobre el contenedor en ejecución.
3. Restaurar la configuración requerida por el ejecutor físico local de D.1. Esto incluye la variable de contraseña de sesión B5 que utilizaba D.1, obtenida del almacén de secretos autorizado, además de los timeouts y reintentos locales aplicables. No copiar, documentar, imprimir ni validar mostrando el valor del secreto; comprobar únicamente que la referencia está definida y es accesible para el proceso.
4. Restaurar las ACL MQTT de D.1 para la identidad de Horneo: lectura de `gw/+/publish` y escritura de `gw/+/subscribe`. Restaurar asimismo la suscripción de Horneo a `gw/+/publish` y conservar el tópico de comandos `gw/{gatewayMac}/subscribe`. Realizar el cambio de ACL de forma coordinada con el cambio de artefacto para evitar una ventana sin recepción.
5. Arrancar o sustituir Horneo siguiendo el procedimiento normal del entorno y verificar primero la recepción de presencia. Confirmar conexión MQTT, recepción de heartbeats reales y avance de las marcas de presencia para gateways conocidas; comprobar también que no aparecen rechazos de ACL ni errores de suscripción. No declarar recuperado el servicio hasta que esta recepción esté confirmada.
6. Verificar de forma no invasiva que el ejecutor físico anterior vuelve a estar operativo: módulo cargado, configuración obligatoria presente, cliente MQTT conectado, tópico de publicación resoluble y listener de ACK registrado. No enviar comandos 1150, 1158, 1160, 1169, 1200 ni ninguna alarma/configuración real durante el rollback salvo autorización expresa para una prueba controlada con hardware.
7. Sólo después de confirmar presencia y disponibilidad del ejecutor D.1 se puede retirar `hardware.command` del principal Horneo si se desea revertir también la autorización introducida por D.2. Mantener `hardware.read` mientras D.1 lo necesite para la lectura central y la reconciliación.
8. Si también se quiere revertir el esquema, comprobar previamente que ningún principal de servicio conserva `hardware.command`. Sólo entonces restaurar el constraint anterior:

```sql
BEGIN;
ALTER TABLE service_principals
  DROP CONSTRAINT IF EXISTS service_principals_scopes_check;
ALTER TABLE service_principals
  ADD CONSTRAINT service_principals_scopes_check
  CHECK (scopes <@ ARRAY['hardware.read']::text[]);
COMMIT;
```

9. Cerrar el rollback registrando el artefacto o imagen restaurada, las ACL efectivas, las comprobaciones de presencia realizadas y el estado final de los scopes. El valor del secreto B5 no debe aparecer en el registro.

No se han ejecutado migraciones, despliegues ni comandos contra hardware durante el desarrollo.
