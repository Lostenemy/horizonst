# B5: cierre canónico, outbox y evidencia del plazo total

## Estado: bloqueada, sin máximo operativo aceptado

Rama `codex/gateway-rssi-mqtt-b5-integration`. Se conserva el diagnóstico
`c7c52ce06fdab9d2b530e6cbf480e6f5c26a38d4`. No se acepta ni se fija un máximo
de 16 sesiones. Cuatro workers son un límite de recursos, **no una capacidad
certificada** ni una exclusión de la sesión 17. Se procesa la lista completa.
No se declara resuelto el SLA de 90 s: falta la prueba PostgreSQL real,
medición de capacidad representativa y aceptación explícita del sobre operativo.

## Implementación

- `protect_until` inicial = última detección válida + 60 s, limitado por el
  deadline físico existente. La finalización solo lo reduce, nunca lo extiende.
  El mismo paquete no reclama otra protección; duplicados/atrasados conservan
  `GREATEST(last_presence_at,paquete)`. La lectura y el UPDATE de cierre también
  aplican D+60 a operaciones preexistentes, sin backfill.
- Deadline físico de 120 s desde reclamación, sonido, vibración, followup,
  reintentos y desconexión conservados. Vencer presencia no aborta ese ciclo.
  Una nueva detección después de la salida puede abrir otra sesión; se conservan
  umbral/margen RSSI y el caso `cold_room_id NULL`.
- La aceptación del paquete comparte un lock corto sobre la sesión con el
  cierre. Si desaparece durante la espera, se vuelven a comprobar las reglas
  existentes de entrada. Las fronteras del cierre/gracia son tokens PostgreSQL
  y cálculos SQL, no fechas reconstruidas con precisión de milisegundos.
- Cierre canónico: sesión finalizada, estado fuera/gracia desde D y job único
  por sesión en una transacción. `lock_timeout=500ms`,
  `statement_timeout=1500ms`, plazo absoluto local de cliente/pool/transacción
  2 s. Error implica rollback/destrucción, no cierre parcial ni pérdida de sesión.
- Barridos no solapados, cuatro cierres concurrentes, errores aislados por
  sesión y orden por detección más antigua. No hay LIMIT ni descarte de filas.
- Migración nueva 023 crea `presence_close_outbox` y `physical_alarm_outbox`;
  FK restrictivas, índices de pendientes y exclusión única de despacho vivo por
  dispositivo. No modifica 001–022 ni filas históricas.
- Un consumidor SQL procesa efectos, alertas, incidencias y finalización del
  job en una misma transacción. Fallos se reintentan con backoff durable de 5 s.
  `FOR UPDATE SKIP LOCKED` separa consumidores; reinicio no pierde el trabajo.
  La política de acumuladores y alarmas se conserva, incluido su tratamiento
  anterior de claves con cámara/worker NULL; no es una corrección de informes.
- Las alertas de cierre, alertas automáticas con tag y los avisos de reentrada/
  recordatorio encolan trabajo físico durable. Reentrada y recordatorio lo
  insertan en el mismo SQL que cambia el estado operativo.
- Exclusión antes de enviar: job pendiente con contador/fecha de omisión,
  reintento a los 5 s, misma clave de despacho. Dispatch marcado antes de
  invocar ejecutor: UUID de propietario; resultado antiguo no sobreescribe
  estados. Despacho interrumpido/fallido incierto exige revisión, no reenvío.
  Una observación que no termina en 180 s se registra para revisión: ese límite
  **no cancela ni amplía** el ciclo físico existente. La recuperación de leases
  tiene su propio loop, independiente de workers ocupados.

Un job `review_required` bloquea nuevos despachos de ese dispositivo hasta
revisión. No se infiere si sonó ni se garantiza entrega física exactamente una
vez. Esta es una limitación del contrato sin correlación inequívoca del hardware.
No existe nueva API de resolución manual: requiere procedimiento autorizado y
evidencia de finalización del ciclo; nunca limpiar el estado solo para reintentar.
Los avisos posteriores permanecen durables, no se descartan por ese bloqueo.

## Qué incluye el presupuesto TOTAL

`T(COMMIT observado)-D = espera hasta elegibilidad + demora hasta snapshot
 + snapshot/pool + cola de workers + transacción/pool + reintentos`.

La elegibilidad protegida acaba como máximo en D+60, no C+60. Recuperación
de 10 s ya está incluida en `protect_until`, nunca se suma por fuera de D+60.
La demora hasta snapshot incluye el resto de un barrido anterior, el intervalo
efectivo de 7,5 s y la demora de ejecución del callback. Por tanto, **71,5 s no
es una cota absoluta**: omite cola, barrido anterior y reintentos.

“Demora del proceso”: diferencia no negativa entre la hora prevista del
callback de barrido y su ejecución efectiva (CPU, GC, suspensión/event loop).
No incluye consultas ni espera en pool. `processDelayMs`, `snapshotElapsedMs`,
`queueWaitMs`, `transactionElapsedMs` y `detectionToCommitMs` separan tiempos.
La última métrica se observa después del ACK de COMMIT; no es `ended_at`, que
sigue siendo la frontera lógica. Requiere reloj de aplicación/base coherente.

