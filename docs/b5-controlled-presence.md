# B5: presencia durante una alarma física controlada

## Diagnóstico y evidencia

Base verificada: `origin/main` = `0dd1da6b438115fa49008f78453108625fdb76aa`. Rama local: `codex/b5-presence-controlled-operation`. Trabajo independiente de RSSI de formularios y lectura MQTT 2030; ninguno de esos cambios se incorpora.

Hechos del código:

- `compliance.service.ts` cierra por `MAX(last_presence_at)` de gateways pertinentes, también con `cold_room_id NULL`. El timeout no considera la secuencia física. El reloj de exposición y el inicio de gracia siguen la última detección válida.
- `presence-signal-policy.ts` exige −75 para mantener una sesión con ese umbral, pero −70 para abrirla con margen 5. Por tanto, un paquete −75 posterior al cierre no la reabre; el siguiente −70 sí puede hacerlo.
- `markPresenceEnter` dispara una secuencia física al reentrar en gracia. Las claves de deduplicación de reglas incluyen la sesión; una sesión nueva también cambia esas claves.
- La secuencia conecta, envía sonido, espera el followup, envía vibración y desconecta. El lease BLE anterior nace después del intento de conexión y sirve de exclusión; no demuestra presencia ni conexión física. Un ACK de 1150 tampoco demuestra ubicación/conexión.

La evidencia aportada de producción muestra huecos de 38–43 segundos mientras se ejecutan estas acciones y cierres a 30 segundos sin evento de salida. **Es correlación temporal, no demostración de que el firmware suspenda anuncios**. No se consultó producción ni hardware. La primera regresión ejecutada sobre la política anterior falló: a 31 segundos devolvía cierre, aunque la operación controlada seguía en curso.

## Cambio acotado

Nueva migración aditiva `022_controlled_b5_presence_operations.sql`, transaccional por el runner, sin backfill ni cambios de registros/migraciones anteriores. Crea un registro de coordinación actual por identidad central: UUID de operación, sesión local concreta, compañía central validada, referencia de alerta, fechas y resultado. FK restrictivas a inventario local y sesión, CHECK de plazos y estado. No contiene contraseña, payload MQTT ni prueba de ubicación. El registro actual puede reemplazarse por otra operación legítima; no es un histórico completo de operaciones. Se conservan los históricos existentes de sesiones/alertas/comandos.

Antes de conectar, una alarma automática reclama atómicamente una protección para su sesión abierta, si existe una detección aceptada todavía dentro del timeout. Los candidatos técnicos deben pertenecer a la misma compañía central. Una sesión ausente no se inventa ni se protege: la alarma sin sesión conserva su flujo anterior. Sin detección reciente o con otra operación protegida, el intento se clasifica como omitido, no se conecta ni se renueva presencia.

- **Máximo fijo: 120 segundos**, desde la creación; no renovable. Coincide con la duración por defecto del lease BLE existente, no modifica ese default ni el timeout de presencia. Aporta margen al caso observado de 43 segundos y a esperas/ACK individuales, sin prometer cubrir cualquier configuración o firmware.
- Al finalizar con éxito, ambigüedad o fallo, `protect_until` pasa a `min(deadline, finalización + 10 segundos)`. Este pequeño margen de recuperación cubre el retorno observado pocos segundos después de 1200; no es un heartbeat ni una nueva prueba de ubicación. Una respuesta ambigua o un fallo no dejan protección ilimitada.
- Una nueva protección de la misma sesión requiere un paquete aceptado posterior al final de la protección anterior. No se encadenan leases usando el mismo paquete. Otra sesión legítima se trata separadamente.
- UUID de operación impide que una finalización vieja libere una operación posterior. La fila de sesión se bloquea en la reclamación y en el cierre por timeout; el UPDATE de cierre vuelve a comprobar la protección y detecciones más recientes con una consulta posterior al bloqueo. Salidas explícitas no se protegen ni se cambian.
- El barrido consulta plazos persistidos; un reinicio no depende del Set en memoria ni de reconciliar `is_active`. Una operación huérfana vence por tiempo. Los leases BLE creados por esta operación se limitan además al mismo deadline, y escrituras tardías comprueban el UUID vigente.
- El ejecutor usa cancelación al vencer el deadline: no inicia la siguiente acción ni reintenta conexión después de expirar. Realiza una sola desconexión best-effort con su presupuesto HTTP individual, y conserva resultado físico no verificado ante ambigüedad/fallo. No garantiza que el hardware haya desconectado ni deshace una orden ya aceptada por Backend.
- Adquisición, transacción y escrituras de coordinación se limitan a 2 segundos; al excederlos se destruye la conexión prestada. Una adquisición tardía también se destruye una sola vez. No se cambia globalmente el pool.

