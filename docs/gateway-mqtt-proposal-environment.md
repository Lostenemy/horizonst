# Propuesta MQTT de gateways por entorno

Fecha: 04-10-2026. Rama `codex/gateway-mqtt-environment-preset`, basada en `origin/main` actualizado (`25eceac9643cfa8329eb2613495ed5dfa427167b`). Ninguna gateway se ha leído físicamente, configurado o reiniciado durante el desarrollo.

## Causa y separación de datos

`horizonstMqttPreset` en navegador y `buildHorizonstMqttPreset` en Backend mantenían plantillas independientes con `mqtt.horizonst.com.es` fijo. El formulario aplicaba esa propuesta al abrir Gestión técnica, sin consultar la configuración real de la gateway. La copia del navegador se ha eliminado: el builder central es la única fuente de los valores de propuesta.

La pantalla distingue ahora:

- **Configuración propuesta**: campos editables; aviso explícito de que no se han leído de la gateway. Cargar/restaurar solo obtiene la propuesta pública por HTTP.
- **Comandos registrados**: destinos solicitados, actor/fecha y resultados 1030/1000. No se copian valores del diario al formulario; ni el diario ni un ACK prueban conexión al nuevo broker.
- **Configuración observada**: respuestas reales de las lecturas disponibles con fecha. Actualmente son ajustes BLE/LED, no una lectura de la configuración MQTT actual. No se inventa esa lectura ni se envía ninguna al abrir el panel.

## Variable pública y Compose

Única variable nueva del servicio Backend/app: `GATEWAY_MQTT_PRESET_ENVIRONMENT`. Solo admite literalmente:

| Valor | Host propuesto | Puerto | Seguridad |
| --- | --- | --- | --- |
| `staging` | `mqtt.horizonst.com.es` | 8883 | TLS, security_type=1 |
| `production` | `mqtt.horizonst.es` | 8883 | TLS, security_type=1 |

No se usa `NODE_ENV`, `MQTT_HOST`, la URL interna del broker, el Host de la petición ni credenciales SMTP/MQTT para elegir destino. Los demás valores del preset se conservan: MAC normalizada como client_id/username, topics exactos, QoS 0, clean_session 1, keepalive 60 y parámetros LWT originales. No cambian ACL, protocolos o certificados.

- `docker-compose.yml`: transmite `${GATEWAY_MQTT_PRESET_ENVIRONMENT:-}` al contenedor. **Sin valor queda vacío**, deliberadamente sin default de staging; el operador debe elegir staging o production para su entorno. No impide arrancar otros servicios: únicamente deja la propuesta no disponible.
- `infrastructure/production/docker-compose.production.yml`: declara explícitamente `GATEWAY_MQTT_PRESET_ENVIRONMENT: production` en `app`. La validación estática comprueba ese valor, manteniendo `MQTT_HOST: vernemq` separado.
- **Compose externo de producción**: no se ha accedido a él ni modificado. Debe declarar en su servicio Backend/app `GATEWAY_MQTT_PRESET_ENVIRONMENT: production`, o transmitir esa variable pública con dicho valor. Esto requiere revisión y autorización del operador, no copiar el valor staging ni cambiar la conexión de las cinco gateways existentes.
- Staging debe transmitir `GATEWAY_MQTT_PRESET_ENVIRONMENT=staging` mediante su mecanismo de configuración autorizado. No se han editado archivos `.env` de ejemplo ni reales.

## API y seguridad del formulario

`GET /api/gateways/:gatewayId/mqtt-preset` devuelve únicamente `{source:'proposed', environment, data}`. `data` omite completamente `passwd`, incluye identificadores derivados de la MAC central y los campos públicos necesarios del formulario. Nunca devuelve el objeto de configuración del servidor, usuarios/contraseñas del broker interno o históricos. Respuesta `Cache-Control: no-store`; sin parámetros para seleccionar un entorno arbitrario.

Autenticación y autorización técnica existentes: ADMIN/hardware_superadmin o técnico dentro del alcance de compañía. Gateway ajena o inactiva: 404; readonly: 403; sin autenticar: 401. Gateway sin compañía solo para global, igual que 1030 existente. Un error de configuración ausente/inválida da 503 útil y genérico, sin copiar su valor ni secretos. No se ejecuta MQTT ni se crea un diario de comando/lectura en este GET. No se modifican permisos.

El navegador valida el contrato recibido, vacía campos/contraseña/confirmación al cargar o restaurar, y muestra carga/error/reintento. Error HTTP, contrato inválido o variable ausente nunca recuperan el host de staging por fallback. El formulario de envío queda bloqueado hasta cargar una propuesta válida. El fallo de propuesta no bloquea otras funciones técnicas ni modifica gateways.

El destino sigue editable para traslados autorizados. Tras validación y MAC exacta, una confirmación muestra **gateway/MAC, host, puerto y TLS/SIN TLS** del snapshot que se enviará. Los campos se bloquean mientras se confirma/envía; una segunda pulsación pendiente no envía otra orden. El texto dinámico de la confirmación se escapa. Cancelar no publica, y cambiar de gateway durante la confirmación impide enviar a otra identidad. Los callbacks tardíos de propuesta no pisan una restauración más reciente.

