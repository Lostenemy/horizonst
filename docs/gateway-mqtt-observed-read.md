# Lectura pública de configuración MQTT (2030)

## Alcance y diagnóstico

Base actual: último commit publicado `0e89c8436f629b3ebea4addc2b48cac994cdb5b5`, rama `codex/gateway-rssi-mqtt-integration`. Se separan **borrador editable** y **configuración MQTT observada**, con fecha de recepción. Con la función habilitada, cada apertura técnica autorizada solicita un 2030. Una respuesta válida inicia el formulario con datos públicos recibidos y contraseña vacía; no aplica ningún cambio. Si el operador editó mientras esperaba, conserva su borrador y muestra la observación aparte. Restaurar propuesta carga explícitamente la plantilla del entorno, no otra lectura.

La guía `guia-referencia-mqtt-mkgw3.pdf`, página 10, confirma la petición 2030 sin `data`; no describe su respuesta. Se implementa exclusivamente la respuesta aportada por el operador: `msg_id:2030`, MAC y objeto `data`. El ejemplo 1030 de la guía usa LWT `offline`, distinto del LWT JSON 3999 observado. No se inventa compatibilidad: ese formato alternativo y respuestas fuera del contrato quedan rechazados. No se deduce compatibilidad con otros firmwares.

## Contrato y autorización

- `POST /api/gateways/:gatewayId/read-configuration/mqtt_configuration`: cuerpo vacío, sin confirmación de recuperación; permisos técnicos, gateway activa y alcance central de compañía. Backend resuelve MAC y topic. Publica únicamente `{device_info:{mac:MAC_CENTRAL_NORMALIZADA},msg_id:2030}` en `gw/{mac}/subscribe`, QoS 0. Por compatibilidad, se sigue aceptando exclusivamente `{confirmRecovery:true}` de clientes anteriores, sin conceder capacidad de desbloqueo ni exigirlo al nuevo cliente.
- `GET /api/gateways/:gatewayId/mqtt-observation`: consulta pasiva, mismos permisos y ámbito, `Cache-Control: no-store`. Devuelve última observación pública y fecha, o ausencia explícita. Con función deshabilitada no consulta la tabla nueva.
- Respuesta entrante exclusivamente en `gw/{mac}/publish`; MAC del payload estricta y coincidente, mensaje numérico 2030, validación de esquema/tipos/rangos. MAC contradictoria no confirma la lectura. La inexistencia, inactividad y recursos ajenos mantienen 404. No se habilitan lecturas para gateways sin compañía.

Campos públicos permitidos: `security_type`, `host`, `port`, `client_id`, `username`, `sub_topic`, `pub_topic`, `qos`, `clean_session`, `keepalive`, `lwt_en`, `lwt_qos`, `lwt_retain`, `lwt_topic`, `lwt_payload`. LWT se valida y reconstruye canónicamente como 3999 para la misma MAC; no se retiene texto JSON arbitrario.

No se cambian ACL, parámetros físicos, QoS de otros comandos, conexiones ni los flujos 1030/1000. Abrir la sección inicia una lectura 2030, nunca escrituras, reinicios o alarmas. Restaurar la propuesta no inicia otra lectura.

## Coordinación y límites de correlación

Una lectura por apertura; actualización manual explícita, botón bloqueado mientras espera y control de doble clic. Generaciones de pantalla impiden que una respuesta pendiente pinte otra gateway. El bloqueo asesor compartido `(7246, gatewayId)` evita publicaciones concurrentes entre procesos. Se conserva el presupuesto absoluto y la destrucción de conexiones vencidas de la infraestructura existente.

El protocolo no aporta identificador de intento. `response_observed` significa respuesta pública validada y persistida, **no atribución inequívoca, frescura del contenido ni conexión al broker mostrado**. La fecha es recepción local. Incluso tras un éxito, una respuesta duplicada puede confundirse con una observación posterior; la UI y API mantienen `correlation: unverified`.

