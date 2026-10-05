# Lectura pública de configuración MQTT (2030)

## Alcance y diagnóstico

Base: `0dd1da6b438115fa49008f78453108625fdb76aa`, rama `codex/gateway-mqtt-observed-read`. Antes, Gestión técnica mostraba una propuesta por entorno y registros guardados, no una lectura física. Ahora separa **Configuración propuesta** y **Configuración MQTT observada**, con fecha de recepción y estado. La observación no rellena el formulario ni su contraseña.

La guía `guia-referencia-mqtt-mkgw3.pdf`, página 10, confirma la petición 2030 sin `data`; no describe su respuesta. Se implementa exclusivamente la respuesta aportada por el operador: `msg_id:2030`, MAC y objeto `data`. El ejemplo 1030 de la guía usa LWT `offline`, distinto del LWT JSON 3999 observado. No se inventa compatibilidad: ese formato alternativo y respuestas fuera del contrato quedan rechazados. No se deduce compatibilidad con otros firmwares.

## Contrato y autorización

- `POST /api/gateways/:gatewayId/read-configuration/mqtt_configuration`: cuerpo vacío para lectura ordinaria o exclusivamente `{confirmRecovery:true}` tras confirmación manual; permisos técnicos, gateway activa y alcance central de compañía. Backend resuelve MAC y topic. Publica únicamente `{device_info:{mac:MAC_CENTRAL_NORMALIZADA},msg_id:2030}` en `gw/{mac}/subscribe`, QoS 0. La confirmación no forma parte del payload MQTT.
- `GET /api/gateways/:gatewayId/mqtt-observation`: consulta pasiva, mismos permisos y ámbito, `Cache-Control: no-store`. Devuelve última observación pública y fecha, o ausencia explícita. Con función deshabilitada no consulta la tabla nueva.
- Respuesta entrante exclusivamente en `gw/{mac}/publish`; MAC del payload estricta y coincidente, mensaje numérico 2030, validación de esquema/tipos/rangos. MAC contradictoria no confirma la lectura. La inexistencia, inactividad y recursos ajenos mantienen 404. No se habilitan lecturas para gateways sin compañía.

Campos públicos permitidos: `security_type`, `host`, `port`, `client_id`, `username`, `sub_topic`, `pub_topic`, `qos`, `clean_session`, `keepalive`, `lwt_en`, `lwt_qos`, `lwt_retain`, `lwt_topic`, `lwt_payload`. LWT se valida y reconstruye canónicamente como 3999 para la misma MAC; no se retiene texto JSON arbitrario.

No se cambian ACL, parámetros físicos, QoS de otros comandos, conexiones ni los flujos 1030/1000. Abrir la sección inicia una lectura 2030, nunca escrituras, reinicios o alarmas. Restaurar la propuesta no inicia otra lectura.

## Coordinación y límites de correlación

Una lectura por apertura; actualización manual explícita, botón bloqueado mientras espera y control de doble clic. Generaciones de pantalla impiden que una respuesta pendiente pinte otra gateway. El bloqueo asesor compartido `(7246, gatewayId)` evita publicaciones concurrentes entre procesos. Se conserva el presupuesto absoluto y la destrucción de conexiones vencidas de la infraestructura existente.

El protocolo no aporta identificador de intento. `response_observed` significa respuesta pública validada y persistida, **no atribución inequívoca, frescura del contenido ni conexión al broker mostrado**. La fecha es recepción local. Incluso tras un éxito, una respuesta duplicada puede confundirse con una observación posterior; la UI y API mantienen `correlation: unverified`.

Tras un timeout o publicación incierta, el historial bloquea nuevos 2030 de esa gateway, también al reabrir. No hay reintentos automáticos ni procedimiento de limpiar timeouts para eludirlo. Una respuesta tardía válida puede actualizar la última observación sin revivir el resultado expirado. La resolución de esa incertidumbre requiere un contrato adicional del fabricante o una decisión operativa revisada; no se ofrece un desbloqueo ciego.

## Protección de secretos y capturas

La gateway devuelve `passwd`. Solo el objeto público validado sale de la entrada; campos desconocidos se descartan, texto que reproduce la contraseña literalmente, codificada en URL o base64 se rechaza, y errores 2030 no incluyen payload ni excepción del transporte. No se devuelven contraseña, hash, longitud o huella. No se guarda en almacenamiento del navegador, diario, auditoría, HTTP ni SSE. No es una garantía sobre transformaciones arbitrarias de un secreto en campos que el firmware presente como públicos.

Backend intercepta 2030 antes de ACK y captura cruda, incluido el mensaje malformado identificable como 2030 recibido por MK4. Horneo descarta 2030 antes de presencia/emergencias y su parser también lo filtra. MQTT UI descarta antes de logs, waiters GATT y SSE. El parser RFID demo evita el fallback de EPC crudo para 2030 si su suscripción configurada lo recibe. El observer versionado consulta métricas/estado con `vmq-admin`; no consume mensajes MQTT. La configuración versionada de VerneMQ habilita autenticación PostgreSQL, no un hook de persistencia cruda de publicaciones.