Una sesión 17 espera su turno como cualquier otra, no cambia de contrato.
Un lock >500 ms o cliente >2 s conserva la sesión abierta y provoca reintento
en otro barrido, sin bloquear otras sesiones. No garantiza COMMIT de una fila
que siga bloqueada. Si se cruza D+90 se registra incumplimiento y continúa
recuperación; no se reinicia el contador ni se inventa una detección.
Durante caída no se puede garantizar tiempo de cierre; al reiniciar se
reanuda desde sesiones abiertas y jobs persistidos, con plazos originales.
Exposición y gracia siguen D; no se incrementan por espera o recuperación.

## Medición local: transporte simulado, no certificación PostgreSQL

Prueba `presence-sweep-load.test.ts`, transporte sin red con COMMIT retrasado
5 ms y recorrido real `persistCanonicalPresenceClose` + scheduler. Una ejecución:

| Sesiones | Tiempo de barrido | Cola máxima | Transacción máxima |
| --- | ---: | ---: | ---: |
| 1 | 21 ms | 1 ms | 20 ms |
| 16 | 57 ms | 44 ms | 17 ms |
| 17 | 67 ms | 53 ms | 20 ms |
| 32 | 116 ms | 101 ms | 18 ms |
| 64 | 261 ms | 240 ms | 25 ms |
| 128 | 488 ms | 472 ms | 24 ms |

Los valores varían entre ejecuciones. Demuestran ausencia de corte en 16 y
concurrencia limitada, no latencias de red/locks/disco de una base real. Otra
prueba mantiene una consulta sin resolver: 17 sesiones independientes cierran,
una se conserva y se recupera al desbloquear. El plazo local fue ~2 s.
No se extrapola de estas medidas un máximo operativo ni una garantía de 90 s.

## Archivos propios de la entrega

```text
cold-compliance-service/src/index.ts
cold-compliance-service/src/modules/alerts/alerts.service.ts
cold-compliance-service/src/modules/compliance/__tests__/controlled-ble-presence.postgres.test.ts
cold-compliance-service/src/modules/compliance/__tests__/controlled-ble-presence.test.ts
cold-compliance-service/src/modules/compliance/__tests__/nullable-cold-room-presence.test.ts
cold-compliance-service/src/modules/compliance/__tests__/physical-alarm-flow.test.ts
cold-compliance-service/src/modules/compliance/__tests__/presence-incident-regression.test.ts
cold-compliance-service/src/modules/compliance/compliance.service.ts
cold-compliance-service/src/modules/compliance/presence-timeout-policy.ts
cold-compliance-service/src/modules/presence/__tests__/grace-last-detection.test.ts
cold-compliance-service/src/modules/presence/presence-state.service.ts
cold-compliance-service/src/modules/tag-control/application/tag-physical-alarm.service.ts
cold-compliance-service/src/modules/tag-control/infrastructure/controlled-presence.repository.ts
docs/b5-presence-total-budget-review.md
infrastructure/production/tests/production-migrations.contract.test.mjs
infrastructure/production/tests/production-migrations.postgres.mjs
cold-compliance-service/migrations/023_presence_close_outbox.sql
cold-compliance-service/src/modules/alerts/physical-alarm-outbox.ts
cold-compliance-service/src/modules/compliance/__tests__/presence-close.repository.test.ts
cold-compliance-service/src/modules/compliance/__tests__/presence-outbox.test.ts
cold-compliance-service/src/modules/compliance/__tests__/presence-sweep-load.test.ts
cold-compliance-service/src/modules/compliance/presence-close-effects.ts
cold-compliance-service/src/modules/compliance/presence-close.repository.ts
cold-compliance-service/src/modules/compliance/presence-sweep.ts
docs/b5-presence-outbox-validation.md
```

## Pruebas reales preparadas y pendientes

`controlled-ble-presence.postgres.test.ts` amplía las regresiones anteriores:
atomicidad ante rechazo del outbox, reinicio/replay SQL sin duplicación,
fronteras ±1 μs, expiración a D+60 con físico aún vivo, locks compartidos,
18 sesiones con un lock >2 s y visibilidad de todos los COMMIT antes de D+90.
El fixture parte de detecciones de 69,5 s de antigüedad (incluye margen de
barrido/snapshot), no afirma haber medido un broker ni 69,5 s de tráfico real.

**No ejecutadas aquí**: Docker local no tiene daemon y no hay binarios de
PostgreSQL. Las cinco ejecuciones aportadas por el operador correspondían al
fixture anterior, no a 023 ni a estos casos. Ejecutar cinco veces el bloque
aislado de `b5-presence-precision-integration.md`, ahora con este commit.
Ese bloque construye solo la etapa build, PostgreSQL 15 propio sin volúmenes
ni puertos publicados, red compartida exclusivamente con el contenedor de
pruebas y limpieza exacta. Falla al primer error; no usar bases compartidas.