Tras un timeout o publicación incierta, el historial bloquea nuevos 2030 de esa gateway, también al reabrir. No hay reintentos automáticos ni procedimiento de limpiar timeouts para eludirlo. Una respuesta tardía válida puede actualizar la última observación sin revivir el resultado expirado. La resolución de esa incertidumbre requiere un contrato adicional del fabricante o una decisión operativa revisada; no se ofrece un desbloqueo ciego.

## Protección de secretos y capturas

La gateway devuelve `passwd`. El campo se excluye antes de persistencia, diario, auditoría, logs, HTTP y eventos; solo sale el objeto público validado de 15 claves. Los campos desconocidos se descartan y los errores no incluyen payload crudo ni excepción del transporte. No se añade longitud, hash ni huella del secreto. Se mantiene el rechazo de material de credencial literal/URL/base64 en campos no autorizados por la excepción de identidad descrita abajo. No se almacena `passwd` en el navegador ni se rellena automáticamente su campo.

Backend intercepta 2030 antes de ACK y captura cruda, incluido el mensaje malformado identificable como 2030 recibido por MK4. Horneo descarta 2030 antes de presencia/emergencias y su parser también lo filtra. MQTT UI descarta antes de logs, waiters GATT y SSE. El parser RFID demo evita el fallback de EPC crudo para 2030 si su suscripción configurada lo recibe. El observer versionado consulta métricas/estado con `vmq-admin`; no consume mensajes MQTT. La configuración versionada de VerneMQ habilita autenticación PostgreSQL, no un hook de persistencia cruda de publicaciones.

Esto no certifica consumidores externos, extensiones del broker, trazas activas o capturas de red no presentes en el repositorio. **La función queda deshabilitada por defecto** hasta revisar ese recorrido real. No activar trazas crudas para validar 2030: contendrían la contraseña real. No inspeccionar ni adjuntar el secreto al repositorio.

## Migración y configuración

### Contrato vigente de identidad y límite de confidencialidad

Por decisión explícita de producto, no se rechaza una respuesta porque `passwd` sea igual a la MAC normalizada, `client_id` o `username`. Se mantienen esos identificadores y los topics y LWT. La excepción se limita a los campos de identidad `client_id`, `username`, `sub_topic`, `pub_topic`, `lwt_topic` y `lwt_payload`, cuando existe esa igualdad exacta. No se extiende a campos ajenos como `host`; se conserva la detección de duplicados literal/URL/base64 en los demás casos. Se prueba con valores exclusivamente ficticios.

**Excluir la clave `passwd` no garantiza ocultar su valor cuando coincide con un identificador público.** Con este contrato, ese valor será visible como identidad en HTTP/formulario y puede persistir en observaciones y diarios públicos. No se etiqueta su igualdad ni se publica una huella de la credencial; tampoco se presenta la MAC como un secreto protegido. La mitigación operativa es cambiar la credencial por un valor independiente mediante un procedimiento autorizado; esta entrega no la cambia ni condiciona a ello la lectura. Los filtros de consumidores siguen excluyendo el mensaje crudo. No se certifica confidencialidad frente a transformaciones arbitrarias del secreto ni consumidores externos.

2030 acepta espacios y saltos de línea en el JSON LWT 3999 de la misma MAC; se compacta y reconstruye antes de exponerlo, y se repite la protección de secretos sobre la representación final. Esto no modifica las reglas de escritura 1030. 2040 sigue siendo la lectura independiente de `scan_switch`.

Los errores conservan código fijo y payload reducido a `{msg_id:2030}`. La API pasiva sigue ocultando observaciones anteriores tras un rechazo, sin borrar filas, pero ese diagnóstico ya no impide el nuevo POST al abrir. Un código histórico de colisión no se reinterpreta ni se vuelve éxito: la nueva lectura crea su propio resultado. El código genérico histórico no demuestra cuál fue la causa. No hay bucle de reintentos después de una respuesta rechazada; otra apertura o una actualización explícita puede solicitar otro intento.

