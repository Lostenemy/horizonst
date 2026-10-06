# Barrido B5: medición PostgreSQL 15 con scheduler real

## Estado y alcance

Prueba opt-in `presence-scheduler.postgres.test.ts`, añadida sobre `ed1b7a4`.
**Medición real pendiente**: Docker local no tiene daemon ni hay PostgreSQL
local. No se declara validado el SLA de 90 s. La ejecución de 18 sesiones a
~71,7 s aportada por el operador sigue siendo una muestra anterior, no cinco
ejecuciones del recorrido nuevo.

No cambia código operativo, migraciones, MQTT/RSSI ni configuración física.
Se conserva sin modificaciones la prueba existente de 18 sesiones. El contrato
local impide invocar barridos manualmente, usar reloj virtual o envejecer D
en la prueba nueva; ese contrato no sustituye una ejecución PostgreSQL.

## Condiciones que se medirán

- Dos escenarios secuenciales: 6 y 12 dispositivos/sesiones, 6 trabajadores
  ficticios (dos dispositivos por trabajador en la carga doble), cámara NULL.
- D se obtiene de `clock_timestamp()` al preparar detecciones nuevas y se
  conserva intacto. No se restan segundos ni se simulan anuncios MQTT.
  Se prueba el estado aceptado en PostgreSQL, no el transporte o firmware.
- Reclamación mediante `beginControlledPresenceOperation` real, solo SQL;
  `protect_until=D+60 s`, deadline físico existente sin ejecutar acciones.
- Timeout 30 s, configuración de barrido 10 s, intervalo efectivo 7,5 s.
  `startPresenceTimeoutLoop` real y timers nativos, sin primer/segundo barrido
  manual. La instrumentación captura y limpia el timer, no modifica su ritmo.
- Cuatro cierres concurrentes, pool del recorrido limitado a tres conexiones
  para medir contención real. Observador y conexión de bloqueo tienen pools
  separados de una conexión. Esto describe el ensayo, no un cambio de producción.
- En el primer snapshot elegible, otra conexión toma el lock de una sesión
  durante al menos 2,1 s. Se exige error PostgreSQL `55P03`, conservación de
  sesión dentro/sin outbox y recuperación mediante un tick posterior real.
- Consulta independiente cada 100 ms: sesión cerrada, estado fuera y un job
  deben ser visibles juntos. No se confunde `ended_at` con el instante de COMMIT.
- Al detener el scheduler, los jobs siguen pendientes. Un consumidor SQL
  procesa cada uno una vez; repetirlo no modifica completion ni attempts.
  No se arrancan consumidor MQTT, worker físico, correo ni la aplicación HTTP.

## Lectura de las medidas

Cada escenario emite un diagnóstico JSON, incluyendo versión PostgreSQL/Node,
callbacks/demora del event loop, snapshots, pool, intentos por sesión y sweep,
cola del cierre, lock/UPDATE de sesión/estado/outbox/COMMIT y transacción.

`commitAckUpperTotalMs` parte del instante monotónico **anterior** a consultar D;
incluye ese pequeño margen de ida/vuelta y termina al recibir el ACK de COMMIT.
Es una cota cliente, no un timestamp interno de PostgreSQL. `maxVisibleMs` se
calcula en PostgreSQL desde D hasta la primera consulta que ve el cierre y el
estado fuera; es una cota superior del COMMIT durable y añade el sondeo/red.
La frecuencia de sondeo es 100 ms, no una resolución garantizada si la consulta
se retrasa. Las fases están anidadas: no sumar de nuevo pool/cola/transacción
al total observado. El deadline de observación es 95 s; superar 90 s falla la
aserción, no cambia el objetivo. También se emiten medidas parciales ante fallo.

No hay resultado numérico nuevo hasta ejecutar la prueba. Diez escenarios
exitosos (6/12, cinco repeticiones) demostrarán exclusivamente las condiciones
medidas: no prueban disponibilidad continua, otras cargas, disco/CPU/red,
suspensión prolongada del proceso, ni comportamiento físico de B5. Guardar los
diagnósticos y especificaciones de la máquina; no extrapolar garantía universal.

## Comando exacto: PostgreSQL desechable, cinco ejecuciones

