# Cierre y recuperación PostgreSQL — diagnóstico y progreso

Rama: `codex/graceful-shutdown-postgres`, desde `origin/main`
`8b6ca76f4161b462ee70b1e99f0e1999eefb917f`, actualizado mediante fetch el 24/10/2026.
Estado: cierre/recuperación PostgreSQL implementados y probados localmente, también en Docker/Linux.
Entrega GLOBAL todavía bloqueada para despliegue por la recuperación durable SMTP de Tienda:
el usuario autorizó su DISEÑO, no su implementación. Ver `store-notification-journal-design.md`.

## Criterios

- Parada idempotente por SIGTERM/SIGINT, por debajo de 30 s sin ampliar Docker stop timeout.
- Dejar de admitir trabajo, detener consumidores y timers, drenar trabajo aceptado y cerrar recursos.
- PostgreSQL puede caer y volver sin derribar procesos ni reproducir escrituras inciertas.
- Conservar contratos de salud y mecanismos de outbox/leases, sin cambios de negocio/B5/SOS.
- Validar escenarios representativos en contenedores con PostgreSQL/MQTT desechables, red interna,
  sin puertos publicados, volúmenes de servicios reales, credenciales reales ni archivos `.env`.

## Causas observadas en código (no confundir con diagnóstico de los contenedores históricos)

- Los tres pools carecían de listener de `error`. Un error de cliente ocioso emitido por el pool
  sin listener puede derribar el proceso. Se reproduce con EventEmitter y con un control negativo
  usando el pg REAL de cada imagen: al parar PostgreSQL los tres procesos de control salen con
  código 1 y error 57P01. Son controles del patrón anterior, no ejecuciones de las imágenes históricas.
- Horneo `/ready` tenía una promesa Express 4 sin catch: un rechazo de PostgreSQL no se
  transformaba de forma controlada en 503.
- Ningún entrypoint coordinaba señales, HTTP, MQTT, timers y pool. Horneo tiene SSE, loops
  sin stop y trabajos físicos con deadline mayor que el plazo de parada. Backend tiene timers,
  reintentos MQTT y comandos pendientes; Store necesita drenar HTTP y pool.
- Los Dockerfiles versionados utilizan CMD exec con Node directo; Compose no los sustituye por npm.
  La ausencia de un handler NO demuestra por sí sola la causa del 137. Falta reproducir el
  arranque histórico y su cadena PID1/señales; no afirmar una causa común de 137.

El harness actual sí comprueba CMD exec y `/proc/1/cmdline`: Node es PID1 en los tres perfiles.
`npm start` conserva scripts que invocan Node, pero npm añade un proceso y puede interponer shell;
no se ha certificado ese override como PID1. Los Dockerfiles versionados no lo usan. Operaciones
debe verificar el arranque real y no sustituir CMD por npm/shell. Sin metadatos de los contenedores
históricos no puede atribuirse de manera concluyente su 137 a una única causa por servicio.

## Diseño implementado (validación en curso)

- Módulo lifecycle autocontenido por servicio, para no introducir dependencias cruzadas en imágenes
  con contextos Docker separados. Se exige que las tres copias permanezcan idénticas.
- Una sola promesa de cierre y una sola instalación efectiva de la reacción a señales repetidas.
- Presupuesto de cierre 24 s; watchdog absoluto 25 s. Si queda trabajo incierto, salida 1,
  nunca éxito inventado. No se modifica el plazo Docker de 30 s.
- Se cierran nuevas conexiones HTTP; tras 8 s se cortan conexiones persistentes restantes.
  Los SSE ya identificados se terminan antes del drenaje, observando setHeader/writeHead sin
  cambiar headers ni eventos. Una regresión SSE pasa en Windows y dentro del runtime Linux.
  Se drenan trabajos aceptados hasta reservar tiempo para el pool. MQTT deja de reconectar y
  de aceptar mensajes nuevos. Una publicación pendiente puede quedar incierta: no se reenvía.
- Se detienen los loops; los trabajos durables no se marcan completados por el cierre. Si se
  alcanza el presupuesto, permanecen sujetos a sus outboxes, leases y revisión existentes.