La revalidación almacenada sigue exigiendo las claves públicas exactas, tipos, rangos y LWT de la misma MAC, y rechaza `passwd`. No puede demostrar independencia de esos valores respecto a una credencial actual desconocida. No se implementa rotación ni eliminación de timeouts históricos.

Los rechazos de identidad de `7e20619` y la recuperación exclusivamente manual de `0e89c84` quedan sustituidos por el contrato vigente, no por una modificación del historial. Las validaciones actuales se resumen al final.

### Apertura y estados inciertos

Al abrir se consulta pasivamente la disponibilidad y se envía una sola lectura 2030 aunque existan rechazos `invalid_response`. La nueva respuesta se valida y persiste de nuevo. La apertura no solicita 1030, reinicio, alarma ni lectura RSSI. El dato observado separado conserva fecha y `correlation:unverified`; el formulario es solo un borrador iniciado desde esa recepción. El botón de actualización manual mantiene su confirmación explícita, pero no es necesario pulsarlo para superar un rechazo histórico.

Las aperturas solapadas reutilizan la promesa en curso para esa gateway y no duplican publicaciones por renderizado concurrente. Las generaciones impiden pintar otra gateway; cambios manuales durante la espera no se sobrescriben. Restaurar la propuesta mantiene la separación de fuentes y no envía comandos.

El servidor comprueba rol/compañía/actividad y revisa el historial bajo `(7246,gatewayId)` antes de insertar el nuevo intento. `timed_out`, `pending`, `published` y `publish_error` siguen bloqueando, incluido el cliente antiguo con `confirmRecovery:true`. Para 2030 no se reconvierten filas antiguas `pending/published` en timeout: se conservan literalmente. No se cambian el presupuesto absoluto, el control de conexiones ni la recuperación de otras lecturas.

`response_observed` no garantiza frescura ni atribución inequívoca. Una respuesta duplicada o tardía puede confundirse con un intento posterior incluso después de un rechazo. Esta entrega no resuelve ese límite del protocolo ni desbloquea timeouts. La auditoría conserva el resultado nuevo sin `passwd`; el campo de compatibilidad `manualRecoveryConfirmed` puede ser falso en una apertura normal y no es una garantía de correlación.

`gatewayMqttRecovery.postgres.test.ts` se adapta al nuevo recorrido: tres rechazos intactos, nueva lectura sin confirmación, igualdad identidad/contraseña permitida con exclusión de `passwd`, bloqueo asesor y cuatro estados inciertos conservados. Requiere PostgreSQL 15 desechable; el transporte sigue siendo simulado. No se cambia ninguna migración, 1030, RSSI, alarmas ni presencia B5.

#### Prueba PostgreSQL desechable para el operador (no ejecutada aquí)

Ejecutar desde una copia aislada del commit, con Backend ya compilado y dependencias disponibles; no usar los artefactos de un servicio desplegado. Este ejemplo Linux no publica puertos, no monta `.env` ni volúmenes de datos y no lee credenciales de staging. Copia únicamente compilación, dependencias y migraciones a un directorio temporal propio. La contraseña y JWT son efímeros. No habilitar trazas MQTT.