Las reglas RSSI, sensibilidad, duraciones físicas (incluidas las de 30 segundos), followup, asignaciones, referencias centrales y tipos de alerta no cambian. No se añaden heartbeats ni se escriben `last_seen_at`/`last_presence_at` desde el ejecutor. Las reglas operativas y recordatorios siguen existiendo; el mecanismo no es una deduplicación permanente de alarmas. Una petición física concurrente puede quedar omitida como ya ocurría durante un lease BLE activo; no se crea una cola/reintento automático de avisos omitidos.

## Riesgo de retrasar una salida real

La conexión BLE **no acredita ubicación**. Una persona que salga durante la operación puede seguir apareciendo dentro mientras dure la protección. El deadline lógico no excede 120 segundos desde la reclamación, ni 10 segundos después de una terminación normal, siempre limitado por el primero.

Con barrido y base disponibles, el límite conservador desde la última detección es:

`timeout de presencia + 120 s + intervalo efectivo de barrido + hasta 4 s de consultas controladas`.

Con timeout 30 s y configuración de barrido 10 s, el código actual limita el intervalo efectivo a 7,5 s: aproximadamente **161,5 s** como cota conservadora de cierre almacenado. En el ejemplo, último paquete próximo a la reclamación y terminación a 37 s: protección hasta aproximadamente 47 s, más barrido/consultas. Este retraso debe aceptarse operativamente antes de desplegar. No hay garantía de tiempo real si el proceso, reloj o base no están disponibles; la caducidad no sustituye la monitorización del servicio. Relojes de aplicación/base deben estar sincronizados.

La exposición computable no incorpora la espera: acaba en la última detección válida. La fecha de confirmación de salida puede reflejar el aplazamiento. Gracia continúa empezando en esa última detección, no al liberar el lease; puede quedar menos gracia visible después del cierre. Mantener la misma sesión evita reentrada ficticia y cambio de claves de alerta en el caso reproducido. No se fusionan ni corrigen sesiones históricas anteriores.

No es posible distinguir una salida/reentrada real sin paquetes de un silencio BLE dentro de esta ventana: también podría conservarse una misma sesión en ese caso. Las salidas explícitas sí prevalecen. Además, las reglas operativas existentes calculan permanencia con reloj de pared desde `started_at`, no con el acumulado de exposición del informe; mantener una sesión abierta puede alcanzar otro umbral durante el hueco. No se cambia esa política ni sus umbrales: deduplicación sigue por sesión/regla/etapa y los disparos concurrentes conservan su exclusión. Estas limitaciones deben revisarse con el operador; no se afirma ausencia absoluta de falsas decisiones de ubicación o de avisos de otra etapa.

## Validación y estado recuperable

Regresiones con reloj, transporte y persistencia simulados: secuencia >30 s, recuperación, RSSI de mantenimiento/entrada, duplicados/paquetes antiguos, detecciones de otra gateway, sesión NULL, cierre real posterior, fallo y desconexión incierta, expiración/reinicio, reclamación concurrente, UUID antiguo, alarma legítima posterior, compañía distinta y conexión SQL tardía/bloqueada. Se ejercitan el barrido, ingreso de presencia y recorrido completo de alarma automático; otros fallos físicos permanecen cubiertos por la suite conectada existente.

La prueba opt-in `controlled-ble-presence.postgres.test.ts` aplica las migraciones actuales en un esquema propio de una base desechable PostgreSQL 15; comprueba FK/CHECK, carrera de dos reclamaciones, plazos exactos, propiedad de la finalización y ausencia de modificación de sesiones/leases anteriores. No sustituirla por mocks ni ejecutarla sobre una base compartida. Docker local no tiene daemon; **esta prueba real está pendiente y la rama no se considera lista para desplegar**. También falta aceptación del retraso máximo y validación pasiva del caso real. No se ha demostrado suspensión de anuncios por firmware.

