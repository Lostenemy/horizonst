# B5: revisión del presupuesto TOTAL de confirmación de salida

## Estado y alcance

Base: `2aab0fa81d861bbb40db841a0a6478f3dd686365`, rama
`codex/gateway-rssi-mqtt-b5-integration`. **Despliegue bloqueado.** El operador
rechaza la cota anterior. Este documento conserva el diagnóstico inicial.
La implementación posterior se detalla al final y en su informe de validación;
no garantiza todavía el máximo TOTAL de 90 s ni autoriza despliegue.

El operador informa de cinco ejecuciones satisfactorias en PostgreSQL 15 de
la base indicada. Es evidencia aportada, no una ejecución realizada aquí;
prueba la corrección del fixture, no el nuevo requisito temporal.

## Presupuesto y evidencia del código

Sean D la última detección válida pertinente, C la reclamación, F la
finalización física, B el retraso hasta el barrido, Q las consultas hasta
COMMIT del cierre, W la espera tras otras sesiones y E la demora de ejecución
del proceso. Todos los intervalos se expresan en segundos.

La implementación exige una detección reciente al reclamar: `0 <= C-D < 30`
en condiciones de relojes coherentes. El límite físico y la protección inicial
coinciden en `C+120`. Tras finalizar, `protect_until=min(C+120,F+10)`.
La confirmación por timeout requiere además antigüedad superior a 30 s.

Por tanto, para una única operación y sin nuevas detecciones:

`T_commit-D <= max(30, min(C-D+120, F-D+10)) + B + Q + W + E`.

Sin finalización, el cálculo anterior de `30+120+7,5+4=161,5 s` es solo un
presupuesto nominal: **no es una cota absoluta**, pues omite W y E. Los 10 s de
recuperación no se suman otra vez a los 120: están limitados por ese deadline.
`startPresenceTimeoutLoop` calcula B nominal como
`min(10000,30000/4)=7500 ms`, no los 10000 ms configurados.

Evidencia local:

- `controlled-presence.repository.ts`: reclamación y finalización persistidas;
  `hard_deadline` de 120 s desde reclamación; transacciones controladas a 2 s.
- `tag-physical-alarm.service.ts`: `operation.deadlineMs` programa el aborto
  de la secuencia. Reducirlo cancela esperas/acciones; no está autorizado como
  efecto secundario del nuevo límite de presencia.
- `ble-session.repository.ts`: el lease físico también utiliza
  `op.hard_deadline`. No debe confundirse con un plazo de ubicación.
- `compliance.service.ts`: `closeStaleSessions` recorre secuencialmente todas
  las sesiones; cada cierre se protege con transacción de hasta 2 s después
  de un snapshot de hasta 2 s. Tras COMMIT, `finalizeSession` espera
  `markPresenceExit`, acumuladores y posibles alertas antes de seguir.
- `db/pool.ts`: esas operaciones posteriores no tienen timeout global de
  adquisición o consulta. Una espera larga, aunque finalmente satisfactoria,
  impide acotar W de las demás sesiones. Si falla una transacción controlada,
  el barrido actual abandona las sesiones restantes por propagación del error.
- `setInterval` no evita barridos superpuestos ni garantiza la puntualidad del
  event loop. La disponibilidad por sí sola no limita latencia ni carga.

Ni disminuir la protección ni destruir una consulta a los 2 s garantiza que
la salida esté **almacenada**: un timeout limita una espera, no asegura COMMIT.

## Propuesta localizada, pendiente de aprobación

1. Conservar el deadline físico existente de 120 s y su lease, sin recortar
   sonido, vibración, followup o reintentos ya admitidos.
2. Separar la protección de presencia: capturar D con precisión PostgreSQL
   dentro de la reclamación bloqueada y fijar inicialmente
   `protect_until=min(D+60 s,C+120 s)`. No usar `C+60`: con un paquete de
   antigüedad 29,999 s agotaría casi 90 s antes del barrido.
3. Finalización: `protect_until=min(protect_until,hard_deadline,F+10 s)`;
   jamás extender la protección vigente. Mantener UUID, bloqueo de sesión y
   condición de detección nueva. El mismo paquete no habilita otra protección.
4. Aplicar también el techo D+60 a las filas preexistentes durante lectura y
   UPDATE de cierre, usando tokens SQL exactos, sin backfill. La frontera que
   se guarda como confirmación debe ser coherente con ese techo. No truncar
   microsegundos; no alterar duración de exposición ni comienzo de gracia.
5. Separar la fase de COMMIT de salida de efectos posteriores. Diseñar un
   recorrido de cierres con cola/latencia acotadas y errores aislados por
   sesión. No hacer fire-and-forget de escrituras/alertas ni repetir el
   disparo físico. Si se difieren efectos, necesitan recuperación durable;
   su diseño excede cambiar una constante de protección.