```bash
set -euo pipefail
task_runner=$(mktemp -d /tmp/horizonst-mqtt-recovery-XXXXXX)
cp -R backend/dist backend/node_modules backend/migrations "$task_runner/"
task_pg="horizonst-mqtt-recovery-$(node -p 'require("crypto").randomUUID()')"
task_password=$(node -p 'require("crypto").randomBytes(32).toString("hex")')
task_jwt=$(node -p 'require("crypto").randomBytes(32).toString("hex")')
task_created=false
trap 'if [ "$task_created" = true ]; then docker rm -f "$task_pg" >/dev/null; fi' EXIT
docker run -d --rm --network none --name "$task_pg" \
  -e POSTGRES_DB=horizonst_mqtt_recovery_test -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$task_password" postgres:15-alpine >/dev/null
task_created=true
task_ready=false
for task_attempt in $(seq 1 60); do
  if docker logs "$task_pg" 2>&1 | grep -q 'PostgreSQL init process complete; ready for start up.' \
    && docker exec "$task_pg" psql -X -v ON_ERROR_STOP=1 -U postgres -d horizonst_mqtt_recovery_test -c 'SELECT 1' >/dev/null 2>&1; then
    sleep 1
    if docker exec "$task_pg" psql -X -v ON_ERROR_STOP=1 -U postgres -d horizonst_mqtt_recovery_test -c 'SELECT 1' >/dev/null 2>&1; then
      task_ready=true; break
    fi
  fi
  sleep 1
done
[ "$task_ready" = true ] || { echo 'PostgreSQL temporal no alcanzó estabilidad'; exit 1; }
docker run --rm --network "container:$task_pg" \
  --mount "type=bind,src=$task_runner,dst=/runner,readonly" -w /runner \
  -e DB_HOST=127.0.0.1 -e DB_PORT=5432 -e DB_NAME=horizonst_mqtt_recovery_test \
  -e DB_USER=postgres -e DB_PASSWORD="$task_password" -e JWT_SECRET="$task_jwt" \
  -e MAIL_ENABLED=false -e MQTT_REQUIRED=false \
  -e GATEWAY_MQTT_RECOVERY_ALLOW_DATABASE_TESTS=true \
  node:20 node --test dist/__tests__/gatewayMqttRecovery.postgres.test.js
unset task_password task_jwt
```

Esperado: 1 prueba aprobada, 0 fallidas, 0 omitidas; no ejecutar con la bandera deshabilitada y confundir un skip con validación. El contenedor PostgreSQL solo se elimina si se adquirió correctamente; el directorio `$task_runner` permanece para revisión y retirada explícita de esa ruta exacta. No queda ninguna base compartida afectada. La nueva prueba no es una captura ni una recuperación física real.

#### Validación de staging y retorno, con autorización independiente

1. Mantener el flag deshabilitado hasta cerrar los pendientes de migración/filtros ya descritos y ejecutar la prueba aislada anterior.
2. Tras despliegue y lectura real expresamente autorizados, abrir una gateway con rechazo histórico: un intento nuevo, únicamente 2030 y ningún 1030/1000/RSSI/alarma. Mantener intactas las filas anteriores.
3. Comprobar fecha y origen observado, datos públicos en el borrador, contraseña vacía y ausencia de `passwd` en HTTP/diario/auditoría/eventos. Si el valor público es también credencial, no adjuntarlo a informes ni capturas. Restaurar propuesta no publica.
4. Con incertidumbre, el servidor rechaza incluso una petición directa confirmada. No limpiar historial para hacer avanzar la prueba. No inferir conexión al destino ni frescura por una respuesta recibida.
5. Para retornar, deshabilitar primero el flag y conservar filtros contra respuestas tardías. Volver al artefacto `0e89c84` si se decide recuperar la política anterior de rechazo de colisiones y recuperación manual; conservar diario y observaciones. No hubo estas acciones en la entrega local.

La migración preexistente `backend/migrations/014_gateway_mqtt_observations.sql`, aplicada transaccionalmente por el runner con ledger/checksum, amplía el CHECK de tipos del diario conservando los anteriores y crea una tabla separada de última observación pública. FK compuesta a gateway/compañía; CHECK JSONB con las 15 claves exactas, sin `passwd`. No modifica filas de inventario ni migraciones publicadas. Esta entrega conserva la migración sin editar y no crea otra.

Variable pública de control: `GATEWAY_MQTT_OBSERVATION_ENABLED=true`, solo en Backend; cualquier otro valor mantiene la función desactivada. Compose general la expone con default `false`; Compose versionado de producción fija `false`. No contiene secretos ni cambia destino MQTT. El Compose externo de producción deberá recibir explícitamente esa variable cuando se autorice habilitar; no se ha editado ni ejecutado.

