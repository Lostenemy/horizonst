# Pruebas aisladas tras la actualización Node — 22/10/2026

## Alcance y diagnóstico

Solo entorno de pruebas, runners y sincronización de una prueba. No se cambia código operativo,
dependencias, lockfiles, Dockerfiles de producción, B5, MQTT funcional, alarmas o presencia.
Rama: `codex/test-isolation-node22`, base `2d61b3358fd63181778330b23104aff4d1e8b303`.
No hacer push, merge, despliegue ni acceso a servicios compartidos.

Las evidencias originales están fuera del checkout, en `../test-evidence-20261022/`.
El tar recibido tiene SHA-256 `50646975985b8edffa4646d088e623eea385198797c6f9324cce3ec94ed7942e`.
Los manifiestos anterior/nuevo son idénticos por servicio. Sus hashes son:

- Backend: `2782c3102bf92a52e132b186e795c09bbf28df56440e583789aaf1afa6cd1716`.
- Horneo: `5f95d17b09357a75abfbc6cb5b0ad15f644c4f0541b395f487eeb025ad7ab725`.

No existe revisión OCI que acredite el commit completo de las imágenes. Sí se compararon
los 32 archivos compilados de pruebas Backend y los 43 de Horneo: la transpilación de las
fuentes actuales con finales LF coincide con todos sus hashes del manifiesto. También coincide
`gatewayObservedReads.ts`. Los `dist/` locales preexistentes están atrasados y se conservaron intactos.

### Inventario histórico

`security-tests-node22-inventory.json` contiene 71 unidades fallidas distintas, con ID estable,
nombre, categoría, recurso cuando existe, corrección propuesta y referencias a los logs originales.
El campo de validación referencia la suite completa corregida y mantiene pendiente la reproducción
de las imágenes Linux. Los logs históricos no se borran ni cambian.

| Imagen | Total | Aprobadas | Fallidas | Omitidas |
| --- | ---: | ---: | ---: | ---: |
| Backend anterior | 295 | 275 | 14 | 6 |
| Backend Node 22.23.4 | 295 | 274 | 15 | 6 |
| Horneo anterior | 193 | 133 | 56 | 4 |
| Horneo Node 22.23.4 | 193 | 133 | 56 | 4 |

- Backend: 11 fallos directos `ENOENT`, 3 fallos de carga (TypeScript y dos helpers);
  en Node nuevo aparece además la aserción temporal.
- Horneo: 51 fallos directos `ENOENT`, 5 fallos de carga (tres helpers, TypeScript y una fuente ausente).
  Son 56 unidades fallidas: no sumar otra vez el error raíz de un módulo al wrapper que lo informa.
- Recursos: fuentes `src`, documento 1030, Compose, migraciones del otro servicio, parser RFID,
  helpers compartidos y TypeScript. La solución no consiste en incorporarlos al runtime de producción.
- No se demuestra un defecto de negocio en estos fallos. No atribuir la diferencia temporal a Node.

### Diferencia de recuentos

Con todos los recursos hay 296 pruebas Backend y 203 Horneo, sin añadir ni quitar pruebas de negocio:

- Backend: tres módulos antes representados por un fallo de carga registran ahora cuatro pruebas: +1 neto.
- Horneo: cinco módulos antes representados por un fallo de carga registran ahora quince pruebas: +10 neto.

Las seis omisiones Backend son integraciones opt-in de catálogo, recuperación MQTT, migraciones
observadas, onboarding, persistencia MK4 y ACL. Las cuatro Horneo son PostgreSQL de presencia BLE,
scheduler real, FKs e informes. Permanecen registradas y omitidas explícitamente: no se validaron
integraciones PostgreSQL con este trabajo ni se habilitan automáticamente por variables heredadas.

## Sincronización temporal

La prueba original programa una entrega a 5 ms, descarta su promesa y depende del reloj real.
El timeout total de 60 ms reserva 30 para limpieza: la observación dispone de 30 ms, incluyendo
preparación y persistencia. La respuesta diferida puede perder ese presupuesto bajo carga.
Los mensajes históricos de fallo de adquisición no permiten saber si hubo restauración anticipada
del mock o si ya había expirado el plazo. No prueban una conexión PostgreSQL real.