Con los puntos 1–4, el peor presupuesto nominal es
`60+7,5+2+2=71,5 s`. Restan **18,5 s** para W+E y reintentos de consultas;
el código actual no acredita ese margen. En el caso normal, F-D=38–43 s:
`48–53+7,5+Q`, es decir, aproximadamente 57,5–64,5 s si Q=2–4 s y no hay cola.
No son mediciones de hardware ni garantías de tiempo real.

Los huecos de 38 y 43 s quedan dentro de la ventana de 60 s, si la reclamación
se realiza con detección todavía vigente. Los paquetes posteriores aceptados
por otra gateway mantienen sus reglas normales; duplicados o atrasados no
renuevan el plazo de la operación. Una detección realmente nueva cambia la
referencia para ausencia ordinaria, no debe confundirse con renovación BLE.

## Secuencia prolongada y riesgos que requieren decisión

Después de D+60, la presencia deja de estar protegida aunque el ciclo físico
siga vivo hasta su límite anterior. Una ausencia se debe confirmar sin abortar
ese ciclo. Una detección posterior puede abrir una nueva sesión: se recupera
el riesgo de salida/reentrada durante silencios mayores de 60 s. La exclusión
física existente puede omitir avisos mientras siga activa; no hay cola durable
de avisos omitidos. Tras liberar el ciclo, alarmas legítimas posteriores deben
seguir siendo posibles, sin duplicarlas por la misma operación.

La conexión BLE no acredita ubicación. No es posible simultáneamente ocultar
todo silencio físico de duración arbitraria y garantizar ausencia confirmada
en 90 s sin nuevas detecciones. El inicio de gracia y exposición se mantienen
en la última detección, no se fabrican heartbeats. Salidas explícitas prevalecen.

**Decisión recibida:** el operador autoriza ampliar el recorrido de cierre y
los efectos posteriores para sostener el objetivo de 90 s dentro de un sobre
de carga explícito. Exige transacción canónica con estado fuera y outbox,
consumidor recuperable/idempotente, barrido no solapado con concurrencia y
pool acotados y avisos omitidos durables. Acepta salida/reentrada si el
silencio supera 60 s mientras continúa el ciclo físico. No autoriza despliegue.
Queda por acordar el máximo de sesiones y las condiciones de latencia para
la prueba de SLA, sin convertir disponibilidad en una garantía de tiempo real.

## Validación y siguiente acción

Ejecutado en esta revisión: Horneo typecheck y build correctos (salida en
directorio temporal propio, no en el `dist` preexistente); suite completa:
178 aprobadas, 0 fallidas, 3 omitidas de 181. Contratos de producción:
18 aprobados, 0 fallidos, 0 omitidos. Artefactos: 52 comprobaciones aprobadas.
No se añadieron pruebas del nuevo plazo porque no se ha implementado; estos
resultados son regresiones de la base, no aceptación del requisito de 90 s.

Docker local no tiene daemon disponible. No se creó PostgreSQL ni se ejecutó
la prueba real en esta revisión. El procedimiento aislado de cinco repeticiones
en `b5-presence-precision-integration.md` sigue siendo aplicable a la base.
**No valida la propuesta no implementada**.

Pendientes tras la decisión: reloj/transporte simulados para huecos 38/43 s,
reclamación con D anterior, cap exacto 60 s, COMMIT antes de 90 bajo la carga
acordada, fallos y reintentos, físico prolongado sin aborto por presencia,
reinicio, concurrencia, UUID obsoleto y paquetes ±1 microsegundo en fronteras.
Después, cinco repeticiones en PostgreSQL 15 desechable y suite completa.
Mantener todas las aserciones y las migraciones publicadas.

## Checkpoint de implementación y evidencia pendiente

Se conserva el commit diagnóstico `c7c52ce06fdab9d2b530e6cbf480e6f5c26a38d4`.
La implementación ahora conecta cierre canónico/outbox, efectos transaccionales,
cola física durable, aceptación de paquetes con lock compartido y barrido
concurrente no solapado. Se mantiene la protección D+60 separada del deadline
físico. No se acepta el límite sugerido de 16 sesiones.

El estado actualizado, las mediciones locales y las limitaciones están en
[b5-presence-outbox-validation.md](b5-presence-outbox-validation.md). Los
apartados previos conservan el cálculo/diagnóstico inicial; ya no representan
la ausencia de implementación. La garantía TOTAL de 90 s sigue sin validarse.

Siguiente acción obligatoria antes de despliegue: cinco ejecuciones PostgreSQL
15 desechable de la prueba ampliada, medición de capacidad representativa y
aceptación del sobre operativo respaldado por esa evidencia. No extrapolar
mocks ni las ejecuciones PostgreSQL anteriores. No hay push ni despliegue.