### Secuencia de habilitación autorizada (pendiente)

1. Ejecutar contra PostgreSQL 15 desechable el harness `node infrastructure/production/tests/production-migrations.postgres.mjs`, siguiendo sus requisitos de runners compilados. Comprobar aplicación de 014, ledger/checksum y segunda ejecución. No usar bases compartidas para esta prueba.
2. Mantener el flag en `false` mientras se instalan, con autorización, los filtros de Backend, Horneo, MQTT UI y cualquier consumidor RFID/externo cuya suscripción pueda recibir estas publicaciones. Revisar sin capturas crudas los hooks/trazas y consumidores adicionales del broker real.
3. Aplicar la migración mediante el runner habitual en el despliegue expresamente autorizado, tras revisar el plan y respaldo; todavía no habilitar 2030 si queda algún consumidor sin protección.
4. Habilitar el flag explícito en el Compose correspondiente únicamente tras cerrar esas comprobaciones. La entrega local no autoriza estas acciones.
5. La validación física posterior requiere autorización independiente: una apertura, confirmar un solo 2030 y ningún 1030/1000/alarma, permisos, campos públicos y fecha. Revisar salida HTTP/auditoría saneada, nunca payload crudo ni contraseña. La observación no prueba conexión al destino indicado.

### Retorno

Primero deshabilitar el flag y dejar terminar las lecturas en curso. Conservar los filtros de privacidad en **todos** los consumidores: respuestas 2030 tardías pueden llegar después. Volver ciegamente a artefactos antiguos de Backend/Horneo/MQTT UI podría exponer el secreto. Si es necesario retirar la interfaz, mantener Backend y consumidores protegidos mediante un artefacto revisado, sin reactivar lecturas. La migración aditiva puede permanecer; conservar diario y observaciones, no borrar históricos ni ejecutar una reversión destructiva. No presentar ausencia de lecturas pendientes como prueba de que nunca llegará un mensaje tardío.

## Validación local y pendientes

- Backend: typecheck, build aislado y suite completa; 290 aprobadas, 0 fallidas, 6 omitidas de PostgreSQL opt-in (296 total).
- Horneo: typecheck, build aislado y suite completa; 164 aprobadas, 0 fallidas, 2 omitidas de PostgreSQL opt-in (166 total).
- MQTT UI: 10 aprobadas, 0 fallidas, 0 omitidas; sintaxis correcta. Sintaxis de ambos frontends comprobada.
- Artefactos de producción: 52 comprobaciones. Contratos del harness de producción: 18 aprobados, 0 fallidos, 0 omitidos.
- Mocks: payload/topic/QoS exactos, respuesta inmediata, inválida/otra MAC, timeout/tardía, concurrencia, permisos/compañía/inactividad, rechazo histórico sin confirmación adicional, igualdad contraseña/identidad, formulario iniciado desde observación, edición durante espera y restauración de propuesta. Se comprueba ausencia del campo `passwd` en persistencia, auditoría, logs, HTTP y eventos; con una credencial ficticia distinta de la identidad se verifica además ausencia de su valor. No se afirma ausencia del valor cuando coincide con un identificador público permitido.
- Parser RFID probado mediante transpilation/ejecución de su código real dentro de Backend; faltan dependencias locales de ese módulo para su typecheck/build completo. UI probada en DOM simulado, no en navegador real.
- Docker local sin daemon: **migración 014 y suite PostgreSQL real pendientes**, no se ha iniciado contenedor. La prueba contractual SQL no sustituye esta validación. No considerar la función habilitable ni la rama validada para despliegue hasta completarla y revisar consumidores reales.

No hubo bases compartidas, MQTT real, hardware, correos, despliegues, push ni merge. No cambia evaluación de presencia, RSSI ni alarmas; el problema independiente del tag `c65b52531bdc` sigue sin resolver por esta tarea.