En un diagnóstico con reloj virtual, 5 ms produce `response_observed`; 31 ms produce `timed_out`.
La línea base completa local con Node 22.23.4 y recursos presentes pasó también el caso original
y sus 20 repeticiones: no se reprodujo localmente la intermitencia histórica. Se conservan esos
resultados y los fallos históricos, sin presentar una hipótesis como causa exacta demostrada.

La corrección espera explícitamente publicación y persistencia, avanza Date y temporizadores
con el reloj de `node:test`, comprueba que la operación sigue pendiente antes de entregar,
rechaza el topic incorrecto, llega al plazo efectivo sin dormir y verifica que la respuesta tardía
no revive el diario. `finally` limpia waiters, espera operaciones pendientes y restaura el reloj.
Se restaura la referencia original de `pool.connect`, sin sustituirla por otra función enlazada.
No aumenta timeouts ni cambia el ejecutor de aplicación.

## Entorno y aislamiento

`infrastructure/testing/run-suites.cjs` exige Node 22.23.4. Crea directorios propios mediante
`mkdtemp`, copia una lista explícita de recursos y compila fuera de los `dist/` preexistentes.
Las dependencias locales se reutilizan mediante enlace: no hubo instalación limpia local.
La imagen dedicada instala mediante `npm ci` los lockfiles sin modificarlos; esa construcción
Docker queda pendiente por indisponibilidad del daemon local.

Cada proceso recibe un entorno mínimo, secretos ficticios aleatorios, y ninguna credencial o flag
opt-in heredado. No se cargan `.env`. El preload rechaza sockets salvo servidores HTTP creados
en el propio worker. Una conexión rechazada hace fallar el proceso aunque el test capture el error.
No constituye una sandbox de seguridad general contra código hostil; Docker `--network none`
es la barrera adicional recomendada. Los tests de aplicación siguen usando sus dobles propios.

Los runners normales de Backend y Horneo reutilizan este entorno y preload, tienen plazo de
150 segundos y concurrencia de archivos 1. Las integraciones se ejecutan aparte, con sus contratos
opt-in existentes y exclusivamente PostgreSQL desechable. No ejecutar contra URLs compartidas.

Cada ejecución conserva workspace, salida íntegra por fase y `summary.json` en una carpeta propia.
No borra workspaces, evidencia fallida ni archivos preexistentes. Los secretos del entorno no se imprimen.

## Comandos exactos

Desde la raíz, con Node 22.23.4 en PATH:

```sh
node --version
node --test infrastructure/testing/isolation.test.cjs
node infrastructure/testing/run-suites.cjs
node infrastructure/testing/run-suites.cjs --repeat-only
```

El último comando construye en otro workspace propio y repite el caso temporal 20 veces,
en proceso nuevo cada vez. `--baseline` recupera de HEAD únicamente la prueba temporal original;
solo es una línea base correcta mientras HEAD siga en el commit base, no después de commitear.
No modifica el checkout. Para regenerar el inventario, usar una salida que todavía no exista:

```sh
node infrastructure/testing/inventory.cjs ../test-evidence-20261022 /tmp/new-failure-inventory.json
```

Comandos habituales, desde cada servicio, con el repositorio completo y dependencias de desarrollo:

```sh
npm run typecheck
npm run build
npm test
```

Esos comandos habituales sí construyen el `dist/` del servicio; para conservar uno preexistente,
usar el runner temporal anterior. No ejecutar tests de contrato desde una imagen runtime incompleta.

### Contenedor dedicado (pendiente de ejecución real)

Desde la raíz, en un entorno Docker de desarrollo autorizado:

```sh
docker build -f infrastructure/testing/Dockerfile -t horizonst-tests:node22-20261022 .
evidence_dir="$(mktemp -d)"
docker run --rm --network none --mount "type=bind,source=$evidence_dir,target=/evidence" horizonst-tests:node22-20261022 node infrastructure/testing/run-suites.cjs --evidence-root /evidence
```