- `connectionTimeoutMillis=2000` limita adquisición/handshake en los tres pools. No se añaden
  timeouts globales de consultas ni se reintentan transacciones, COMMITs o efectos externos.
- Errores de clientes ociosos/prestados tienen listener, sin registrar credenciales o SQL.
  pg puede adquirir una nueva conexión después; no se reemplaza/recrea el pool con loops paralelos.
- Probes SELECT 1 acotados a 2 s, con single-flight. Una adquisición tardía se destruye y
  las conexiones prestadas durante una probe fallida se liberan destruidas. No se reutilizan
  clientes rotos ni se repiten escrituras.

## Salud

- Backend `/health`: conserva el contrato MQTT existente; no es prueba de PostgreSQL.
  `/ready`: 200 solo con PostgreSQL disponible y MQTT cuando es obligatorio; 503 en otro caso.
- Horneo `/health`: liveness existente; `/ready`: 200 ready o 503 degraded, sin rechazo no manejado.
- Store `/health` y `/api/health`: mantienen campos y códigos; la consulta a PostgreSQL queda acotada.
- Una vez iniciada la parada, nuevas solicitudes reciben 503 o conexión cerrada.

## Notificaciones de Tienda: límite no resuelto

Se encontraron cuatro envíos post-COMMIT desacoplados en las rutas de propuestas y pedidos.
Ahora se incorporan al drenaje mediante `lifecycle.track`, sin esperar antes de responder HTTP,
sin cambiar contenido/destinatarios y sin añadir reintentos. No existe un registro durable de
esos envíos. Si el presupuesto expira durante SMTP, no puede garantizarse su recuperación.
El fallo no se oculta con salida 0: el cierre informa trabajo inconcluso mediante código 1.
El diseño autorizado propone registro transaccional, leases/UUID, estados inciertos y revisión,
sin reenvío automático. No se ha creado tabla ni migración ni cambiado estados comerciales.

## Evidencia local ejecutada

- Node 22.23.4 Windows: Backend 306 tests, 300 aprobados, 0 fallos, 6 integraciones omitidas.
- Horneo: 211 tests, 207 aprobados, 0 fallos, 4 integraciones omitidas.
- Tienda: 42 módulos de la suite completa sin fallos; no inventar un total de aserciones porque
  su runner no usa TAP. Ocho tests de lifecycle, tres procesos nuevos: 24/24 aprobados.
- Typecheck y build de los tres servicios correctos; build Vite de Tienda correcto.
- Caso temporal MQTT previo: 20 procesos nuevos consecutivos aprobados.
- Contratos del entorno y lifecycle: 6/6, con comparación de las tres copias del módulo común.

Logs finales Windows: `%TEMP%/horizonst-tests-evidence-iR3wcr/summary.json` y
`%TEMP%/horizonst-store-lifecycle-evidence-Mhb9p3/summary.json`.
Se conserva además una copia persistente de 375 archivos de evidencia (22 ejecuciones/grupos),
incluidos intentos fallidos, en `C:/Users/User/Documents/horizonst/shutdown-validation-evidence-3C46AQ/`.
Su `manifest.json` incluye SHA-256 de cada archivo; no contiene workspaces, dependencias ni `.env`.
`docs/shutdown-validation-results.json` incorpora al commit los resúmenes estructurados de la
versión final y sus límites, sin copiar logs SMTP ni datos privados al repositorio.
Los temporales y todos los intentos fallidos se conservaron. El runner de Store compila en
su copia propia para ejecutar ESM sin IPC opcional de TSX; conserva recursos y aserciones.
El guard offline sigue prohibiendo PostgreSQL, SMTP, MQTT y proveedores reales y permite solo
HTTP de servidores creados en el propio proceso; reconoce el puerto desde listen(0).

Docker local pasó a estar disponible: Engine 29.8.2, Node 22.23.4 en los tres runtimes,
PostgreSQL 15.19 y Mosquitto 2.1.2 (IDs exactos de imagen en results.json).
Se ejecutaron tres rondas completas por ejecución, con seis paradas por ronda:
salud tras recuperación y parada con PostgreSQL caído, para los tres servicios.
Las 18 salidas de cada ejecución completa fueron 0, sin OOM ni 137; no se aumentó el plazo Docker.
Los tiempos incluyen llamadas Docker y son cotas observadas, no garantías universales bajo CPU bloqueada.

