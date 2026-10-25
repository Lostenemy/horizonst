# Revisión: error secundario de ROLLBACK

Rama `codex/graceful-shutdown-postgres`, continuación exacta de
`88f191a9212f679586933628c901c463d2a6468d` y su antecedente `b12a5f3`.
No sustituye las evidencias anteriores. No autoriza despliegue.

## Causa y alcance comprobados

Los routers de decisión de presupuestos de cliente y de administración ejecutaban
`await client.query('ROLLBACK')` antes de `next(error)`. Si fallaba la limpieza, Express 4
no recibía el error original y el handler asíncrono rechazaba fuera de su manejador HTTP.
Node 22.23.4 terminaba con código 1. El finally liberaba la conexión, pero sin descartarla.

Reproducción propia antes del cambio: ambos routers reales, cliente pg simulado, procesos
Windows nuevos con Node 22.23.4; ambos salida 1. La reproducción Docker/Linux previa fue
aportada por operaciones; no se confunde con PostgreSQL real ni se atribuye a esta ejecución.

Se revisaron los archivos runtime modificados por b12a5f3 y 88f191a, no todo el sistema:

- Decisión de cliente y cambio de estado administrativo: error secundario no capturado.
- Cancelación/revisión SMTP: devolvían 503, pero el rollback secundario sustituía al original.
  `journalConnection` ya destruía el préstamo al rechazar y conserva esa responsabilidad.
- Runner específico 017: conservaba el error, pero no descartaba expresamente la conexión
  tras rollback fallido ni distinguía COMMIT incierto.
- No se amplía a otros routers ni runners ajenos; no se modifican migraciones ni negocio.

## Corrección

`transaction-cleanup.ts` es una ayuda local de limpieza, no un ejecutor con reintentos:

1. El error original sigue en poder del caller; `failed(error)` maneja el rechazo secundario.
2. A lo sumo un intento de ROLLBACK, también en salidas tempranas 404/409.
3. Si COMMIT se intentó, no se envía ROLLBACK para fingir que su resultado queda resuelto.
   Se descarta la conexión, se propaga el original y no se manda correo ni se repite SQL.
4. Conexión fatal (57P01/02/03, clase 08, errores de transporte o severidad FATAL/PANIC),
   rollback fallido o COMMIT incierto: `release(true)` una vez en el finally del propietario.
5. Error SQL ordinario y rollback confirmado: se devuelve la conexión reutilizable una vez.
6. Revisión/cancelación siguen delegando la liberación única al wrapper acotado del diario;
   la ayuda no libera por su cuenta. No hay doble release.

Intención, historial y transición siguen en una transacción. SMTP solo empieza después
de que COMMIT termine satisfactoriamente. Un COMMIT perdido puede haber sido confirmado
en servidor: se conserva la incertidumbre; no se asegura rollback ni se reenvía automáticamente.

## Pruebas y comandos

Node 22.23.4 desde raíz, sin `.env` ni credenciales heredadas:

```sh
node infrastructure/testing/store-lifecycle-suites.cjs
node --test infrastructure/testing/isolation.test.cjs infrastructure/testing/lifecycle-contracts.test.cjs
node --check horizonst-store/integration/quote-rollback.fixture.mjs
node --check infrastructure/testing/smtp-journal.fixture.mjs
node infrastructure/testing/smtp-journal-docker.mjs --run-disposable-docker
git diff --check
```

El último comando solo se ejecuta en Docker Linux de desarrollo: crea PostgreSQL 15 y SMTP
ficticio propios en red interna, sin puertos ni datos compartidos. Conserva las comprobaciones
SMTP anteriores y repite parada/recuperación tres veces con DB disponible y tres caída.
No acepta una URL de base existente. Limpieza por IDs adquiridos exclusivamente.

La regresión compartida `integration/quote-rollback.fixture.mjs` se ejecuta en Windows y en
el runtime Linux. Son **mocks pg**, no PostgreSQL real: 5 escenarios por cada router.
Comprueba identidad del error en middleware, HTTP 500 controlado, proceso vivo, una liberación,
descarte/reutilización, rollback único, COMMIT incierto sin rollback ni SMTP.
El test normal añade revisión, cancelación y runner de migración con fallo secundario.

La prueba PostgreSQL real, dentro del runtime Linux, realiza por cada router:

- Mutación real dentro de BEGIN, todavía sin confirmar.
- Consulta activa `pg_sleep(10)`; otra conexión ejecuta `pg_terminate_backend` sobre ese PID.
- Error real 57P01 y rollback que no puede ejecutarse sobre el cliente roto.
- Middleware recibe el mismo error, responde 500 y el cliente se descarta exactamente una vez.
- Estado comercial anterior conservado, sin pedido/historial/intención parcial ni correo.
- El mismo servidor HTTP sigue atendiendo; una petición NUEVA explícita obtiene otra conexión
  y completa la operación correctamente. No es reintento automático.

