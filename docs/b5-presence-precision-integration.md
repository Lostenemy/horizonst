# Conciliación B5 / RSSI / MQTT y precisión de cierres

## Integración actual y corrección del fixture de expiración

Rama local `codex/gateway-rssi-mqtt-b5-integration`, creada desde
`2ef5ba46a66db40011ad43d5e20c0fc1854308a8` (últimos cambios MQTT), integrando
`7d90a05b107298e359d75ad30eef85878f3d9d7a` (entrega B5). Backend y MQTT UI
permanecen idénticos al primer padre; el runtime Horneo y la migración 022
permanecen idénticos a la entrega B5. La observación MQTT sigue deshabilitada
por defecto. Las secciones posteriores documentan la integración anterior.

El subcaso `concurrent claim takes the session lock...` construía las tres
fronteras de expiración con llamadas independientes a `clock_timestamp()`.
La segunda llamada podía hacer que `hard_deadline - started_at` superase
120 segundos por microsegundos, infringiendo correctamente la constraint 022.
El fixture ahora captura un único instante PostgreSQL en una CTE
`MATERIALIZED` y deriva `started_at` (-121 segundos), `hard_deadline` y
`protect_until` (-1 segundo). Se conservan precisión, constraints y todas las
aserciones; no se cambia el comportamiento operativo.

Validación local de esta integración:

- Backend: typecheck y compilación correctos; 290 pruebas aprobadas, 0 fallidas,
  6 omitidas.
- Horneo: typecheck y compilación correctos; 178 pruebas aprobadas, 0 fallidas,
  3 omitidas, incluida la prueba PostgreSQL opt-in.
- MQTT UI: 10 aprobadas, 0 fallidas, 0 omitidas.
- Contratos de producción: 18 aprobados; artefactos: 52 comprobaciones aprobadas.
- Sintaxis frontend Backend/Horneo y `git diff --check`: correctos.
- PostgreSQL 15 real: pendiente; Docker local no dispone de daemon. No se ha
  iniciado ningún contenedor ni ejecutado ninguna migración en esta entrega.

Antes de considerar validada la corrección, ejecutar cinco veces la prueba
compilada `modules/compliance/__tests__/controlled-ble-presence.postgres.test.js`
con `node --test`, usando exclusivamente el PostgreSQL 15 desechable descrito
abajo y `CONTROLLED_B5_ALLOW_DATABASE_TESTS=true`,
`CONTROLLED_B5_TEST_DATABASE_URL` apuntando a su base `horizonst_test_*` en
loopback, `PRESENCE_EXIT_TIMEOUT_MS=30000` y `PRESENCE_SWEEP_INTERVAL_MS=10000`.
Detenerse ante cualquier fallo y conservar su salida técnica redactada.
Las pruebas con mocks y la comprobación estática no sustituyen esta repetición.
No se ha hecho push, despliegue ni contacto con hardware o MQTT real.

## Estado: validación PostgreSQL real pendiente, no listo para desplegar

Rama `codex/b5-presence-precision-integration`. Primer padre de integración:
`64e1e63f95ceaf5b3734c4e4083e29c6796b1d2a` (RSSI + observación MQTT).
Segundo padre: `e281349b686755ff096a9b656c9cfde9f51ba989` (protección B5).
Se integra B5 ahora por petición expresa; no se altera la rama anterior que
lo excluía. `GATEWAY_MQTT_OBSERVATION_ENABLED` sigue desactivada por defecto.
No se han cambiado RSSI, duraciones de alarmas ni los timeouts 30000/10000 ms.
La migración 022 se incorpora sin editar y no se aplica localmente.

## Causa y corrección acotada

El operador reprodujo en PostgreSQL 15 que `.123456` se entrega mediante pg
como `Date` `.123`. La comprobación SQL `ps.last_presence_at > $4` veía la
misma detección como posterior a la frontera truncada. Es coherente con el
recorrido confirmado `closeStaleSessions` → `finalizeSession`; aquí no se
ha podido reproducir contra un servidor real.