Evidencia Linux completa ya disponible: `%TEMP%/horizonst-lifecycle-docker-8TlYxY/results.json`
y `%TEMP%/horizonst-lifecycle-docker-RaWdi5/results.json` (18 paradas por ejecución).
El primero registra 22 recursos propios retirados correctamente (21 contenedores y una red).
Evidencia de la versión final (incluido contrato de salud durante parada):
`%TEMP%/horizonst-lifecycle-docker-Xp2aEp/results.json`, validada y con sus 22 recursos propios retirados.

| Servicio | Paradas | Tiempo mínimo observado | Máximo observado | Códigos |
| --- | ---: | ---: | ---: | --- |
| Backend | 6 | 1320 ms | 5398 ms | Todos 0 |
| Horneo | 6 | 1367 ms | 5713 ms | Todos 0 |
| Tienda | 6 | 1290 ms | 3740 ms | Todos 0 |

Cada servicio incluye tres paradas tras recuperación y tres con PostgreSQL caído. Se envía una
segunda señal cuando el proceso todavía existe; puede haber salido antes de esa segunda llamada.
La recepción doble se comprueba además en unit tests. Sin OOM/SIGKILL/137 en las aplicaciones.
Los controles negativos son tres procesos auxiliares deliberadamente sin listener: 1/57P01,
esperados. El escenario SSE Linux pasa. No contar esos controles como fallos de la solución.

Comprobaciones Linux: caen readiness/health Store a 503; regresan a 200 sin reiniciar aplicaciones
(StartedAt intacto); conexiones activas interrumpidas no dejan escrituras de prueba; no se
reproducen transacciones. El escenario SSE Linux pasa. Los controles negativos terminan con
1/57P01 de forma esperada, sin considerarlos un fallo de la solución.

Primeros intentos preservados: error TS2683 ya corregido y pérdida de fixtures por tmpfs.
El harness definitivo usa PGDATA en la capa privada del contenedor, conservada entre stop/start;
enmascara el VOLUME por defecto con tmpfs vacío. No monta ni elimina volúmenes compartidos.
Se eliminan exclusivamente IDs adquiridos por el harness; no se buscan recursos por prefijo.
Las imágenes/caché de prueba se conservan. Los avisos npm de los builds se guardan sin aplicar
audit fix ni actualizar dependencias fuera de alcance.

## Comandos reproducibles

Con Node 22.23.4, desde la raíz; ninguno requiere credenciales ni `.env`:

```sh
node --test infrastructure/testing/isolation.test.cjs infrastructure/testing/lifecycle-contracts.test.cjs
node infrastructure/testing/run-suites.cjs
node infrastructure/testing/store-lifecycle-suites.cjs
node infrastructure/testing/lifecycle-docker.mjs --run-disposable-docker
```

El último comando construye imágenes de pruebas, crea una red interna, PostgreSQL y MQTT propios,
aplica schema/migraciones SOLO a esos fixtures y ejecuta tres rondas. No publica puertos ni monta
datos de servicios. Sus credenciales son aleatorias/ficticias y se redactan en errores y logs.
No acepta URLs de bases existentes. No ejecutar contra Docker de producción ni usar imágenes
de prueba como despliegue. La limpieza de fixtures incluye rm -f por IDs exactos; las aplicaciones
deben haber salido antes con código 0, nunca se acredita el criterio mediante esa limpieza.

## Validación y despliegue por operaciones (no ejecutados)

1. Revisar diff y diseño SMTP. No declarar completado el requisito durable de correo ni autorizar
   despliegue global hasta implementar/validar ese diseño o aceptar explícitamente una entrega parcial.
2. Repetir el harness en CI/Docker de desarrollo y guardar results.json, versiones, IDs, logs,
   tiempos, códigos de salida y evidencia de limpieza. No hace falta acceso al broker o DB de staging.