Resultados locales finales: Horneo typecheck/build correctos, 173 aprobadas, 0 fallidas, 3 omitidas (incluida PostgreSQL 15 de esta tarea); Backend typecheck/build correctos, 249 aprobadas, 0 fallidas, 5 omitidas. Sintaxis frontend Horneo correcta; artefactos de producción: 52 comprobaciones. Compilaciones en directorios propios, sin reemplazar `dist` preexistentes. No hubo transporte real, bases compartidas, cambios de configuración, push, merge ni despliegue.

### Ejecutar la validación aislada (operador, antes de desplegar)

Preparar por separado PostgreSQL **15**, vacío y desechable, solo loopback, con nombre de base `horizonst_test_b5` y credenciales efímeras. No utilizar Docker/volúmenes de producción ni publicar puertos externos. En `cold-compliance-service`, compilar y ejecutar únicamente la prueba con:

```sh
CONTROLLED_B5_ALLOW_DATABASE_TESTS=true \
CONTROLLED_B5_TEST_DATABASE_URL="${URL_EXCLUSIVA_POSTGRES_DESECHABLE}" \
node --test dist/modules/compliance/__tests__/controlled-ble-presence.postgres.test.js
```

La URL debe suministrarse sin imprimirla ni incorporarla al historial/repositorio; no se aporta credencial fija. La prueba valida loopback, nombre y versión, crea un esquema UUID propio, y solo elimina ese esquema si lo adquirió. No lee variables de producción para localizar la base. Repetir la suite de Horneo y guardar resultados antes de dar por validada la migración. El runner operativo aplica 022 una sola vez según su ledger; no ejecutar esta prueba contra ese runner/base compartida.

## Validación pasiva en staging y retorno (no ejecutados)

Después de aprobación y despliegue por el operador, observar alarmas legítimas ya programadas; no lanzar alarmas ni lecturas físicas de prueba. Comparar UUID de operación, sesión, plazos, resultado, última detección aceptada y cierre de sesión. Verificar que una sola sesión continúa durante el hueco, el paquete −75 mantiene presencia, y una ausencia real cierra al vencer la protección. Contrastar otra gateway, una salida explícita y una alarma posterior normal. No usar trazas de payloads ni contraseñas.

Consulta mínima de solo lectura, sin nombres/DNI ni secretos:

```sql
SELECT op.operation_id, op.session_id, op.company_id, op.started_at,
       op.hard_deadline, op.protect_until, op.completed_at, op.outcome,
       CASE WHEN op.protect_until <= clock_timestamp() THEN 'expired'
            WHEN op.outcome = 'running' THEN 'controlled_attempt'
            ELSE 'recovery_window' END AS effective_protection,
       s.started_at AS session_started_at, s.ended_at, s.duration_seconds,
       s.close_event_id, s.cold_room_id
FROM controlled_b5_presence_operations op
JOIN tags t ON t.hardware_device_id = op.hardware_device_id
JOIN cold_room_sessions s ON s.id = op.session_id
WHERE lower(t.tag_uid) = 'c65b52531bdc';
```

Retorno: restaurar el artefacto anterior validado de Horneo, por procedimiento autorizado, sin cambiar configuraciones de alarma/RSSI ni borrar leases/históricos. La tabla 022 puede permanecer: el código anterior no la consulta, y los campos BLE anteriores son compatibles. Advertir que vuelve el riesgo de cierres/reentradas original; no presentar ese retorno como solución operativa del defecto. No eliminar la tabla ni alterar ledger a mano. Antes de volver a avanzar, revisar evidencia y cerrar los pendientes, no ampliar el timeout global.

## Archivos de esta entrega

```text
cold-compliance-service/migrations/022_controlled_b5_presence_operations.sql
cold-compliance-service/src/modules/compliance/compliance.service.ts
cold-compliance-service/src/modules/compliance/presence-timeout-policy.ts
cold-compliance-service/src/modules/compliance/__tests__/controlled-ble-presence.test.ts
cold-compliance-service/src/modules/compliance/__tests__/controlled-ble-presence.postgres.test.ts
cold-compliance-service/src/modules/hardware-manager/hardware-command.client.ts
cold-compliance-service/src/modules/presence/__tests__/grace-last-detection.test.ts
cold-compliance-service/src/modules/tag-control/application/tag-physical-alarm.service.ts
cold-compliance-service/src/modules/tag-control/infrastructure/ble-session.repository.ts
cold-compliance-service/src/modules/tag-control/infrastructure/controlled-presence.repository.ts
cold-compliance-service/src/modules/tag-control/infrastructure/tag-control.repository.ts
docs/b5-controlled-presence.md
```