El bind solo conserva resultados propios, no datos de aplicación. No hay publicación de puertos,
volúmenes de servicios, sockets Docker ni secretos montados. La imagen dedicada no es desplegable
como runtime de producción. El `.dockerignore` específico excluye por defecto y permite solo los
recursos necesarios; excluye explícitamente `.env`, claves, certificados, `dist` y `node_modules`.

## Evidencia local y límites

Runtime temporal oficial Windows: Node 22.23.4, SHA-256 del ejecutable
`dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f`,
contrastado con `https://nodejs.org/dist/v22.23.4/SHASUMS256.txt`. No sustituyó el Node instalado.

Resultados finales ejecutados con Node 22.23.4 Windows, usando los runners normales desde
el workspace temporal propio:

| Validación | Total | Aprobadas | Fallidas | Omitidas |
| --- | ---: | ---: | ---: | ---: |
| Backend completo | 296 | 290 | 0 | 6 |
| Horneo completo | 203 | 199 | 0 | 4 |
| Contratos nuevos | 4 | 4 | 0 | 0 |
| Caso temporal, procesos nuevos consecutivos | 20 | 20 | 0 | 0 |

Typecheck y build de ambos servicios finalizaron con código 0.
Las integraciones omitidas son las diez opt-in enumeradas arriba, no exclusiones nuevas.
`git diff --check` no encontró errores. La revisión incremental de los 12 archivos propios no
encontró patrones de claves privadas ni tokens de proveedor. No se leyó ningún `.env`.

Evidencia final: `C:/Users/User/AppData/Local/Temp/horizonst-tests-evidence-XN40J9/`.
Contiene `summary.json`, `backend-suite.log`, `cold-compliance-service-suite.log`, logs de
typecheck/build y `timing-01.log` a `timing-20.log`.
Workspace final: `C:/Users/User/AppData/Local/Temp/horizonst-tests-workspace-wLnjPX/`.
Se preservan también los resultados intermedios en carpetas de evidencia `1jQkfe` (línea base),
`H18Juk` y `3asdfM`, con el mismo prefijo `horizonst-tests-evidence-` dentro del temporal del usuario.
Los fallos originales siguen en `../test-evidence-20261022/tests/`, incluidos los cinco fallos
aislados con Node anterior y el fallo del caso temporal en la suite Node nueva.

No se ha repetido la imagen Linux original, la instalación limpia en Docker ni PostgreSQL real.
No se declara validado hardware, despliegue, negocio autenticado ni el SLA B5.

## Archivos de la entrega

Modificados:

- `backend/src/__tests__/gatewayObservedReads.test.ts`: eventos explícitos, reloj simulado y limpieza.
- `backend/test/run-tests.cjs`: entorno mínimo, guardas offline, plazo y orden estable.
- `cold-compliance-service/test/run-tests.cjs`: mismo aislamiento para la suite normal.

Nuevos:

- `infrastructure/testing/run-suites.cjs`: workspace propio, build/typecheck, evidencia y 20 procesos.
- `infrastructure/testing/offline-preload.cjs`: bloqueo de `.env` y transportes externos.
- `infrastructure/testing/isolation.test.cjs`: cuatro contratos ejecutables del entorno y clasificación.
- `infrastructure/testing/inventory.cjs`: clasificación reproducible e IDs estables de fallos TAP.
- `infrastructure/testing/Dockerfile`: imagen dedicada de pruebas, con instalación limpia pendiente.
- `infrastructure/testing/Dockerfile.dockerignore`: contexto limitado, sin secretos ni dependencias locales.
- `docs/security-tests-node22-inventory.json`: 71 fallos históricos y sus categorías.
- `docs/security-tests-node22.md`: diagnóstico, comandos, resultados y límites.
- `docs/test-isolation-node22-progress.md`: checkpoint breve para continuar sin repetir efectos.

Sin commit: HEAD continúa en la base indicada; rama local sin upstream. La comparación histórica
`main...HEAD` contiene 3368 archivos, 31269 inserciones y 795545 eliminaciones y no representa
el diff propio de esta tarea (que todavía está sin commitear). No usarla como resumen de esta corrección.