Ejecutar desde la raíz de un checkout que contenga este commit, en Linux con
Docker de pruebas autorizado. Construir desde el archivo Git evita incluir
archivos locales no versionados o secretos recuperados en el contexto Docker.
Sin Compose, puertos publicados ni montajes de datos existentes. PostgreSQL
usa tmpfs propio; las conexiones son loopback dentro de su namespace sin red
exterior. El bloque conserva el caso de 18, ejecutándolo antes del nuevo test,
sin competencia entre archivos. Duración orientativa: 12–15 minutos, no límite
de SLA. No activar `set -x`, mostrar variables ni inspeccionar su entorno.

```sh
set -eu
pg_id=''
runner_id=''
pg_name="horizonst-b5-scheduler-$(node -e 'console.log(require("node:crypto").randomUUID())')"
pg_password="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
test_image="horizonst-b5-scheduler-tests:$(git rev-parse --short HEAD)"
cleanup() {
  if [ -n "$runner_id" ]; then docker rm -f "$runner_id" >/dev/null; fi
  if [ -n "$pg_id" ]; then docker rm -f "$pg_id" >/dev/null; fi
  unset pg_password
}
trap cleanup EXIT
if git cat-file -e HEAD:cold-compliance-service/.env 2>/dev/null; then
  echo 'Rechazado: archivo de entorno versionado en el contexto'; exit 1
fi
git archive HEAD:cold-compliance-service | docker build --target build -f Dockerfile -t "$test_image" -
pg_id="$(docker run -d --rm --name "$pg_name" --network none \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,size=512m \
  -e POSTGRES_USER=fixture -e POSTGRES_DB=horizonst_test_b5_scheduler \
  -e POSTGRES_PASSWORD="$pg_password" postgres:15-alpine)"
ready=false
for attempt in $(seq 1 60); do
  if docker logs "$pg_id" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.'; then
    if docker exec "$pg_id" psql -X -v ON_ERROR_STOP=1 -U fixture -d horizonst_test_b5_scheduler -Atc 'SELECT 1' >/dev/null 2>&1; then
      sleep 1
      if docker exec "$pg_id" psql -X -v ON_ERROR_STOP=1 -U fixture -d horizonst_test_b5_scheduler -Atc 'SELECT 1' >/dev/null 2>&1; then
        ready=true; break
      fi
    fi
  fi
  sleep 1
done
[ "$ready" = true ] || { echo 'PostgreSQL temporal no alcanzó estabilidad'; exit 1; }
for repeat in 1 2 3 4 5; do
  echo "Repetición $repeat/5"
  runner_id="$(docker create --network "container:$pg_name" --workdir /app \
    -e NODE_ENV=test -e PRESENCE_EXIT_TIMEOUT_MS=30000 -e PRESENCE_SWEEP_INTERVAL_MS=10000 \
    -e CONTROLLED_B5_ALLOW_DATABASE_TESTS=true -e CONTROLLED_B5_SCHEDULER_REAL_TIME_TESTS=true \
    -e CONTROLLED_B5_TEST_DATABASE_URL="postgresql://fixture:$pg_password@127.0.0.1:5432/horizonst_test_b5_scheduler" \
    "$test_image" node --test --test-concurrency=1 \
    dist/modules/compliance/__tests__/controlled-ble-presence.postgres.test.js \
    dist/modules/compliance/__tests__/presence-scheduler.postgres.test.js)"
  docker start -a "$runner_id"
  result="$(docker wait "$runner_id")"
  docker rm "$runner_id" >/dev/null
  runner_id=''
  [ "$result" = 0 ] || { echo 'Falló la prueba aislada; no continuar ni declarar SLA validado'; exit 1; }
done
```

Los IDs se adquieren solo si la creación termina correctamente; la limpieza
afecta exclusivamente a esos IDs, sin búsquedas por prefijo. Si no se completan
las cinco repeticiones, declarar cuántas finalizaron y el primer caso fallido.
El código aplica/drop únicamente schemas UUID propios en esa base desechable.

## Validaciones locales

Typecheck/build Horneo correctos; suite **199 aprobadas, 0 fallidas,
4 omitidas** (203 casos). Las omitidas incluyen la nueva medición opt-in;
no se ha esperado D+60 ni medido latencia PostgreSQL en este equipo.
Contratos de producción **19/19**, artefactos **52/52** y sintaxis frontend
correctos. Sin cambios en el fixture de 18 ni en runtime/migraciones.
Pendientes las cinco ejecuciones reales; la rama no queda autorizada para
despliegue por la existencia de esta prueba o sus contratos estáticos.