Esto no certifica consumidores externos, extensiones del broker, trazas activas o capturas de red no presentes en el repositorio. **La función queda deshabilitada por defecto** hasta revisar ese recorrido real. No activar trazas crudas para validar 2030: contendrían la contraseña real. No inspeccionar ni adjuntar el secreto al repositorio.

## Migración y configuración

### Rechazo seguro de identidad/credencial (integración RSSI/MQTT)

La reproducción utiliza únicamente una identidad y credenciales ficticias. Si la contraseña coincide con la MAC normalizada, `client_id` o `username`, el contenido tiene una colisión entre identidad pública y secreto: no se considera seguro mostrarlo por el hecho de ser una MAC. La lectura termina en `invalid_response` / HTTP 422 con `errorCode: mqtt_observation_identity_secret_collision`, no como un error de tipos. Si otro campo público reproduce el secreto literalmente, en URL o base64, el código es `mqtt_observation_secret_in_public_field`; los demás rechazos conservan `mqtt_observation_invalid_response`. Los códigos son fijos y no contienen valores, fragmentos, longitud, hash ni huella del secreto.

2030 acepta espacios y saltos de línea en el JSON LWT 3999 de la misma MAC; se compacta y reconstruye antes de exponerlo, y se repite la protección de secretos sobre la representación final. Esto no modifica las reglas de escritura 1030. 2040 sigue siendo la lectura independiente de `scan_switch`.

El diario conserva el rechazo con código fijo y payload reducido a `{msg_id:2030}`. La API pasiva consulta el último resultado completado y oculta observaciones anteriores si fue rechazado, también ante un rechazo antiguo sin código específico. Se conservan las filas históricas. La UI borra los valores observados anteriores, explica el motivo y evita nuevas lecturas automáticas al reabrir o recargar; la recuperación manual confirmada se describe a continuación. No publica comandos diagnósticos ni reintenta automáticamente.

Para visualizar la configuración completa de una identidad que también es contraseña, primero se requiere cambiar la credencial mediante un procedimiento autorizado, fuera de esta entrega, y revisar que no aparezca en ningún campo público. Después debe solicitarse explícitamente una nueva lectura técnica autorizada; un resultado público válido se registra como un resultado nuevo, sin convertir el rechazo histórico en éxito. No se implementa rotación, desbloqueo automático ni eliminación de timeouts históricos. La revalidación de objetos almacenados comprueba estructura, tipos y LWT, pero no puede probar su seguridad respecto a una credencial actual desconocida: no se guarda ni reconstruye esa credencial. Un cambio externo de contraseña sin una lectura posterior no queda detectado por este mecanismo. Tampoco se certifica la seguridad de identidades mostradas en otros inventarios o propuestas existentes.

Validación de esta corrección: Backend 284 pruebas (279 aprobadas, 0 fallidas, 5 omitidas); Horneo 166 (164 aprobadas, 0 fallidas, 2 omitidas). Typecheck y builds aislados correctos. MQTT UI 10/10, contratos de producción 18/18 y artefactos 52/52; sintaxis frontend y `git diff --check` correctos. Se prueban colisión, duplicados de secreto, canonicalización, validación almacenada, códigos HTTP/auditoría, ámbito de compañía y ausencia de reintentos desde la UI. Transporte y base de datos simulados; las suites PostgreSQL opt-in y la nueva consulta pasiva no se han validado en PostgreSQL real en esta entrega. No se cambia ninguna migración ni se incorpora la rama de presencia B5. El flag sigue deshabilitado por defecto; las condiciones pendientes de habilitación y retorno siguientes permanecen vigentes.

### Recuperación manual de un rechazo 2030

El bloqueo permanente detectado en staging era de interfaz: `invalid_response` se añadía al mismo conjunto que un resultado incierto, se retornaba antes del POST y se deshabilitaba el botón. Ahora el rechazo de validación se conserva separado. Un diagnóstico histórico genérico significa **causa desconocida**, no evidencia de colisión. Abrir, recargar, desplegar o cambiar una credencial no solicita otra lectura rechazada.

Después de revisar/corregir la configuración, el técnico autorizado puede pulsar **Recuperar lectura MQTT rechazada…**. La confirmación identifica la gateway por su ID central (no reproduce una identidad potencialmente secreta) y explica que publicará un único 2030. Cancelar, doble clic, reapertura o cambio de gateway durante la confirmación no publican. El botón ordinario de actualización también exige confirmación explícita.

El servidor acepta únicamente la confirmación booleana literal, comprueba rol/compañía/actividad y, bajo el mismo bloqueo asesor `(7246,gatewayId)`, revisa el historial antes de insertar el nuevo intento. Sin confirmación, un rechazo previo devuelve HTTP 409 con `mqtt_observation_recovery_required`, sin publicación. `timed_out`, `pending`, `published` y `publish_error` siguen bloqueando incluso con confirmación. Para 2030 no se reconvierten filas `pending/published` antiguas en timeout para recuperar: se conservan literalmente. La recuperación de estados antiguos de otras lecturas permanece igual. Los resultados completados se ordenan por recepción o, si no existe, creación; no se ignora un rechazo histórico por carecer de fecha de recepción.

