# Disponibilidad operativa de tags y pertenencia central

Fecha: 04-10-2026. Rama `codex/horneo-tag-company-availability`, creada desde `origin/main` actualizado en `febf414b1e18eb56a5f6d000c02c21c3c3787e5c`. Sin cambios de esquema, permisos, políticas B5 o comandos.

## Causa comprobada

La versión base de `GET /tags` conservaba todas las filas locales, incluso cuando un listado central satisfactorio no contenía el dispositivo enlazado. Añadía `central_not_found` sin cambiar el `active` local; `renderTagOptions` utilizaba únicamente ese estado. La ruta `POST /workers/:id/assign-tag` comprobaba trabajador activo y enlace entero, pero **no comprobaba pertenencia/estado central antes de escribir**. Por tanto, no era solo un fallo visual.

Administración filtra tanto `/api/internal/v1/hardware/devices` como `/devices/:id` por `servicePrincipal.companyId`. Una ausencia en ese alcance significa «no disponible para esta compañía», no permite distinguir desasignación, transferencia a otra compañía o baja central. No se amplía el alcance para investigar recursos ajenos. El caso de staging aportado por el usuario se usa solo como evidencia; las pruebas utilizan IDs/MAC ficticios distintos.

## Contrato implementado

`tag-availability.service.ts` separa la disponibilidad para nuevas asignaciones de la resolución usada por presencia/acciones físicas. No modifica el cliente compartido, su fallback ni la caché de eventos.

| Evidencia | Inventario operativo | Nuevas asignaciones |
| --- | --- | --- |
| Listado central 200 completo y válido, enlace ausente | Omitido; overlay conservado | Consulta puntual fresca: 404 contractual → 409 |
| Dispositivo presente y autorizado, activo/status active y B5 compatible | Disponible con identidad local original | Permitidas tras consulta fresca |
| Presente, pero inactivo/status distinto/tipo incompatible/política denegada | Visible con estado central, no elegible | 409, sin cambiar asignaciones |
| Timeout, caída, 401/403/429/5xx, JSON inválido, contrato incompleto, IDs duplicados | Referencias conservadas con `unverified`; aviso explícito | 503, sin cambiar asignaciones |
| 404 del endpoint de listado | Sin verificar, nunca listado vacío confirmado | No autoriza |
| 404 puntual sin `{message: "Device not found"}` del contrato Backend | No acredita ausencia | 503 |
| Enlace local ausente o discrepancia ID/MAC | Sin verificar | Rechazada antes de escribir |
| Hardware Manager deshabilitado | Referencias locales conservadas, sin verificar | 503: modo local no concede nuevas autorizaciones |

El listado requiere array, IDs positivos únicos, MAC válida, compañía UUID, estados con tipos correctos y política con cuatro booleanos. Una fila malformada invalida la evidencia de completitud: no se usa para ocultar los restantes overlays. Las respuestas centrales actualizan solo la representación enviada al cliente, nunca la fila local. `assignment_available` y `availability_status` son campos de respuesta, no columnas nuevas.

El selector exige `assignment_available=true` y `availability_status=available`; no usa el `active` local para conceder acceso. Un fallo central conserva inventario con aviso y bloquea el selector, sin representar una desasignación. La pantalla de asignaciones conserva trabajadores, tags actuales e histórico incluso si ya no son elegibles. Si no hay opciones verificadas, deshabilita selector y botón con mensaje. La reasignación de compañía recupera la disponibilidad en la siguiente lectura válida con el mismo `tags.id` y `hardware_device_id`; no inserta otro overlay.

Cada POST de asignación consulta **por ID reconciliado**, con autenticación de servicio ya existente, sin caché de aplicación y `cache: no-store`. Verifica ID, MAC, contrato, estado y política. Nunca decide por una MAC alternativa después de perder el enlace. Todas estas comprobaciones preceden los UPDATE/INSERT existentes; el rechazo no cierra una asignación anterior.

Se reutiliza `isOperationalB5` sin cambios: no se inventan nuevas capacidades ni se modifica el significado de `typeActive` o la operación de B5 existentes con catálogo desactivado. Autenticación y roles de las rutas permanecen intactos.

## Asignaciones existentes y sesiones abiertas

No se borra, desactiva, desasigna ni cierra nada al consultar inventario o al perder pertenencia central. No se modifica `worker_tag_assignments`, `cold_room_sessions`, informes, alertas o incidentes en respuesta a una desasignación de compañía. Una **nueva asignación autorizada solicitada por el usuario** mantiene la semántica previa de cerrar asignaciones anteriores; no se añade una reconciliación automática.

Las sesiones ya abiertas siguen sujetas a los cierres ordinarios existentes por eventos/timeouts. La ingesta ya consulta inventario central con caché; una pérdida de alcance puede dejar de aportar detecciones y terminar dando lugar al timeout ordinario. Eso preexistía y no cambia en esta entrega. No se garantiza continuidad indefinida de una sesión desasignada. Una futura política específica para asignaciones/sesiones existentes requiere decisión explícita y pruebas separadas; no es necesaria para bloquear **nuevas** asignaciones.