Después medir bajo PostgreSQL representativo varias cargas/latencias y guardar
diagnósticos `upperCommitMs`, logs de cola/pool y todos los casos. Solo entonces
proponer un sobre de carga con evidencia para aceptación, no imponerlo.
El harness general usa ledger Horneo actual en lugar del viejo conteo 21;
contratos/artefactos estáticos no demuestran que las migraciones se aplican.

## Validaciones locales de f39906b

- Horneo: typecheck y build aislado correctos; suite completa **196 aprobadas,
  0 fallidas, 3 omitidas** (199 casos). Las omitidas requieren PostgreSQL real.
- Backend: typecheck y build aislado correctos; **290 aprobadas, 0 fallidas,
  6 omitidas** (296 casos).
- MQTT UI: **10 aprobadas, 0 fallidas, 0 omitidas**.
- Contratos de producción: **19 aprobadas, 0 fallidas, 0 omitidas**.
- Artefactos de producción: **52 comprobaciones aprobadas**.
- Sintaxis frontend de Horneo y gateways Backend: correcta.
- La prueba PostgreSQL ampliada y la aplicación real de 023 están **pendientes**;
  no se iniciaron contenedores ni se publicaron puertos. Tampoco se ejecutó el
  harness general PostgreSQL. Ninguna cifra anterior sustituye esas pruebas.

Estas validaciones corresponden a compilación, simulaciones y contratos locales.
No acreditan capacidad bajo PostgreSQL real ni cumplimiento del SLA total.

## Corrección del identificador de cierre TEXT (2026-10-06)

El operador reprodujo `42804` en PostgreSQL 15 desechable: el cierre nuevo
mezclaba `$2::uuid` con `cold_room_sessions.close_event_id`, definido como TEXT
en 001. Se cambia únicamente ese cast a `$2::text`. No se migran columnas ni
eventos, ni se restringen sus identificadores a UUID. Un parámetro nulo conserva
el valor previo; una sesión ya finalizada no admite sobreescritura.

Regresiones preparadas en `controlled-ble-presence.postgres.test.ts`:
timeout con parámetro nulo, salida explícita con ID textual no UUID,
conservación del ID previo tanto en timeout como salida explícita, rechazo
de finalización obsoleta y rollback del ID/sesión/estado ante fallo del outbox.
Las comprobaciones verifican el tipo real TEXT, timestamps exactos y el job
único junto con estado fuera; usan exclusivamente el schema UUID propio.

Revisión estática de las demás consultas nuevas: IDs de sesión/tag/worker/
cámara y propietario son UUID; referencias centrales son INTEGER; claves de
despacho y eventos son TEXT; timestamps son TIMESTAMPTZ y payloads JSONB.
El cast UUID en el recorder físico corresponde a `alerts.id`, no a eventos.
No se encontró otro cast de evento UUID en las consultas revisadas. Esta
revisión no sustituye el parseo y ejecución real de todas las consultas.

Validación de esta corrección: typecheck/build aislado Horneo correctos;
**197 aprobadas, 0 fallidas, 3 omitidas** (200 casos). La regresión local falló
antes de cambiar el cast (2 fallidas / 3 aprobadas) y pasa después. Contratos
**19/19**, artefactos **52/52**, sintaxis frontend y diff correctos.
Backend/MQTT/RSSI y migraciones no cambian; no se repite su compilación.

Docker local sigue sin daemon y no hay PostgreSQL local disponible: las cuatro
regresiones PostgreSQL nuevas y las **cinco ejecuciones reales completas quedan
pendientes**. Repetir el bloque desechable de
`docs/b5-presence-precision-integration.md` con el nuevo commit, conservando sus
protecciones (sin puertos/volúmenes, red sin acceso exterior y limpieza propia).
La reproducción aportada por el operador demuestra el defecto anterior, no
valida este cambio ni el SLA. La rama continúa bloqueada para despliegue y no
se declara validado el límite TOTAL de 90 segundos.

Diff propio de esta corrección: `presence-close.repository.ts`,
`presence-close.repository.test.ts`, `controlled-ble-presence.postgres.test.ts`
y este documento. Sin nueva migración ni cambios de políticas o plazos.

## Operaciones y retorno, sin ejecutar

Consultar por acceso autorizado de solo lectura: `cold_room_sessions`,
`presence_operational_state`, `presence_close_outbox` (pendientes, attempts,
last_error_code, completed_at) y `physical_alarm_outbox` (state, claim_id,
lease_until, exclusion_count, last_excluded_at, result_code). No extraer payloads
ni datos personales para investigar latencia. Revisar errores de cierre y
`within90Seconds=false` / `exceeds90Seconds=true`. No ocultarlos con otro SLA.

Despliegue bloqueado hasta cerrar evidencia y aprobación. Si posteriormente
se autorizase retorno: detener consumidores por cambio de artefacto, conservar
tablas/jobs e históricos y revisar despachos inciertos antes de reanudarlos.
Volver al artefacto anterior pierde esta recuperación y vuelve a la cota
rechazada; no es una solución del objetivo. No revertir 023 ni borrar outboxes
para eludir pendientes. MQTT/RSSI, credenciales, ACL y protocolos no cambian.