Cada recuperación crea su propio diario y vuelve a pasar todos los filtros de esquema, MAC/topic, privacidad y persistencia. Si persiste la colisión, termina otra vez en 422, oculta los valores anteriores y vuelve a requerir revisión y confirmación. Si recibe un objeto público válido, guarda solo ese objeto, registra el nuevo resultado y audita `manualRecoveryConfirmed:true`. No se modifica el rechazo anterior. Continúan los límites de correlación sin identificador del fabricante: `response_observed` no garantiza frescura ni atribución inequívoca, y una respuesta tardía puede confundirse con un intento posterior. Esta recuperación no resuelve ese límite ni desbloquea timeouts.

Validación de la recuperación: Backend 294 pruebas (288 aprobadas, 0 fallidas, 6 omitidas); Horneo 166 (164 aprobadas, 0 fallidas, 2 omitidas), con typecheck y builds aislados. MQTT UI 10/10, contratos 18/18, artefactos 52/52 y sintaxis frontend correctos. La nueva `gatewayMqttRecovery.postgres.test.ts` está pendiente de ejecución real: Docker local no tiene daemon. Comprueba PostgreSQL 15, aplica las migraciones originales 009/010/011/014 en un esquema propio, conserva tres rechazos, exige confirmación, persiste éxito y nuevo rechazo, comprueba bloqueo asesor y los cuatro estados inciertos sin alterar sus filas. MQTT está simulado también en esa prueba. No se cambia ninguna migración, 1030, RSSI, alarmas ni presencia B5.

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
2. Tras un despliegue y una lectura real expresamente autorizados, abrir una gateway con rechazo histórico: no debe crear fila ni publicar; no debe mostrar observaciones anteriores ni afirmar colisión si el diagnóstico era genérico.
3. Revisar/corregir la configuración o credencial por el procedimiento autorizado. Cancelar la confirmación: cero intentos. Confirmar **Publicar una lectura 2030**: una fila nueva, un resultado independiente y auditoría saneada. No copiar cuerpos crudos ni secretos. Comprobar estados y conteos, no interpretar un ACK como conexión al destino.
4. Con resultado rechazado, reapertura y recarga siguen sin repetir; con incertidumbre, el servidor rechaza incluso una petición directa confirmada. No limpiar historial para hacer avanzar la prueba.
5. Para retornar, deshabilitar primero el flag, conservar filtros contra respuestas tardías y volver al artefacto anterior revisado si se decide retirar esta recuperación manual. El retorno a `7e20619` restaura el bloqueo manual permanente, no modifica datos ni hace nuevas lecturas; conservar diario y observaciones. No hubo estas acciones en la entrega local.

Nueva `backend/migrations/014_gateway_mqtt_observations.sql`, aplicada transaccionalmente por el runner con ledger/checksum: amplía el CHECK de tipos del diario conservando los anteriores y crea una tabla separada de última observación pública. FK compuesta a gateway/compañía; CHECK JSONB con las 15 claves exactas, sin `passwd`. No modifica filas de inventario ni migraciones publicadas. El helper y esta migración preexistentes de la implementación parcial se conservaron sin editar.

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

- Backend: typecheck, build aislado y suite completa; 262 aprobadas, 0 fallidas, 5 omitidas de PostgreSQL opt-in (267 total).
- Horneo: typecheck, build aislado y suite completa; 161 aprobadas, 0 fallidas, 2 omitidas de PostgreSQL opt-in (163 total).
- MQTT UI: 10 aprobadas, 0 fallidas, 0 omitidas; sintaxis correcta. Sintaxis de ambos frontends comprobada.
- Artefactos de producción: 52 comprobaciones. Contratos del harness de producción: 18 aprobados, 0 fallidos, 0 omitidos.
- Mocks: payload/topic/QoS exactos, respuesta inmediata, inválida/otra MAC, timeout/tardía, concurrencia, permisos/compañía/inactividad, propuesta independiente, doble clic/cambio de gateway, y secreto ficticio rastreable ausente de persistencia, auditoría, logs, HTTP y eventos.
- Parser RFID probado mediante transpilation/ejecución de su código real dentro de Backend; faltan dependencias locales de ese módulo para su typecheck/build completo. UI probada en DOM simulado, no en navegador real.
- Docker local sin daemon: **migración 014 y suite PostgreSQL real pendientes**, no se ha iniciado contenedor. La prueba contractual SQL no sustituye esta validación. No considerar la función habilitable ni la rama validada para despliegue hasta completarla y revisar consumidores reales.

No hubo bases compartidas, MQTT real, hardware, correos, despliegues, push ni merge. No cambia evaluación de presencia, RSSI ni alarmas; el problema independiente del tag `c65b52531bdc` sigue sin resolver por esta tarea.
