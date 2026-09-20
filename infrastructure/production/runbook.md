# Runbook de promoción a producción

Objetivo: fast-forward controlado desde `9f5754d378491772b2730a9adc1fe88edc86dd31` al commit final de `codex/production-parity`. Los comandos son una guía para la ventana aprobada; este trabajo no los ejecuta en producción.

## 1. Preflight sin cambios

1. Confirmar copias verificadas de las dos bases, volúmenes VerneMQ y archivo Compose externo. No crear ni sobrescribir las copias existentes.
2. Confirmar `git merge-base --is-ancestor 9f5754d <commit-final>` y que el árbol está limpio. Crear una etiqueta previa anotada, por ejemplo `production-before-hardware-manager-YYYYMMDD`, sin mover `main` durante la preparación:

   ```sh
   cd /opt/horizonst
   test "$(git rev-parse HEAD)" = 9f5754d378491772b2730a9adc1fe88edc86dd31
   git fetch origin
   git merge-base --is-ancestor 9f5754d378491772b2730a9adc1fe88edc86dd31 <commit-final>
   git tag -a production-before-hardware-manager-YYYYMMDD 9f5754d378491772b2730a9adc1fe88edc86dd31
   git merge --ff-only <commit-final>
   ```

   Si `HEAD` no coincide o el merge no es fast-forward, detenerse; no resetear ni forzar.
3. Guardar fuera de Git una copia con permisos restringidos de:
   - `/opt/horizonst-production/docker-compose.production.yml`;
   - `/opt/horizonst-production/config/.env`;
   - vhosts Nginx activos.
4. Comparar el Compose activo con `infrastructure/production/docker-compose.production.yml`. Aprobar explícitamente diferencias de imágenes, mounts, healthchecks, logging, restart, límites y variables.
5. Verificar que los servicios activos son exactamente los declarados. Correo/webmail se dejan en su proyecto independiente.
6. Obtener la gateway de la red:

   ```sh
   docker network inspect horizonst-production --format '{{(index .IPAM.Config 0).Gateway}}'
   ```

   Guardarla como `TRUSTED_PROXY_IP`. Validar después con una petición que un `X-Forwarded-For` falso desde una conexión no confiable no controla `req.ip`.
7. Consultas de solo lectura:

   ```sql
   SELECT mountpoint, client_id, count(*)
   FROM vmq_auth_acl GROUP BY mountpoint, client_id HAVING count(*) > 1;

   SELECT filename FROM cold_compliance_migrations ORDER BY filename;
   SELECT filename FROM store.schema_migrations ORDER BY filename;
   SELECT filename, sha256 FROM store.security_migrations ORDER BY filename;
   ```

   La primera debe devolver cero filas; Horneo debe tener 001–011; Store normal 001–010. La ausencia de `store.security_migrations` antes del primer uso es válida.
8. Comparar inventario sin escribir. Exportar solo IDs y MAC normalizadas desde `horizonst.gateways/devices` y compararlas con `cold_compliance.gateways.gateway_mac` y `tags.tag_uid`. Deben cumplirse: cobertura 100 %, una sola coincidencia por overlay, ninguna MAC central duplicada, ninguna identidad inactiva/retirada asignada.

Si falla cualquier preflight, detener la ventana. No rellenar firmware, company IDs o hardware IDs por suposición.

## 2. Render y build sin parada

Renderizar sin imprimir el bloque `environment` en el terminal compartido:

```sh
docker compose --env-file /opt/horizonst-production/config/.env \
  -f /opt/horizonst/infrastructure/production/docker-compose.production.yml config -q

docker compose --env-file /opt/horizonst-production/config/.env \
  -f /opt/horizonst/infrastructure/production/docker-compose.production.yml \
  build app cold_compliance_service horizonst_store vernemq
```

No ejecutar `config` sin `-q` en una sesión registrada: el render contiene secretos interpolados. Construir VerneMQ no obliga a recrearlo.

## 3. Migraciones Backend 001–011

1. Mantener Horneo con `HARDWARE_MANAGER_ENABLED=false` y no arrancar aún el nuevo `app` como servicio permanente.
2. Ejecutar un contenedor one-shot con la imagen de `app`, red de producción y entorno protegido. El proceso de Backend aplica 001–011 antes de escuchar; para una ejecución explícita usar el módulo de migraciones y terminar después.
3. Verificar `app_schema_migrations`: 11 nombres, checksums presentes y una sola fila por nombre.
4. Verificar conteos de `gateways`, `devices`, `device_records`, `mqtt_messages` y `vmq_auth_acl` idénticos al preflight. Las columnas nuevas pueden estar vacías; no deben desaparecer filas.
5. Verificar 005 y el índice `vmq_auth_acl_mount_client_unique`. Un duplicado bloquea, nunca se resuelve eliminando automáticamente.
6. Ejecutar una segunda vez el runner y verificar que no crea filas ni reaplica SQL.

## 4. Migraciones Horneo 012–021 con reconciliación

No arrancar directamente la imagen nueva si producción solo registra 001–011: su runner aplicaría todo sin pausa.

1. Aplicar 012–016 individualmente, cada una dentro de transacción, y registrar el nombre en `cold_compliance_migrations` en la misma transacción.
2. Importar a tablas temporales los pares centrales `(id, mac)` de gateways y dispositivos. Actualizar únicamente:
   - `cold_compliance.gateways.hardware_gateway_id` por MAC normalizada exacta;
   - `cold_compliance.tags.hardware_device_id` por MAC normalizada exacta.
