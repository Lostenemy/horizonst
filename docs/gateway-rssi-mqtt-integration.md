# Integración local de RSSI y observación MQTT

## Referencias y alcance

Rama local `codex/gateway-rssi-mqtt-integration`, creada desde RSSI
`82adc73464398b07ac552db158b4db220e968bb8`. Segundo padre del merge:
MQTT `3e444edf5b77404deebbb5b5d59c85ea04376ec4`. Ambas referencias
publicadas se actualizaron y comprobaron antes de integrar.

Se conservan todas las pruebas de las dos ramas y sus cierres. Los conflictos
en `gatewayMqttPresetUi.test.ts` y `hardwareManagerRoutes.test.ts` se resolvieron
uniendo los casos, no descartando una de las versiones. El fixture de interfaz
deshabilita observación por defecto; los casos 2030 la habilitan explícitamente.
Se conserva también la prueba original de apertura/restauración pasiva y se
añade una regresión integrada en ambos modos con destinos observado/propuesto
deliberadamente distintos y filtro central -60.

Los archivos automáticamente combinados `gateways.html`, `gateways.js` y
`routes/gateways.ts` se revisaron frente a ambos padres: no requieren cambios
funcionales adicionales. La resolución propia modifica los dos archivos de
pruebas y este documento; el resto procede de las ramas publicadas.

## Contrato integrado

| Dato / acción | Comportamiento |
| --- | --- |
| Propuesta MQTT | Plantilla pública del entorno, editable, no obtenida de la gateway; restaurarla no publica ni lee físicamente. Contraseña efímera, nunca tomada del historial. |
| Observación MQTT | Objeto público separado y fechado; no rellena propuesta ni contraseña ni demuestra conexión al broker o correlación del intento. |
| Apertura con flag desactivado | HTTP de consulta; cero publicaciones físicas, incluido 2030. |
| Apertura con flag activado | Puede solicitar un único 2030 para la gateway autorizada; cero 1042, 1030, 1000, B5 o alarmas. No hay reintento automático tras resultado incierto. |
| RSSI central | Filtro físico guardado, no señal del tag ni lectura física. Historial conserva el valor solicitado y resultado/ACK como datos separados. |
| RSSI Horneo | Umbral local de presencia independiente; no se copia al filtro central ni lo reemplaza cuando faltan datos. La evaluación operativa no cambia. |

La afirmación de apertura pasiva del documento RSSI se aplica en esta integración
con `GATEWAY_MQTT_OBSERVATION_ENABLED` desactivado. Activarlo autoriza exclusivamente
la lectura 2030 descrita arriba; no convierte la apertura en una escritura RSSI.
Se mantienen permisos por compañía, rechazo de RSSI implícito, aislamiento de
secretos, bloqueo asesor compartido, concurrencia y bloqueo posterior al timeout.

No se incorpora `codex/b5-presence-controlled-operation`. Los ejecutores físicos,
política de presencia, alarmas y timeouts conservan el código de la base común
`0dd1da6`. Horneo solo incorpora la distinción informativa RSSI y el descarte
protector de respuestas 2030 procedentes de la rama MQTT.

## Validaciones locales

- Backend: typecheck y build TypeScript aislado; suite completa: **268 aprobadas,
  0 fallidas, 5 omitidas** (273 casos).
- Horneo: typecheck y build TypeScript aislado; suite completa: **164 aprobadas,
  0 fallidas, 2 omitidas** (166 casos).
- MQTT UI API: **10 aprobadas, 0 fallidas, 0 omitidas**. No tiene scripts de
  typecheck/build; se comprobó sintaxis de su API y del frontend MQTT UI.
- Contratos del harness de producción: **18 aprobadas, 0 fallidas, 0 omitidas**.
- Artefactos de producción: **52 comprobaciones aprobadas**.
- Sintaxis: Administración `gateways.js`, Horneo `web/app.js`, MQTT UI
  `app.js`, `gatt-lab.js`, `config.js` y API `src/index.js`.
- Conservación de nombres de pruebas de ambos padres, ausencia de marcadores
  de conflicto, diff y revisión de secretos.

Las interfaces se ejercitan mediante DOM/VM simulado; los comandos usan
transportes y gateways simulados. No es una comprobación de navegador o hardware
real. La primera ejecución de la nueva regresión falló por comparar prototipos
de objetos entre contextos VM; se corrigió la aserción de cuerpo vacío y se
repitió la suite completa, sin cambiar código runtime.

Los 7 casos omitidos son PostgreSQL opt-in. Docker local no dispone de daemon:
**no se ejecutó PostgreSQL 15 ni la migración 014 realmente**. El contrato estático
no demuestra aplicación, constraints ni consultas reales. Tampoco se ejecutó el
build completo del demo RFID (dependencias locales ausentes); su descarte 2030
se prueba mediante ejecución del parser real desde la suite Backend.

## Instrucciones de validación (operador, pendientes)

1. Revisar el commit de integración y sus dos padres; no confundirlo con la rama
   de presencia B5. Mantener `GATEWAY_MQTT_OBSERVATION_ENABLED=false`, incluidos
   los Compose versionados y el Compose externo de producción. No iniciar
   lecturas físicas para validar pasivamente el panel.
2. En un checkout desechable de este commit y sin secretos reales, instalar
   dependencias de Backend, Horneo y Store con `npm ci` y compilar cada uno con
   `npm run build`. El harness necesita los tres runners compilados. No
   sobrescribir `dist` preexistentes del checkout de trabajo.
3. Con Docker disponible en un entorno de pruebas autorizado, ejecutar desde
   la raíz `node infrastructure/production/tests/production-migrations.postgres.mjs`.
   El harness crea su PostgreSQL 15 propio, con contraseña aleatoria, sin
   volúmenes, puerto solo loopback, espera estable y limpieza condicional exacta.
   No pasar conexiones de staging/producción ni activar los tests opt-in contra
   bases compartidas. Comprobar ledger/checksum de 014 y segunda ejecución.
4. Antes de habilitar, validar en PostgreSQL 15 desechable el almacenamiento
   público 014 (15 claves exactas, rechazo de `passwd`, FK por compañía y
   conservación de tipos previos del diario). El harness general por sí solo
   no sustituye las comprobaciones específicas de estas constraints.
5. Repetir suites y revisar todos los consumidores/trazas reales del broker
   conforme a `gateway-mqtt-observed-read.md`. No capturar mensajes 2030 crudos:
   pueden contener contraseña. No declarar habilitable la función mientras
   queden migración, consumidores externos o protección de trazas pendientes.
6. Validación pasiva de RSSI con flag apagado: mismo rol/compañía, comprobar las
   etiquetas y los valores independientes central/local; abrir/restaurar no debe
   emitir POST físicos. No solicitar 1042 ni modificar datos para igualarlos.
   La prueba física posterior de 2030 requiere otra autorización expresa.

## Retorno y límites

No hubo push, despliegue, bases compartidas, MQTT real ni hardware. Este es un
merge local solicitado; no se fusionó en `main` ni se aplicaron migraciones.
Los archivos no versionados preexistentes se conservan, incluidos ambos `dist`.

Antes de cualquier retorno autorizado, desactivar el flag. Si alguna vez se
habilitó 2030, conservar los filtros de privacidad de todos los consumidores:
pueden llegar respuestas tardías. No volver ciegamente al artefacto RSSI sin
esos filtros. Conservar la migración aditiva y el diario, sin borrar timeouts
para desbloquear lecturas. RSSI no requiere backfill ni reconciliación de datos.
Un ACK no acredita configuración física actual ni conexión al nuevo broker.
