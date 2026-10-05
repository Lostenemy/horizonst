# Separación RSSI entre Administración y Horneo

## Diagnóstico comprobado y alcance

Base: `origin/main` actualizado, `0dd1da6b438115fa49008f78453108625fdb76aa`. Rama `codex/gateway-rssi-semantics`. Se ha trazado código y esquema, no los registros de staging/producción. La investigación del tag `c65b52531bdc`, sus salidas/reentradas y la cámara operativa sigue separada: este cambio no la atribuye a RSSI ni la declara resuelta.

| Concepto | Fuente y recorrido | Consumo / escritura |
| --- | --- | --- |
| Señal observada del tag | Paquete MQTT → `presence/payload-parser.ts` → `event.rssi`; último valor con fecha en `tag_gateway_presence_state.last_rssi` | Señal de una detección, no configuración ni umbral. El actual parser y almacenamiento no cambian. |
| Umbral local de presencia | DB Horneo `gateways.rssi_threshold` → `GET /gateways` → inventario; `compliance.service.ts` consulta ese mismo campo | `evaluatePresenceSignal`: sesión abierta usa umbral local; apertura añade margen configurado, limitado a 0. PATCH local modifica solamente esta política. No es filtro físico. |
| Filtro físico guardado central | DB Administración `gateways.rssi_threshold` → `/api/gateways` y API interna limitada a compañía → formulario Administración; Horneo recibe ahora un campo separado `hardware_rssi_threshold` | `apply-rssi` → `configureGatewayRssi` → comando 1042; solo ACK satisfactorio actualiza registro central. No actualiza el umbral local de Horneo. |
| Filtro físico solicitado | Entrada explícita validada → confirmación → POST; diario `hardware_gateway_commands`, comando `rssi_config`, payload `data.rssi`, fechas/estado/result_code | Una solicitud puede fallar/expirar/ser ambigua sin cambiar el registro central. El diario conserva el intento, no una lectura física. |
| ACK y estado físico | Listener/ejecutor existentes validan gateway, msg_id y resultado; sus límites de correlación siguen vigentes | Un ACK no prueba el valor actual tras otros cambios/reinicios. Las lecturas soportadas (`gatewayObservedReads.ts`) NO incluyen RSSI. No se añade ni inventa una lectura 2042. |

Esquemas: Backend migración 002 y Horneo 001/011 establecen columnas independientes con rango -127..0 y default histórico -127. Un valor existente puede proceder de bootstrap/default y no de un comando probado: la UI lo etiqueta **guardado**, no **ACK confirmado**. El ACK se consulta en el diario con su fecha y resultado.

La discrepancia visual tenía dos causas: la misma etiqueta ambigua para conceptos distintos y el fallback visual `?? -127`. Además, la resolución dual marcaba los dos conceptos como divergencia y la acción legacy de Horneo podía copiar su umbral local al físico si se omitía el valor. No se demuestra que ambos deban ser iguales. No procede conciliarlos mediante UPDATE, sincronización o migración.

La reconciliación inicial de Fase B copió el RSSI local al inventario central (documentado en `docs/hardware-manager-phase-b.md`), por lo que podían comenzar iguales. Eso no establece una sincronización posterior ni cambia sus consumidores actuales. La comparación RSSI se retira del diagnóstico de divergencia de identidad; MAC/ID siguen comparándose. `resolveHardwareGateway` solo se consume en la ruta de resolución informativa, no en la evaluación de presencia.

## Corrección acotada y compatibilidad