- El SELECT devuelve `last_seen_at` y las fechas de protección como texto de
  PostgreSQL, conservando microsegundos. `$4` recibe ese token intacto.
- `timeout_ended_at` se calcula y devuelve en SQL: máximo entre última
  detección + timeout y protección limitada a la hora del barrido. La hora de
  confirmación tampoco se reconstruye mediante `Date`.
- Se mantiene el rechazo de detecciones realmente posteriores en cualquier
  gateway pertinente, incluso dentro del mismo milisegundo; no se elimina ni
  redondea esa comparación. SQL revalida también la expiración exacta del
  timeout: el reloj Node solo preselecciona candidatos, no autoriza el cierre.
- Se mantienen el bloqueo de fila de sesión compartido con la reclamación de
  la operación, la protección vigente comprobada con `clock_timestamp()` y
  `ended_at IS NULL` para impedir un segundo cierre.
- La comparación de paquete de reentrada contra el último `ended_at` pasa a
  SQL. Evita rechazar un evento posterior en el mismo milisegundo y conserva
  el rechazo de paquetes anteriores o iguales. No se cambia el RSSI de entrada.
- Inicio/fin/leases/reclamaciones BLE se comparan entre timestamps SQL y
  operation_id, no contra fechas retornadas a Node. El plazo de ejecución Node
  derivado de `hard_deadline` sigue siendo un límite conservador a milisegundos;
  no concede más protección. No se cambia el parser global de pg.
- Duración persistida se calcula en SQL con el token exacto. El panel,
  segmentación diaria y gracia mantienen su resolución de presentación
  existente (milisegundos/segundos), pero no se utilizan como fronteras del
  cierre ni de la reclamación. No hay backfill ni redondeo de datos históricos.

No se atribuye el silencio de anuncios al firmware como hecho demostrado.
La protección sigue limitada a 120 s + como máximo el siguiente barrido,
según `b5-controlled-presence.md`; no fabrica detecciones ni cambia su fecha.

## Pruebas añadidas y resultados locales

La prueba PostgreSQL existente conserva todos sus casos originales y añade:

1. Detección `.123456` idéntica: cierre tras expiración y `ended_at` exacto.
2. Detección +1 microsegundo después del snapshot: rechaza ese cierre; un
   barrido nuevo puede cerrar si su propia detección ya expiró.
3. Detección concurrente fresca: conserva sesión.
4. Reclamación concurrente real: protege sesión; tras expiración, permite
   cerrar; completion de otro operation_id no cambia el propietario.
5. Reentrada ±1 microsegundo alrededor de la confirmación: rechaza la anterior
   y acepta la posterior. Se ejecuta código runtime contra fixtures propios.

Estos casos **están escritos y compilados, pero no ejecutados en PostgreSQL**.
No se cuentan como aprobados. La suite simulada añade un caso que verifica
transporte intacto de ambos tokens y conservación de los predicados SQL.

- Horneo: typecheck/build, **178 aprobadas, 0 fallidas, 3 omitidas** (181 total).
  Una omitida es el caso PostgreSQL B5, las otras dos son los PostgreSQL opt-in
  preexistentes. Sus subcasos reales no se ejecutaron.
- Backend: typecheck/build, **268 aprobadas, 0 fallidas, 5 omitidas** (273 total).
- MQTT UI: **10 aprobadas, 0 fallidas, 0 omitidas**.
- Contratos producción: **18 aprobadas, 0 fallidas, 0 omitidas**.
- Artefactos: **52 comprobaciones aprobadas**. Sintaxis Administración,
  Horneo y MQTT UI API, diff y control de secretos correctos.

Docker local no tiene daemon (`docker_engine` ausente). No se encontraron
`psql`, `initdb` ni `pg_ctl` locales. No se intentó conectar a puertos de bases
existentes ni usar servidores remotos. No hubo prueba real, migraciones
compartidas, MQTT, hardware, correo o despliegue.

## Reejecución real aislada (operador, no ejecutada)

En un checkout desechable de este commit, con Docker de pruebas autorizado:
construir únicamente la etapa `build` de Horneo. No utilizar Compose de
producción, volúmenes existentes ni publicar puertos. Ejemplo para Linux:

```sh
set -eu
test_name="horizonst-b5-test-$(node -e 'console.log(require("node:crypto").randomUUID())')"
test_password="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
test_image="horizonst-b5-precision-tests:$(git rev-parse --short HEAD)"
docker build --target build -f cold-compliance-service/Dockerfile -t "$test_image" cold-compliance-service
test_owned=false
cleanup() {
  if [ "$test_owned" = true ]; then docker rm -f "$test_name" >/dev/null; fi
  unset test_password
}
trap cleanup EXIT
docker run -d --rm --name "$test_name" --network none \
  -e POSTGRES_USER=fixture -e POSTGRES_DB=horizonst_test_b5_precision \
  -e POSTGRES_PASSWORD="$test_password" postgres:15-alpine >/dev/null
test_owned=true
test_ready=false
for test_attempt in $(seq 1 60); do
  if docker logs "$test_name" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.'; then
    if docker exec "$test_name" psql -X -v ON_ERROR_STOP=1 -U fixture -d horizonst_test_b5_precision -Atc 'SELECT 1' >/dev/null 2>&1; then
      sleep 1
      if docker exec "$test_name" psql -X -v ON_ERROR_STOP=1 -U fixture -d horizonst_test_b5_precision -Atc 'SELECT 1' >/dev/null 2>&1; then
        test_ready=true; break
      fi
    fi
  fi
  sleep 1
done
[ "$test_ready" = true ] || { echo 'PostgreSQL 15 temporal no alcanzó estabilidad'; exit 1; }
for test_repeat in 1 2 3 4 5; do
docker run --rm --network "container:$test_name" --workdir /app \
  -e NODE_ENV=test -e PRESENCE_EXIT_TIMEOUT_MS=30000 -e PRESENCE_SWEEP_INTERVAL_MS=10000 \
  -e CONTROLLED_B5_ALLOW_DATABASE_TESTS=true \
  -e CONTROLLED_B5_TEST_DATABASE_URL="postgresql://fixture:$test_password@127.0.0.1:5432/horizonst_test_b5_precision" \
  "$test_image" node --test dist/modules/compliance/__tests__/controlled-ble-presence.postgres.test.js
done
```

El segundo contenedor comparte solamente el namespace de red del PostgreSQL
propio, sin conectividad exterior; la conexión loopback satisface el guard de
la prueba. No se inicia la aplicación ni su consumidor MQTT. No mostrar
variables, activar `set -x` ni adjuntar inspecciones de contenedores con su
contraseña efímera. Verificar código de salida y todos los subcasos, no solo
que exista `ended_at`. La limpieza elimina exclusivamente el contenedor creado
por este bloque; el schema UUID de la prueba también es exclusivamente propio.

La prueba ampliada ya habría fallado con el código anterior en la aserción
original de cierre. **Hasta tener ejecución real satisfactoria no declarar
corregido el defecto ni lista la conciliación para despliegue.**

Además, el harness general de producción conserva expectativas de 21
migraciones Horneo: no usar sus contratos estáticos como prueba de paridad con
022. Esa adaptación y la migración MQTT 014 real siguen pendientes; aquí no se
modifica el harness ni se ejecuta. La observación 2030 continúa apagada.

## Retorno y alcance del diff propio

La corrección sobre e281349 modifica únicamente `compliance.service.ts`, los
tests `controlled-ble-presence.test.ts`, `controlled-ble-presence.postgres.test.ts`,
`grace-last-detection.test.ts` y este documento. Los demás cambios de B5 se
incorporan de su padre, sin alterar migraciones publicadas. RSSI/MQTT no se
reescriben. Archivos no versionados preexistentes y ambos `dist` intactos.

Retorno exclusivamente autorizado por el operador: restaurar artefacto
validado anterior de Horneo sin modificar registros ni borrar históricos;
advertir que regresan los riesgos de e281349 o los del artefacto elegido.
Mantener el flag 2030 apagado y sus filtros de privacidad si pudiera haber
respuestas tardías. No enviar comandos físicos para validar el retorno.