3. Para la futura ventana staging: conservar imágenes seguras anteriores y confirmar CMD Node
   directo/PID1, Node/CA corregidos, configuración efectiva y plazo de 30 s sin ampliarlo.
   No reconstruir ciegamente las plantillas históricas que todavía usan Node 20: mantener la
   receta de runtime segura aprobada por operaciones. Esta tarea no modifica esos Dockerfiles.
4. Asegurar que no hay ciclos físicos en vuelo antes de una parada planificada. No enviar comandos
   para comprobarlo; consultar únicamente los mecanismos de revisión/outbox ya autorizados.
5. Desplegar primero staging, un servicio cada vez, con autorización separada. Verificar salud,
   salida y recuperación reales; no probar reinicios sobre bases compartidas sin ventana aprobada.
6. No borrar pendientes, leases, timeouts ni avisos para obtener un estado verde. Ante dispatch
   físico incierto usar `review_required` y el procedimiento existente, no retransmitir.

Retorno: restaurar la imagen anterior segura del servicio afectado, sin tocar datos, tablas,
outboxes ni configuraciones de hardware. No hay migraciones de aplicación en este cambio.
El retorno también restaura las limitaciones antiguas de cierre/errores de pool: requiere revisión.
No retornar a runtimes Node vulnerables ni ejecutar rollback de SQL para esta entrega.

## Límites pendientes

- No se reprodujeron las imágenes históricas exactas ni su 137. Se acreditó el mecanismo de
  error ocioso y el comportamiento corregido, no una explicación exclusiva del incidente histórico.
- SMTP durable: diseñado con autorización, todavía no implementado. No se enviaron correos reales.
- Los perfiles Linux tienen inventario vacío y no activan alarmas físicas. No prueban ejecución
  de B5 ni todo el negocio autenticado. Las suites simuladas conservan los contratos existentes.
- El control transaccional interrumpe antes de COMMIT. No acredita todos los resultados posibles
  de un COMMIT confirmado en servidor cuya respuesta se pierde. No se introdujo replay de SQL.
- Se conservan QoS y garantías de entrega MQTT. Si se agota el drenaje no se inventa éxito ni
  se promete reproducir un mensaje sin mecanismo durable existente; no se añade almacenamiento
  crudo de SOS/presencia ni se cambian sus políticas de privacidad.
- Si el ciclo físico sobrepasa el drenaje, la parada puede salir con 1 y conservar un resultado
  incierto para revisión. No se recortan duraciones, follow-up ni reintentos de hardware.
- Watchdog 25 s requiere un event loop que pueda ejecutar JS; no prometer tiempo absoluto con
  bloqueo CPU ilimitado o daemon averiado. Las mediciones concretas quedan registradas.
- No hubo push, merge, despliegue, acceso a servidores, credenciales reales, `.env`, bases
  compartidas, correo real ni comandos MQTT hacia equipos reales.

## Estado contra aceptación

| Criterio | Estado y evidencia |
| --- | --- |
| SIGTERM antes de 30 s | Acreditado en los perfiles Linux medidos: 18/18, códigos 0, máximo 5713 ms |
| Segunda señal idempotente | Unit tests, instalación única y señales repetidas; contenedor acepta la segunda mientras sigue vivo |
| PostgreSQL caído y recuperación sin reinicio | Acreditado en tres rondas por servicio; readiness recuperada, StartedAt intacto |
| Errores de pool no manejados | Control negativo 1/57P01 por cada dependencia; solución sobrevive el mismo reinicio |
| SSE y timers | SSE Linux correcto, stops registrados y loops drenados; suites completas y tests de exclusión/idempotencia |
| Sin replay de escrituras | No se introdujo replay; transacción interrumpida deja cero filas. ACK perdido de COMMIT no agotado exhaustivamente |
| Avisos SMTP recuperables tras plazo agotado | PENDIENTE: diseño autorizado, sin implementación durable |
| Reglas B5/SOS/presencia | SQL/umbrales/payloads y duraciones intactos; suites simuladas correctas, sin hardware |
| Entrega global desplegable | NO: queda el registro durable SMTP y su decisión de snapshot/privacidad |