La contraseña solo existe transitoriamente en el campo/memoria de esa acción y en el payload de transporte necesario; no se carga de históricos ni se guarda en localStorage/sessionStorage. Se vacía el campo antes de la confirmación/envío, en validación fallida, cancelación, restauración, error y finalización; al finalizar también se vacía la referencia `data.passwd`. No se promete borrado criptográfico de strings en el motor JS ni impedir un gestor externo del navegador. `autocomplete` permanece desactivado/new-password. La UI usa mensajes genéricos ante errores de envío para no reflejar una excepción que contenga la contraseña.

El POST existente conserva su validación estricta, normalización, MAC de confirmación, ámbito, idempotencia, redacción y secuencia **1030 → ACK satisfactorio → 1000**. La variable regula una **propuesta**, no es una política de destinos: un cliente técnico autorizado puede proponer manualmente otro host válido por el mismo POST. No hay reintentos físicos automáticos nuevos. Un ACK solo acredita aceptación según el diario y sus límites de correlación existentes, no que la gateway haya conectado al nuevo broker.

## Verificación y límites

Pruebas unitarias de ambas plantillas y ausencia/invalidez; API HTTP con usuarios/compañías simulados; apertura/restauración y errores/carreras/UI ejecutada en VM; confirmación y destino manual, contraseña efímera, bloqueo de duplicados. La suite mantiene las regresiones de ACK, timeout, 1030/1000, autorización, idempotencia y secretos en HTTP/diario/auditoría/logs con gateway/MQTT simulados.

No se requiere migración ni base real para esta corrección. Pruebas PostgreSQL opt-in no ejecutadas. No se han probado conexión/TLS de brokers, DNS, entrega de hardware ni configuración del Compose externo. La UI se valida mediante DOM simulado ejecutable, no se presenta como una prueba de navegador real o del despliegue.

Validación local: Backend typecheck y build correctos; suite completa de 254 pruebas, 249 aprobadas, 0 fallidas y 5 omitidas (PostgreSQL opt-in). Comprobación de sintaxis del frontend correcta; artefactos de producción 52/52 y contratos del harness 18 aprobados, 0 fallidos, 0 omitidos. Build generado en un directorio propio de validación, sin sobrescribir los `dist` no versionados preexistentes. No cambian Horneo, dependencias ni lockfiles. Revisión final de diff y secretos sin hallazgos.

## Despliegue y retorno propuestos (no ejecutados)

1. Revisar commit y resultados en una copia de validación sin `.env` compartidos. Instalar dependencias con lockfile y ejecutar desde Backend `npm run typecheck`, `npm test`; comprobar sintaxis JS y artefactos Compose con `node infrastructure/production/tests/validate-production-artifacts.mjs` desde la raíz. La prueba estática renderiza Compose sin iniciar servicios.
2. Operador autorizado: declarar la variable pública correcta en el servicio app real de staging/producción. Revisar por separado el Compose externo de producción. No cambiar MQTT_HOST/usuarios/ACL, ni tocar las gateways conectadas. Aprobar artefacto nuevo de Backend + public juntos; no mezclar frontend nuevo con backend sin `/mqtt-preset`.
3. Tras autorización futura, aplicar únicamente el artefacto/configuración Backend correspondiente. Esta entrega no ejecuta despliegue, reinicio ni comandos. No aplicar migraciones por este cambio.
4. Validación pasiva: abrir Gestión técnica y comprobar host, 8883, TLS y etiqueta «propuesta» por entorno. Restaurar y comprobar contraseña vacía. Inspeccionar GET autenticado del preset sin exponer tokens: ningún `passwd` ni configuración privada; cero publicaciones/lecturas físicas. No pulsar «Enviar» para validar ni cambiar las cinco conexiones existentes.
5. Comprobar ausencia/invalidez en fixture aislado, nunca cambiando la configuración del servicio compartido para provocar fallos. Carga/error visible, campos vacíos y botón bloqueado; historial/observaciones separados. Una migración real de broker requiere una autorización distinta y comprobación posterior de conexión.
6. **Retorno**: el esquema no cambia. Revertir Backend y public como unidad al artefacto anterior, conservando diarios y observaciones. El formulario anterior vuelve a contener la propuesta fija de staging: deshabilitar su uso operativo por procedimiento hasta recuperar el artefacto corregido, **no usarlo en producción**. La variable nueva puede permanecer ignorada por el artefacto anterior. Retornar la aplicación no revierte una configuración que un operador hubiera enviado a hardware: no existe rollback remoto garantizado y no se debe enviar ninguna orden como parte de este retorno.

No hay push, merge, despliegue, servidores/bases compartidas, correo, publicaciones MQTT reales, cambios de contraseña/certificados/ACL/Nginx ni acciones sobre hardware. El traslado de gateways a producción permanece pausado.