Se usan routers reales y pool pg real, con identidad ficticia inyectada y middleware de error
de prueba para observar la identidad del error. No se afirma que ese corte haya recorrido
el login real o todos los middlewares de producción. Las paradas posteriores sí ejecutan
el entrypoint real de Store con Node PID1, autenticación de pruebas y correo bloqueado.

## Registro recuperable de esta ejecución

- Estado inicial limpio en 88f191a; siete entradas no versionadas preexistentes preservadas.
- Baseline: `horizonst-store-lifecycle-evidence-zC0TtK`, suite y proceso admin salida 1.
- Fallo intermedio del fixture: `horizonst-store-lifecycle-evidence-nNFe9S`; `/alive` estaba
  detrás de `/:id`. Corregido el orden del fixture, sin debilitar la aserción HTTP 200.
- Suite corregida: `horizonst-store-lifecycle-evidence-qyEmxT`; 45 módulos, 24 lifecycle,
  typecheck y ambos builds correctos. Sin omisiones.
- Intento Docker `horizonst-smtp-journal-Ik3uaH`: bloqueo transitorio de metadatos del contexto
  Windows antes de build; sin contenedores creados. Log conservado; no se cambió Docker.
- Docker repetido `horizonst-smtp-journal-bdYkip`, terminado correctamente:
  Node 22.23.4, Docker 29.8.2 Linux, PostgreSQL 15.19.
  57 grupos aprobados en tres rondas: 51 grupos anteriores SMTP/DB, 3 grupos de mocks
  (10 casos por ronda = 30 casos simulados Linux) y 3 grupos con corte real PostgreSQL
  (2 routers por ronda = 6 transacciones interrumpidas). No mezclar estas unidades de conteo.
  Cero fallos u omisiones en la ejecución final.
- Seis paradas principales con código 0, sin OOM/137, más seis recuperaciones sin reenvío.
  Tiempos por ronda, DB disponible: 14,831 / 14,757 / 14,531 s;
  DB caída: 18,943 / 18,967 / 19,246 s. Máximo 19,246 s, inferior a 30 s sin ampliar plazos.
  Los 25 recursos propios se eliminaron; no se publicaron puertos ni usaron volúmenes compartidos.
- Contratos 7/7 y sintaxis correctos. Backend/Horneo no modificados ni reejecutados.
- Archivo nuevo (sin sustituir los anteriores):
  `C:/Users/User/Documents/horizonst/rollback-validation-evidence-d2b2207073c04705a45401f59ce09ed5`.
  52 logs/JSON, incluidos fallos; `SHA256SUMS.csv` SHA-256
  `9866d477ce20c8261f1586e1b022cdb87268c8e80e9904d82ab14c03ce9799f1`.
  Lista exacta de archivos, resultados y omisiones en `store-transaction-rollback-results.json`.

| Criterio | Evidencia y estado |
| --- | --- |
| Error original y HTTP controlado, release único/descarte | Acreditado: mocks Windows/Linux y 6 cortes reales PG; middleware compara identidad del error |
| Rollback correcto y reutilización | Acreditado: caso SQL ordinario simulado; fatal siempre descartado |
| COMMIT incierto sin fingir rollback ni reintento | Acreditado por prueba simulada en ambos routers; pérdida real de ACK de COMMIT no inyectada |
| Servicio vivo y peticiones nuevas tras perder conexión | Acreditado en servidor HTTP con routers reales y PostgreSQL real dentro de Linux |
| Intención transaccional y cero SMTP ante operación fallida | Acreditado: datos y contador del servidor ficticio; regresiones anteriores mantenidas |
| Parada y recuperación SMTP/DB | Acreditado para los perfiles medidos: 6/6 paradas, 6/6 recuperaciones, sin 137 |
| Revisión, cancelación y runner equivalentes | Regresiones simuladas y recorridos satisfactorios PG del harness conservados |
| Staging, proveedor real, Brotli final | Pendiente de operaciones; no es una entrega autorizada para desplegar |

## Pendientes y límites

No se modifica el contrato de salud. Un 200 no se usa como prueba suficiente del recorrido:
se comprueban también datos, contador SMTP, identidad del error y comportamiento posterior.
No se repiten Backend/Horneo: sus fuentes y dependencias permanecen intactas; se conservan
sus evidencias previas, sin presentarlas como nuevas ejecuciones.
No se prueban todas las posibles pérdidas del ACK de COMMIT en red: el caso simulado
garantiza que el código no presume rollback ni inicia SMTP; no promete exactamente una vez.

Staging y protección Brotli nativa sobre la imagen final siguen pendientes de operaciones.
Primero revisar commit y repetir el harness en desarrollo/CI; después cualquier validación
en staging exige autorización y ventana propias. No se requieren migraciones nuevas para
esta corrección. Retorno: no borrar 017 ni el diario; evitar volver a 88f191a bajo pérdida
de conexión, porque recupera el defecto conocido. Mantener una imagen segura corregida
como candidato. No revertir Node a una versión vulnerable ni relanzar notificaciones.

No hubo push, merge, despliegue, servidor/base compartidos, SMTP/MQTT real, hardware,
consulta de `physical_alarm_outbox`, cambios B5/presencia ni lectura de secretos reales.
