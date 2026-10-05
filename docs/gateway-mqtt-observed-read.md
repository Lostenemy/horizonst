# Lectura pública de configuración MQTT (2030)

## Alcance y diagnóstico

Base: `0dd1da6b438115fa49008f78453108625fdb76aa`, rama `codex/gateway-mqtt-observed-read`. Antes, Gestión técnica mostraba una propuesta por entorno y registros guardados, no una lectura física. Ahora separa **Configuración propuesta** y **Configuración MQTT observada**, con fecha de recepción y estado. La observación no rellena el formulario ni su contraseña.

La guía `guia-referencia-mqtt-mkgw3.pdf`, página 10, confirma la petición 2030 sin `data`; no describe su respuesta. Se implementa exclusivamente la respuesta aportada por el operador: `msg_id:2030`, MAC y objeto `data`. El ejemplo 1030 de la guía usa LWT `offline`, distinto del LWT JSON 3999 observado. No se inventa compatibilidad: ese formato alternativo y respuestas fuera del contrato quedan rechazados. No se deduce compatibilidad con otros firmwares.

## Contrato y autorización

- `POST /api/gateways/:gatewayId/read-configuration/mqtt_configuration`: cuerpo vacío; permisos técnicos, gateway activa y alcance central de compañía. Backend resuelve MAC y topic. Publica únicamente `{device_info:{mac:MAC_CENTRAL_NORMALIZADA},msg_id:2030}` en `gw/{mac}/subscribe`, QoS 0.
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