- Administración distingue propuesta física, registro guardado y ausencia de lectura. Sin registro válido el campo queda vacío, no -127/0 implícitos. Confirmación explícita, ACK descrito como ACK; tras éxito se actualiza la indicación guardada sin afirmar lectura física.
- El historial de comandos añade «RSSI físico solicitado», extraído como escalar del payload solo para msg_id=1042; no expone el payload completo ni contraseñas. Conserva fecha de solicitud, estado y resultado/ACK; la API conserva también `ack_at`. Un valor solicitado con rechazo/timeout no se presenta como guardado o físicamente observado.
- Horneo conserva `rssi_threshold` y su semántica local, añade `hardware_rssi_threshold` y `hardware_rssi_state`. Si API central falla/está deshabilitada/no encuentra gateway o el filtro es inválido, el físico queda no disponible, nunca sustituido por el local. El alcance de la API central y los permisos de las rutas no cambian.
- Inventario muestra ambos conceptos con ayuda; no se añaden botones técnicos ni se habilitan ediciones antes ocultas. En la versión actual, el inventario no presenta controles RSSI; conserva funciones legacy y PATCH de superadministrador. El guardado legacy ahora envía únicamente el campo local permitido, sin MAC/descripción centrales.
- La API legacy `POST /gateways/:id/apply-rssi` conserva cuerpos explícitos `rssi`, `rssiThreshold` o `rssi_threshold`, pero rechaza cuerpo sin valor (400) en vez de convertir silenciosamente política local en comando físico. Las pantallas legacy deben enviar una propuesta explícita. No se cambia el payload 1042, ACK, ACL, QoS, B5 ni alarmas.
- Abrir inventarios/formularios solo realiza consultas HTTP/DB de lectura. No publica ni inicia lecturas físicas. Solo acciones explícitas conservadas pueden solicitar comandos.

**Evaluación de presencia: sin cambios.** No se modifica `compliance.service.ts`, `presence-signal-policy.ts`, RSSI recibido, márgenes, timeouts, sesiones ni datos existentes. El fallback operativo histórico de `compliance.service.ts` permanece sin cambio: quitarlo sería otra decisión sobre política, no ocultar un error de formulario. No hay migración/backfill ni reconciliación aprobada.

## Validación / continuación

Validación local completada: Backend typecheck/build correctos, 258 pruebas (253 aprobadas, 0 fallidas, 5 omitidas); Horneo typecheck/build correctos, 165 pruebas (163 aprobadas, 0 fallidas, 2 omitidas). Sintaxis de ambos frontend JS correcta. Regresiones ejecutables de API y DOM simulado con umbral local -70 y físico -60, ausencia/error central, permisos/ámbito, UI sin comandos al abrir, rechazo de propuesta implícita, historial escalar y actualización solo tras ACK satisfactorio. Las pruebas existentes de B5, MQTT y presencia siguen pasando. No cambia Store.

Los builds se realizaron en directorios propios, sin sobrescribir `dist` no versionados preexistentes. Diff y revisión de secretos sin hallazgos. Las 7 pruebas omitidas son PostgreSQL opt-in: no se ha ejecutado PostgreSQL ni verificado contra una base real la consulta del escalar JSON del historial. No se requiere migración; utiliza operadores JSONB ya presentes y compatibles con PostgreSQL 15. La UI se ha probado mediante DOM simulado, no navegador real. Pendiente: validación pasiva del artefacto desplegado y revisión de valores reales por el operador; no se ha validado físicamente ningún filtro ni ACK de gateway real. No hay reconciliación de datos aprobada ni ejecutada.

## Validación pasiva y retorno (operador, no ejecutados)

1. Revisar artefacto completo Backend + public y Horneo + web; desplegar solo con autorización distinta. No requiere migraciones ni variables nuevas. Conservar los registros y conexiones existentes.
2. Con el mismo ámbito autorizado, abrir ambas pantallas sin pulsar Solicitar/aplicar ni lectura física. Comparar por MAC normalizada e ID central: Horneo columna local vs su DB, columna física central vs Administración. Diferencias son válidas, no se corrigen automáticamente. Revisar ayuda y ausencia de destinos/umbrales de respaldo.
3. Consultar el diario existente por la misma gateway y fecha; distinguir valor solicitado, ACK y registro guardado. No inferir estado físico actual. Para datos ausentes/errores probar solamente fixtures aislados, no provocar fallos del servicio compartido.
4. Verificar que abrir/restaurar no inicia POST de comandos ni lecturas; revisar tráfico HTTP pasivamente sin publicar tokens o datos personales. Pruebas físicas requieren autorización separada.
5. Retorno: restaurar los artefactos anteriores de ambas aplicaciones como unidad. No revertir DB ni enviar 1042. Se recuperan etiquetas ambiguas/fallback anteriores, por lo que el operador debe evitar interpretar ambos valores como uno solo. Un rollback de UI no deshace comandos que alguien haya ejecutado.

Sin push, merge, despliegue, acceso a servidores/bases compartidas, MQTT real ni hardware. No se han modificado umbrales reales.