3. Antes de confirmar, exigir cobertura completa y unicidad. Comparar conteos y tomar una nueva copia lógica de las tablas afectadas. No usar coincidencias aproximadas.
4. Ejecutar 017–021 en orden. Cada migración tiene preflights que deben abortar ante NULL, duplicados u overlays incompatibles.
5. Segundo arranque del runner: cero migraciones aplicadas.
6. Verificar conteos históricos de asignaciones, sesiones, alertas, incidentes, estados y sesiones BLE; cero huérfanos; FKs 020 en `RESTRICT`; `auth_rate_limits` 021 compatible.

## 5. Store

No ejecutar `npm run migrate`. Ejecutar exclusivamente:

```sh
docker compose --env-file /opt/horizonst-production/config/.env \
  -f /opt/horizonst/infrastructure/production/docker-compose.production.yml \
  run --rm --no-deps horizonst_store node dist/db/migrate-security.js
```

Verificar una fila checksumada `016_auth_rate_limits.sql` en `store.security_migrations`, estructura/índice de `store.auth_rate_limits` y ausencia de nuevas filas 011–015 en `store.schema_migrations`. Repetir el comando para comprobar idempotencia.

## 6. Identidades técnicas

1. Ejecutar el procedimiento de `README.md` con el `company_id` real de Horneo.
2. Verificar sin mostrar hashes:
   - principal activo con scopes exactos `hardware.read`, `hardware.command`;
   - un token activo;
   - ACL Backend con un publish y dos subscribe exactos, sin `qos`;
   - ACL Horneo y gateways existentes sin cambios.
3. Guardar el token en el entorno protegido y mantener `HARDWARE_MANAGER_ENABLED=false`.

## 7. Ventana mínima y orden de arranque

1. Sustituir el Compose externo solo tras el diff aprobado y guardar la ruta de rollback.
2. Crear/recrear únicamente `app`. No recrear PostgreSQL ni VerneMQ.
3. Esperar health `app`; verificar `127.0.0.1:3000/health`, sesión MQTT con client ID Backend y concesión completa de `devices/MK4` y `gw/+/publish`.
4. Confirmar que una concesión QoS 128/partial deja MQTT no saludable y, con `MQTT_REQUIRED=true`, el arranque falla en vez de fingir éxito.
5. Probar solo lecturas autorizadas y simulación/API local. No publicar comandos de escritura ni alarmas.
6. Cambiar `HARDWARE_MANAGER_ENABLED=true` en el entorno protegido y recrear únicamente Horneo.
7. Verificar health Horneo, topics exactos por gateways de su empresa y ausencia de `gw/+/publish` global en Horneo.
8. Recrear Store solo si se desea promover su imagen tras 016. Verificar login inválido = 401, no 503, y rate limit separado por IP real.

## 8. Validación funcional y observabilidad

- Sesiones MQTT: Backend y Horneo con client IDs distintos; no desconexiones alternas.
- `mqtt_messages`: durante la ventana solo crece por `devices/MK4`; ningún topic `gw/%` ni `3070` crudo.
- Lecturas 2002/2011/2040/2041/2057/2201: ejecutar primero con gateway simulada. En hardware real, solo tras autorización explícita; son lecturas, pero generan publicación MQTT.
- `response_observed` se muestra como observado/no verificado, nunca ACK inequívoco. `2201` no cambia capacidades ni dispara B5.
- Firmware desconocido mantiene deshabilitadas opciones dependientes de V2. Registrar versión solo con evidencia.
- Presencia real: observar una entrada/heartbeat/salida y timeout sin duplicados. `sync_queue` no debe recibir nuevas filas por estar deshabilitada.
- B5 manual: `frame_type=1`, `alarm_status=1`, deduplicación por trigger, `dispatchPhysicalAlarm:false`.
- B5 automática: validar con simulador que hay un único intento; `ambiguous`/`attempted_unverified` se conserva en `alerts.metadata.physicalDispatch`. No enviar alarma física real sin autorización.
- Revisar logs por secretos, contraseña B5, payloads de conexión y tokens; ninguno debe aparecer.
- Revisar diarios `hardware_gateway_commands`, `hardware_gateway_reads`, snapshots y auditoría técnica por empresa.

## 9. Rollback

1. Detener la promoción y conservar todos los logs/diarios. No borrar timeouts históricos ni filas de migración.
2. Restaurar el Compose externo guardado y el checkout/imagen anterior validada. Para Horneo D.2, restaurar el artefacto D.1 `a451caafe5bb708e78899fbe84360a7a0ab7c4d0`, su secreto local sin imprimirlo, ACL y suscripción anteriores. `HARDWARE_MANAGER_ENABLED=false` por sí solo no es rollback.
3. Recrear primero Backend anterior/retirarlo del Compose, luego Horneo anterior. Verificar recepción de presencia antes de declarar recuperación. No enviar comandos físicos.
4. Store puede volver a imagen anterior; la tabla 016 es aditiva y puede permanecer. No marcar 011–015.
5. Las migraciones Backend/Horneo no tienen down automático. Restaurar las bases desde las copias verificadas si la aprobación de rollback exige revertir esquema/datos. No intentar DDL manual bajo presión.
6. VerneMQ/PostgreSQL no se recrean salvo restauración de volumen expresamente aprobada. Correo/webmail nunca participan.

## 10. Mantenimiento del host

Actualizaciones Ubuntu, limpieza de imágenes y reinicio del host son una fase posterior, con nueva copia/ventana. No combinarlos con esta promoción para conservar una causa de fallo única.