## Caché, concurrencia y límites

- Inventario y POST no reutilizan la caché de eventos; una pantalla cargada previamente no autoriza el POST. No hay cacheado positivo/negativo de disponibilidad en esta implementación.
- La interfaz es una fotografía: no recibe invalidación inmediata de Administración. Refrescar «Gateways y tags»/«Asignaciones» vuelve a consultar central; un botón antiguo puede permanecer visible, pero el POST vuelve a verificar.
- El listado central es una fotografía de consulta, no un bloqueo distribuido. Si Administración cambia pertenencia **después** de la verificación central pero antes de la escritura local, la operación puede completarse con la autorización que acaba de observar. No se promete revocación instantánea ni atomicidad entre bases. Solucionarlo requeriría un contrato central de reserva/versionado/revocación, fuera de alcance.
- Se conserva el comportamiento transaccional previo de la ruta de asignación: sus tres escrituras locales no se convierten aquí en una transacción nueva. Un fallo local después de autorizar puede seguir dejando un cierre anterior sin nueva asignación; es una limitación previa, no se presenta como resuelta. Las garantías de «sin cambios» aquí corresponden a los rechazos de autorización **anteriores a cualquier escritura**.
- La caché de presencia conserva TTL configurable (`HARDWARE_MANAGER_CACHE_TTL_MS`, por defecto 30 s; errores por defecto 5 s). No afirmar que presencia/alarmas se revocan al mismo tiempo que un POST fresco; ni alterar MQTT para conseguirlo.
- El listado central actual no está paginado. Si su contrato cambia a paginación o listas parciales, revisar completitud antes de usar ausencia como evidencia; no asumir que una página es todo el inventario.

## Pruebas y validación

Pruebas ejecutables nuevas: inventario sin pertenencia/transferencia/reasignación; inactivo/status/tipo incompatible/política denegada; errores HTTP/red/timeout; cuerpo malformado/identidad discordante; POST HTTP autenticado desde pantalla antigua; cero escrituras en cada rechazo; recuperación con el mismo enlace; interfaz ejecutada en VM para inventario, selector, mensajes y trabajador existente.

No hay migración ni SQL nuevo de escritura; el único SELECT ampliado usa columnas existentes de `tags`. La verificación de autorización utiliza PostgreSQL simulado y peticiones HTTP loopback; no requiere una base real para acreditar que el guard se ejecuta antes de escribir. No se ha ejecutado PostgreSQL aislado en esta entrega. Las pruebas PostgreSQL previas de la suite siguen opt-in y sus omisiones no equivalen a aprobación.

Estado local de validación: Horneo typecheck/build y sintaxis correctos; suite completa **162 pruebas: 160 aprobadas, 0 fallidas, 2 omitidas**. Backend typecheck/build correctos y suite completa **246 pruebas: 241 aprobadas, 0 fallidas, 5 omitidas** (PostgreSQL opt-in deshabilitado). Una expectativa textual antigua buscaba la proyección central directamente en el router: se adaptó a su helper nuevo; se conserva la prueba de nombres y se añade cobertura ejecutable de identidad. No se cambia código para satisfacer una expectativa obsoleta. La interfaz muestra el rechazo del POST sin anunciar éxito ni borrar la pantalla.

## Validación en staging (para el operador; no ejecutada aquí)

1. En una copia de pruebas de este commit, sin `.env` compartidos, instalar dependencias y compilar Horneo; ejecutar `npm run typecheck` y `npm test`, además de `node --check web/app.js`. Las nuevas regresiones viven en `src/modules/tags/__tests__/tag-availability.test.ts`; simulan tanto Administración como PostgreSQL, sin enviar MQTT o acciones físicas. No arrancar el servidor operativo para ejecutar pruebas.
2. Revisar la respuesta autenticada de `/tags` y la pantalla con un **fixture aislado**, no con el tag real aportado: comprobar que una lista central válida sin su ID lo omite; mismo resultado si se trasladó a otra compañía. Guardar el ID local/enlace e histórico del fixture antes/después.
3. Conservar una pantalla con la opción antigua y repetir el POST contra el API local simulado tras retirar el ID del alcance: 409 y cero escrituras. Simular 401/403/429/5xx/timeout/JSON malformado: referencias conservadas como sin verificar, selector bloqueado y POST 503.
4. Restaurar el dispositivo del fixture a la compañía: reaparece tras refrescar y el POST usa el mismo enlace. Comprobar inactivo y sensor como no elegibles; no convertir tipos para pasar el test.
5. Mantener un trabajador con asignación existente y sesión abierta en el fixture: consultas/rechazos no generan UPDATE/DELETE de estas relaciones. No realizar mutaciones sobre el dispositivo real ni exigir un cierre/desasignación automático.

El traslado de gateways a producción permanece pausado. No hay push, merge, despliegue, acceso a servidores/bases compartidas, correo, MQTT real ni hardware.
