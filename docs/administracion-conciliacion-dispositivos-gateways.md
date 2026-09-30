# Conciliación de dispositivos y gateways de Administración HorizonST

Fecha: 30-09-2026. Análisis local sobre `d103edfb5f15cb3088e756845cd2c4075500f65e`.
Rama documental: `codex/administracion-conciliacion`.
Referencia UX: `C:/Users/User/Documents/horizonst/informe-auditoria-administracion.md`.

## 1. Resultado ejecutivo y límites de la evidencia

**No se ha demostrado que los inventarios vacíos de staging procedan de tablas distintas o de altas por programación.** El resumen, el inventario de dispositivos y el selector de históricos llaman al mismo `GET /api/devices`, que devuelve un array de `devices`. El resumen y el inventario de gateways llaman al mismo `GET /api/gateways`. Bajo el mismo usuario, versión, instante y datos, sus conjuntos base deben coincidir. No hay un endpoint separado de contadores.

Sí se han confirmado en el código y, donde se indica, mediante fixtures:

1. La carga de metadatos puede impedir que los inventarios lleguen a pedir sus registros. Los mensajes HTML de vacío permanecen visibles también en esa situación.
2. «Últimos dispositivos» filtra por `last_seen_at`: no es el inventario. Su texto «No hay dispositivos registrados» es incorrecto cuando hay equipos sin telemetría.
3. Administración no materializa la presencia MKGW3 en `devices.last_seen_at` ni en `device_records`; Horneo sí mantiene presencia en sus propios estados operativos. No debe solucionarse copiando inventario o paquetes crudos.
4. Hay diferencias reales entre las vías programáticas: bootstrap de producción (`device_type='tag'`, MAC de dispositivo minúscula) frente a reconciliación fase C (`device_type='b5'`, MAC mayúscula). Horneo exige B5 activo para identidad operacional.
5. El procesador MK4 compara la MAC de gateway en mayúsculas mediante igualdad textual, mientras onboarding y reconciliación actuales usan minúsculas. Puede descartar una observación válida sin crear histórico.
6. El modelo nuevo de compañía convive con permisos legacy por propietario en categorías, lugares y alarmas. No representan el mismo alcance.

El informe UX observa 13 dispositivos, 6 gateways y listados vacíos; no acredita cuerpos/respuestas de las APIs de inventario. Los hechos anteriores explican escenarios reproducibles, **no identifican por sí solos cuál ocurrió en staging**. No se inspeccionaron servidores, bases compartidas, secretos, correos ni hardware. No se ejecutaron importaciones, migraciones ni MQTT.

## 2. Páginas reales, fuente desplegable y contratos

La fuente efectiva es `backend/public/`: `backend/src/app.ts:51` sirve ese directorio en `/administracion`; `backend/Dockerfile` lo copia a la imagen. La API Express está montada en `/api`. `backend/public/js/base.js:87` construye en el navegador `/administracion/api/...`; el proxy debe dirigirlo a `/api/...`. No se ha comprobado aquí el proxy desplegado ni se propone modificarlo.

Hay otra copia en `frontend/public/`, con páginas antiguas y `places.html`, pero **no la copia el Dockerfile de Backend ni la sirve ese Express**. Modificarla no arreglaría la administración efectiva. No se acredita que otro despliegue la esté sirviendo.

Páginas HTML efectivas: `index`, `dashboard`, `devices`, `device-create`, `gateways`, `history`, `messages`, `alarms`, `categories`, `users`, `companies`. `device-create` es una redirección. No hay una página efectiva independiente de lugares, comandos, firmware o conexiones BLE: estos últimos son subpaneles de `gateways.html`.

Los listados examinados devuelven arrays sin envoltorio (`res.json(result.rows)`); el frontend espera `.length`, `.map`, `.filter` y `.forEach`. No se detecta un desacuerdo array/envoltorio en esta revisión local. Hay que confirmar que los assets y las APIs de staging corresponden a la misma versión.

### Matriz página → datos → discrepancia → propuesta

Los endpoints siguientes se expresan relativos a `/api`; `:id` central es entero, salvo compañía (UUID).

| Página / archivos frontend | Endpoints | Tablas / relaciones | Filtros y permisos | Escrituras ofrecidas | Discrepancia / propuesta |
|---|---|---|---|---|---|
| `dashboard.html`, `js/dashboard.js` | GET `/devices`, `/gateways`, `/alarms`, `/messages` | Inventarios centrales y joins; `alarms` + `alarm_configs`; `mqtt_messages` | Inventarios: alcance hardware; alarmas: owner/grupo; mensajes: alcance gateway | Ninguna | Cuenta arrays; recientes exige `last_seen_at`. Separar inventario y observaciones; no llamar «sin dispositivos» a «sin observaciones». |
| `devices.html`, `js/devices.js` | GET `/categories`, `/users`, `/companies`, `/devices`; POST `/devices`; PUT/DELETE `/devices/:id` | `devices`; LEFT JOIN `places`, `gateways`, `device_categories`, `companies`; usuarios como owner; auditoría | Lectura hardware; alta/baja global; edición técnico de compañía o USER legacy; sin filtro active/status/tipo en listado | Alta, descripción/nombre/categoría; global además empresa, tipo y propietario; baja lógica | Metadatos bloquean GET inventario. Desacoplar carga; preservar autorización y distinguir error de vacío. |
| `device-create.html` | Redirige a `devices.html` | Ninguna consulta propia | Hereda página destino | Ninguna propia | No es otra vía de alta ni otra tabla. Mantener enlace coherente. |
| `gateways.html`, `js/gateways.js` (inventario) | GET `/users`, `/companies`, `/gateways`; POST `/gateways/onboard`; PUT/DELETE `/gateways/:id`; POST `/:id/assign-company` | `gateways`, `gateway_places`, `places`, `companies`; EXISTS `vmq_auth_acl`; auditoría | Lectura hardware; alta/asignación/baja global; edición técnico por alcance; listado incluye inactivas y global incluye no asignadas | Alta MAC sin compañía, edición, baja lógica, asignación posterior | Metadatos bloquean listado global. Prepared no es online; joins de ubicación pueden duplicar filas si hay varias relaciones activas. |
| `gateways.html` (gestión técnica) | GET `/:id/commands`, `/reads`, `/audit`, `/observed-settings`, `/ble-connected-devices`; GET `/devices` | Diarios `hardware_gateway_commands`, `hardware_gateway_reads`, `technical_audit_log`; settings y snapshots BLE; `devices.last_gateway_id` | Alcance de gateway; límites de historial 200; commands filtra compañía histórica para no global; settings/snapshot igualdad compañía | Firmware, identidad/configuración observada, RSSI, B5, BLE y MQTT 1030→1000 por rutas POST/PUT/DELETE específicas | «Últimos dispositivos» no es snapshot BLE ni presencia Horneo. Una API fallida del Promise.all afecta a todo el historial. No convertir lecturas/ACK en inventario ni online confirmado. |
| `history.html`, `js/history.js` | GET `/devices`; GET `/devices/:id/history` | Selector `devices`; `device_records` JOIN `devices`, LEFT JOIN `gateways`, `places` | Mismo alcance del inventario; histórico hasta 500 filas | Ninguna | Selector puede tener equipos sin lecturas. No muestra presencia Horneo ni ACK. Separar esa ausencia de consulta fallida. |
| `messages.html`, `js/messages.js` | GET `/messages` | `mqtt_messages`, LEFT JOIN gateway por MAC normalizada, ubicaciones activas y lugar | Alcance hardware de gateway; hasta 200 filas | Ninguna | No es inventario: solo MK4 crudo en modo app. Cero no demuestra broker caído ni ausencia de presencia MKGW3. |
| `alarms.html`, `js/alarms.js` | GET `/devices`, `/categories`, `/users/groups`, `/alarms/configs`, `/alarms`; POST configs y acknowledge/resolve | `alarm_configs.device_id/category_id/place_id/handler_group_id`; `alarms.device_id`; usuarios/grupos | Selector hardware; configs owner salvo ADMIN; alarmas owner/grupo salvo ADMIN; sin filtro B5 en selector | Crear regla legacy de ausencia, reconocer/resolver | Metadatos bloquean consulta de reglas/alarms; ámbito distinto al nuevo RBAC. No son alertas físicas/cumplimiento de Horneo; revisar validación de referencias sin ampliar permisos. |
| `categories.html`, `js/categories.js` | CRUD `/categories`; biblioteca/fotos | `device_categories.owner_id`, `category_photos`; clasificación `devices.category_id` | ADMIN global, resto owner; no tenancy hardware | CRUD/fotos, no altas de hardware | Categoría no es `device_type` ni compañía. Metadatos owner no cubren necesariamente equipos visibles por compañía. |
| `users.html`, `js/users.js` | CRUD `/users` | `users`; contexto owner de hardware; membresías en API de companies, no en esta UI | CRUD usuarios global hardware | Gestión de usuarios/roles | `owner_id` y `company_user_memberships` no equivalen. Elegir propietario no concede acceso técnico por compañía. No hay selector de equipos aquí. |
| `companies.html`, `js/companies.js` | GET/POST `/companies`; PATCH/DELETE `/:id` | `companies`; alcance deriva de `company_user_memberships`; auditoría | Leer hardware; modificar global; scoped solo compañías activas con membresía | Crear/editar/desactivar/reactivar; asignación gateway en su propia página | Desactivación oculta equipos a scoped, no al global. No hay borrado físico ni cambio de credenciales al asignar gateway. |
| `index.html` | Autenticación vía `js/api.js` y sesión | Usuario autenticado | JWT; rol UI almacenado frente a rol efectivo en servidor | Inicio de sesión | No inventario propio. Comprobar mismo rol efectivo entre páginas, no inferirlo solo por botones. |
| `frontend/public/places.html`, `js/places.js` (copia legacy no servida por app) | GET/POST/PUT `/places` | `places`, fotos; vínculos gateway vía API `assign-place` | ADMIN/owner legacy | Lugares | No restaurar esta pantalla como arreglo de inventario. Decidir continuidad de `places` frente a cámaras/sites antes de conciliar asociaciones. |

## 3. Detalle por pantalla y clasificación de los vacíos

### 3.1 Resumen

`backend/public/js/dashboard.js:106–126` ejecuta las cuatro peticiones en paralelo. `devices.length` y `gateways.length` son contadores de filas visibles, no equipos conectados ni activos. `renderRecentDevices` recibe solo equipos con `last_seen_at` y muestra como máximo diez. El mensaje HTML de `dashboard.html:48` habla de falta de registro aunque el filtro solo acredita falta de última observación central.

**Confirmado en fixture:** 13 dispositivos sin `last_seen_at` producen contador 13 y lista reciente vacía. Puede ser perfectamente compatible con registros creados por UI o bootstrap, que no inventan una detección. La antigüedad no tiene un periodo de corte: se ordena toda última observación disponible.

El contador de mensajes es el tamaño de un listado limitado a 200, no el total histórico. Alarmas activas se calcula descartando RESOLVED de las últimas 500 alarmas devueltas, no de toda la base. Su ámbito legacy difiere del inventario hardware. Un fallo de cualquier petición sustituye las tarjetas por error; no prueba ausencia de entidades.

### 3.2 Dispositivos

`devices.js:46–70,244–252`: primero categorías; para usuario global con selector owner, después usuarios y compañías; solo al terminar ejecuta GET devices. Si falla cualquier metadato, cae al catch y no solicita inventario. `devicesEmpty` comienza visible y el catch no lo oculta. La fila de error puede coexistir con «No hay dispositivos disponibles».

**Confirmado en fixtures:** fallos en categorías o usuarios impiden GET devices; con metadatos correctos renderiza las 13 filas. Esto no depende de cómo se dieron de alta. La auditoría solo comprobó 200 de categorías, no de usuarios/compañías ni de inventario: todavía falta verificar esa cadena en staging.

`backend/src/routes/devices.ts:27–48` usa LEFT JOIN: ausencia de categoría, lugar, última gateway o nombre de compañía **no elimina filas**. El listado no exige compañía activa para global ni `d.active`, `d.status` o `device_type='b5'`. Una asociación ausente puede ocultar al scoped o impedir operación Horneo, pero no justificar vacío del ADMIN en esta consulta.

Alta central: `ble_mac`, `company_id`, `device_type`, `status`, `active`, `owner_id`, `category_id`. No crea ni copia `tags` de Horneo. Baja DELETE es UPDATE active=false/status=inactive; la lista conserva el equipo. PUT permite cambiar compañía a global: no incorpora las comprobaciones de referencias que sí tiene la asignación de gateway. Debe revisarse como política antes de permitir movimientos con historial, no modificarse a ciegas.

### 3.3 Gateways: inventario, asignación y subpaneles

`gateways.js:140–160,682–694`: global espera `/users` y `/companies` antes de GET gateways. Ante error conserva el mensaje de vacío y muestra una fila de error. Técnico/readonly no ejecutan ese metadata global. **Confirmado en fixture:** fallo de usuarios bloquea inventario; éxito muestra seis filas.

`backend/src/routes/gateways.ts:51–75` hace LEFT JOIN de `gateway_places` activo; el esquema `db/schema.sql:96–105` solo tiene índice no único por gateway activo. Si existen dos relaciones activas, una gateway puede contar/renderizar dos veces. No se confirmó ese dato en staging. `assign-place` desactiva vínculos y crea otro en varias consultas sin transacción conjunta (`gateways.ts:776`): revisar concurrencia e integridad antes de una futura corrección.

Campos centrales: id, mac_address, company_id, active, rssi_threshold, modelo/firmware manual y reportado, identity_observed_at. El EXISTS `broker_prepared` comprueba existencia de cuenta por mountpoint vacío/client_id normalizado: **no valida por sí solo contraseña, ACL completa ni sesión online**. `gateways.js:369` declara explícitamente conexión no verificada.

La tabla de equipos vistos (`gateways.js:473`) pide `/devices` y filtra `last_gateway_id`: representa solo la última gateway central de cada equipo. No todos sus encuentros, no las asignaciones trabajador/tag y no la lista 2201. El snapshot BLE es otra observación con fecha, no lista de equipos registrados ni garantía de conexión actual.

Historial técnico (`gateways.js:284`) agrupa cinco GET en Promise.all. Comandos y auditoría conservan compañía del evento; no global pierde historial previo sin compañía tras asignación, mientras global puede consultarlo. Reads consulta el alcance/compañía actual de gateway, sin filtrar expresamente la compañía histórica de cada fila del diario. Settings y BLE sí unen por compañía. En el flujo seguro actual la asignación rechaza reads/settings/snapshots previos, por lo que no asumir fuga real ni arreglar con un join amplio: documentar y probar también modificaciones programáticas.

`gatewayForCommand` exige gateway activa y compañía para operaciones técnicas normales; excepción explícita global sin compañía para configure-mqtt. UI oculta firmware/BLE/RSSI/B5 en gateways sin empresa y permite MQTT inicial a global. Esto es restricción operativa, **no vacío de inventario**.

### 3.4 Histórico de dispositivos

`history.js:15,62`: pide directamente `/devices`; no espera categorías, compañías ni owners. Con el mismo array que el resumen, puede ofrecer 13 opciones aunque otro inventario no haya llegado a realizar su GET. ID es central entero, no UUID de `tags`.

`devices.ts:152–178` consulta `device_records`, no `presence_events` ni `tag_gateway_presence_state` de Horneo. Visible sin records devuelve []; no visible/inexistente devuelve 404; error SQL devuelve 500. El catch UI no oculta siempre el empty anterior; separar estados. No puede inferirse «sin registros» del 200 del HTML. El histórico es limitado a 500 y las actualizaciones deduplicadas no equivalen a cada detección.

### 3.5 Mensajes

`messages.ts` une MAC eliminando ':' y '-' e ignorando case, por tanto es más tolerante que el procesador MK4 y la búsqueda pública device-by-mac. Global usa TRUE y puede ver mensajes sin gateway conciliada; scoped necesita gateway de compañía accesible y USER necesita gateway sin compañía propia. Joins de ubicaciones activas también pueden multiplicar filas.

`mqttService.ts:84–107`: solo decodifica MK4 hacia `handleDeviceRecord`; tráfico `gw/...` se deriva a identidad/configuración/ACK, sin persistencia cruda en `mqtt_messages`. No hay un camino aquí que transforme presencia 3070 MKGW3 en `device_records`. No añadir esa persistencia indiscriminada para satisfacer el contador.

### 3.6 Alarmas y sus selectores

`alarms.js:28–36,145–151`: selector de todos los dispositivos visibles, categorías por owner y grupos. No filtra `active`, estado o B5. Promise.all de metadatos precede a configs/alarms: su fallo bloquea también su lectura. **Fixture:** fallo de grupos impide solicitar configs.

`backend/src/routes/alarms.ts` conserva reglas legacy: ADMIN global, otros por owner o grupo. `hardware_superadmin` global en inventario **no** es global en estas reglas; la UI agrupa ambos como isAdmin en `ui.js`, pero los endpoints legacy comparan literal ADMIN. El POST config inserta deviceId/categoryId/placeId/handlerGroupId sin usar `resolveHardwareAccess` ni comprobar visibilidad del dispositivo: FK de existencia no es autorización. Se requiere una revisión de alcance y referencias, no ampliar permisos para que cuadren las listas. Estas reglas no son `alerts`, `alarm_rules` o `ble_alarm_sessions` de Horneo.

### 3.7 Categorías, usuarios y compañías

Categorías consulta `device_categories` por owner salvo ADMIN; las fotos no alteran la identidad técnica. Filtros de categorías no son filtros del inventario. Un dispositivo puede mostrar categoría por LEFT JOIN sin que esa categoría figure en el selector de un técnico: posible discordancia de metadatos, no pérdida del registro.

Usuarios tiene CRUD global y proporciona owners a altas/ediciones. El rol global UI y rol servidor pueden diferir si el usuario almacenado en localStorage está desactualizado; no se ha demostrado eso en staging. El servidor autenticado es la autoridad. Las membresías por compañía tienen API GET/PUT/DELETE `/companies/:id/memberships...`; `users.html` y `companies.html` no ofrecen un editor de esas membresías. Su asignación no se resuelve seleccionando owner.

Compañías lista activas/inactivas para global, y solo membresías permitidas en compañías activas para scoped. Desactivación conserva registros e historial. Asignación posterior de gateway se ofrece en su inventario, no altera VerneMQ. La API `assignGatewayCompany` bloquea reasignación, referencias legacy y secuencias activas; onboarding permite historial global 1030/1000 previo, pero una gateway con referencias antiguas necesita revisión manual autorizada.

## 4. Recorrido de datos y traslado de responsabilidades

### Historia verificable (no prueba del orden de despliegue)

| Etapa / evidencia Git | Modelo y responsabilidad |
|---|---|
| `c34a6ad` (23-10-2025), `77c2fc0` (25-10-2025): schema/routes de Administración | Inventario central genérico `devices/gateways`, propietario, categorías/lugares, registros MK4 y alarmas legacy. |
| `a883223`, `2f36fa4` (13-03-2026) | Horneo añade su base y UI: `tags` UUID, `gateways` UUID, cámaras/trabajadores/sesiones; POST tags insertaba directamente `tags(tag_uid,model)` (comprobado con git show). Coexistencia, no un rename de la tabla central. |
| `6fbaade` (01-09-2026), Backend 001 | Companies, membresías y RBAC hardware, compañía nullable en inventario, tipo/status de dispositivos, auditoría. Reutiliza tablas centrales existentes. |
| `6d8533e` (01-09-2026), `eab9a32` (02-09-2026) | Fases B/C: conciliación por MAC hacia inventario central, vínculos `hardware_gateway_id` y `hardware_device_id` en overlays. Servicios internos por compañía. |
| `6f4833c` (02-09-2026), `9295d2c` (03-09-2026) | Identidad operativa central y E.3. No se borran overlays; 019 exige IDs centrales no nulos y unicidad y cambia claves operativas. |
| `528d87c`, `f0087f4`, `7360af6`, `b053201`, `8ca8e28` (18–20-09-2026) | Gestión técnica vuelve a Administración: nombres/inventario, capabilities firmware, identidad 2002, settings y snapshot 2201. |
| `88c9996` (bootstrap producción), `2454aa6`/`4220d62`/`5eca4ff`/`b6b5cc0` (24-09-2026) | Nuevas vías programáticas y altas técnicas: bootstrap central; MQTT 1030→1000; onboarding atómico; compañía posterior y CRUD compañías. |

Se inspeccionó `git log --all -- <archivos>` y versiones puntuales; una fecha/commit no demuestra que se aplicara una migración o se desplegara en staging. El informe de arquitectura de septiembre contiene fases objetivo y apartados históricos; E.3 y el código actual prevalecen sobre su propuesta inicial de eliminar tablas o exigir empresa en toda alta.

### Fuente de verdad actual

| Concepto | Autoridad y relación | No confundir con |
|---|---|---|
| Inventario técnico | Base de Backend (`horizonst` en arquitectura): `devices.id` / `gateways.id`, enteros | Filas históricas, tags UUID locales o mensajes |
| Identidad broker | `vmq_auth_acl`: mountpoint, client_id, username, hash y ACL | Empresa, presencia, inventario o conexión efectiva |
| Tenancy | `company_id` UUID y `company_user_memberships`; service principal por compañía | `owner_id` entero legacy o company_name reportado por fabricante |
| Conexión MQTT | Estado verificable del broker/cliente y observación reciente, no materializado como inventario online en estas rutas | Cuenta existente, active=true o ACK de reinicio |
| Presencia Horneo | `tag_gateway_presence_state`, `presence_operational_state`, sesiones, por IDs centrales | Snapshot 2201, última gateway MK4 o estado online del broker |
| Overlay Horneo | `cold_compliance.tags.id` / `gateways.id` UUID enlazados con `hardware_*_id` enteros | Otro inventario técnico independiente |
| Historia técnica | `device_records` MK4, diarios de comandos/reads/settings/snapshots MKGW3 | Histórico completo de presencia o informe laboral |

Los IDs centrales en Horneo no constituyen una FK entre bases PostgreSQL diferentes: se verifican mediante API/reconciliación. Las FK locales se conservan por historia. No comparar UUID overlay con entero central ni asumir que igualdad de nombre identifica un equipo.

### Vías de alta y efectos distintos

1. **UI Administración dispositivo:** POST devices normaliza MAC mayúscula; puede quedar sin compañía, unknown y sin owner/categoría. No crea broker account para un beacon/tag ni overlay de trabajador.
2. **UI gateway:** POST onboard normaliza minúscula y crea en una transacción gateway sin compañía, cuenta broker con bcrypt y ACL exactas, auditoría. Prepared es resultado del alta, no online. Duplicados abortan; no se muestra contraseña.
3. **API gateway POST legacy:** crea inventario con compañía activa y auditoría, pero no llama a onboarding ni crea cuenta broker. Un inventario válido puede no estar preparado en VerneMQ.
4. **Horneo histórico:** antiguas altas insertaban inventario local; actualmente POST tags/gateways devuelve 409 `hardware_manager_authoritative`. PATCH conserva solo parámetros locales; GET enriquece los overlays existentes por ID central. No incorpora automáticamente todo dispositivo central nuevo al listado de overlays ni a una asignación trabajador.
5. **Scripts fases B/C:** `backend/src/scripts/reconcileHorneoGateways.ts` y `reconcileHorneoDevices.ts` reportan conflictos y, con apply, crean/actualizan central y después vinculan overlay. Son dos transacciones en bases separadas: no atomicidad distribuida. No se ejecutaron. No crean cuentas VerneMQ para cada gateway ni telemetría.
6. **Bootstrap producción:** `infrastructure/production/sql/central-inventory-bootstrap.sql:90–128` crea inventario faltante por MAC normalizada y devuelve mapping; el paso Horneo enlaza UUID↔entero. No inventa `last_seen_at`, histórico ni compañía a partir de owner. `provision-hardware-manager.sql` prepara el principal de servicio Backend y sus ACL; no equivale a cuentas de todas las gateways.

**Incompatibilidad confirmada de contratos:** bootstrap usa MAC normalizada minúscula y `device_type='tag'`; el script fase C usa mayúscula y `b5`. `tags/hardware-manager.client.ts:81` y `hardware-manager/event-identity.service.ts:137` rechazan como operativa una entidad que no sea B5 activa/status active. Los tests de paridad comprueban explícitamente que el bootstrap creó tipo tag, pero eso no prueba su aceptación por el runtime Horneo. Hace falta confirmar modelo real antes de cambiar tipos; no convertir todo tag en B5 por suposición.

## 5. Comparación bajo el mismo rol y compañía

`backend/src/middleware/hardwareRbac.ts:35–80` define:

- ADMIN/hardware_superadmin: global TRUE, incluye compañía NULL, compañías inactivas y hardware inactivo.
- hardware_technician/hardware_readonly: compañías activas con membresía read/technician; para escritura técnico exige membresía technician.
- USER legacy: `company_id IS NULL AND owner_id = user.id`.
- Otro rol o hardware scoped sin membresías: FALSE (array vacío en estas lecturas, no ampliación automática).

No existe un selector de compañía en dashboard/history que añada un filtro distinto: ambos heredan el alcance completo del mismo usuario. Una tabla vacía para scoped sin membresía puede ser **exclusión legítima por alcance**, pero el texto no lo explica. Para global no es atribuible a company_id NULL con el código actual.

| Conjunto | Definición | Igualdad esperada |
|---|---|---|
| D | Filas GET devices visibles por rol | Dashboard count = tamaño D; inventario = D; history options = D; alarm selector = D si metadata carga |
| G | Filas GET gateways visibles, con joins de ubicaciones | Dashboard count = tamaño G; inventario = G; no garantiza count DISTINCT id sin validar ubicaciones |
| D reciente | D con last_seen_at no NULL, top 10 | Subconjunto legítimo, no debe igualar inventario |
| D por gateway | D con last_gateway_id igual al id elegido | Última observación MK4, no todas las relaciones/presencia |
| D operativo Horneo | Overlays enlazados + compañía principal + central B5 active/status active | Subconjunto intencional de inventario global; no copiar D entero |
| Históricos | Records/diarios limitados y visibles | No debe exigirse una fila histórica por cada alta |

## 6. Discrepancias confirmadas y pendientes

### Confirmadas en código / fixtures

- **C1 carga y vacío:** metadata bloquea inventario; 8 grupos de aserciones VM de frontend reproducen éxito y fallos sin red (ver sección 9).
- **C2 inventario vs última observación:** contador 13/recientes vacío es reproducible con datos válidos sin telemetría.
- **C3 normalización:** onboarding gateway minúscula frente a `deviceProcessor.ts:32,43` upper + `g.mac_address = $1`. PostgreSQL varchar con igualdad normal es sensible a case. MAC solo dígitos no reproduce la diferencia. Además `/devices/by-mac` normaliza mayúscula pero exige igualdad con columna; API interna sí normaliza columna. Un dispositivo bootstrap minúscula con letras puede listarse y no encontrarse en la API pública by-mac/MK4.
- **C4 tipo bootstrap:** tag vs B5 impide runtime Horneo, aunque no elimina filas del GET devices de Administración.
- **C5 ámbitos legacy:** categorías/places/alarms no usan membresías hardware; superadmin hardware no equivale a ADMIN allí.
- **C6 fuentes de observación separadas:** tráfico MKGW3 no alimenta last_seen ni histórico device_records central; no demuestra fallo de presencia Horneo.
- **C7 entidad sin compañía:** onboarding intencional; acceso scoped excluido; asignación posterior controlada, no crear compañía ficticia.

### Riesgos estructurales confirmados, existencia de datos pendientes

- UNIQUE textual de MAC (`db/schema.sql:88,112`) no prohíbe duplicados semánticos con case/separadores diferentes. Antes de normalizar o crear índices debe detectarse conflicto y preservar históricos.
- gateway_places permite más de una relación activa; joins pueden inflar G/mensajes. Contar filas no prueba número de gateways físicas.
- Overlays tienen IDs centrales obligatorios/únicos en E.3, pero no FK cross-database; comprobar mappings y cambios programáticos por separado.
- Alta solo central no vuelve operativo automáticamente a Horneo: falta un procedimiento explícito de incorporación de overlay/relación cámara-trabajador si esa funcionalidad se necesita. No restaurar altas locales técnicas independientes.
- Asignación de dispositivos entre compañías y creación de alarm_configs requieren política de referencias/autoridad coherente; no ampliar roles como parche visual.

### Hipótesis para ADM-001, sin confirmación de staging

H1: fallo/denegación en users o companies (o excepción DOM) bloqueó GET de inventario.
H2: assets/backend de distinta versión, cache o API base/rol UI distinto al efectivo.
H3: membresías/compañías activas distintas entre sesiones/usuarios observados.
H4: datos centralizados con tipo/normalización/overlay incompletos explican ausencia de telemetría o uso Horneo, **pero no por sí solos** diferencias entre pantallas que consumen idéntico GET.
H5: asociaciones activas duplicadas inflan contador gateway. No se ha observado en base.

No se justifica una migración de datos solo con estos vacíos. C1/C2 requieren corrección de código; C3/C4 pueden requerir código **y**, si se confirman registros incompatibles, conciliación de datos revisada. La pérdida de observaciones descartadas no se reconstruye inventando detecciones históricas.

## 7. Plan de conciliación propuesto (no ejecutado)

| Fase | Acción y resultado verificable | Riesgo / condición de salida |
|---|---|---|
| A. Evidencia de versión/alcance | Capturar secuencia API/JS sin cuerpos personales, mismo usuario y fecha; counts/formatos, metadata status y consola sanitizada; comprobar artefacto | No atribuir fallo de datos a cache o permisos; no compartir JWT ni HAR crudo |
| B. Contratos de lectura/UI | Desacoplar inventario de metadata; estado loading/empty/error/forbidden; separar registrados, observados y conectados; mantener array y alcance | Sin ampliar permisos ni modificar hardware; regresiones role/company y fallo parcial |
| C. Normalización y tipos | Un contrato MAC canónico por entidad para altas, lookups y procesado; inventario de conflictos normalizados; modelo B5 respaldado por evidencia | No reasignar/merge automático; resolver duplicados antes de UNIQUE normalizado; tipos no se deducen del nombre |
| D. Relaciones y conciliación de datos | Dry-run autorizado por compañía con mapping UUID→entero, revisar orphan/null/tipo/active, broker separado; migración nueva solo si necesaria | Nunca copiar inventarios en dos sentidos; preservar históricos, IDs, empresa del diario y credenciales; respaldo/rollback revisados |
| E. Observación e históricos | Definir semántica de presencia técnica central para MKGW3 si negocio la requiere; alimentar estado resumido por ruta validada, no duplicación cruda | No confundir MQTT online con presencia ni cambiar B5/ACK/RSSI; explicitar límites de historia existente |
| F. Incorporación operativa | Procedimiento explícito para nuevo hardware central y overlay Horneo/cámara/asignación; membresías por compañía auditadas | No reabrir edición técnica local; ningún cambio operativo sin prueba aislada y autorización |
| G. Aceptación | Pruebas completas fixture/API/PG aislado/browser con roles y mismas entidades; después validación staging autorizada | HTTP 200 y counts coincidentes no bastan: comprobar IDs, render y operación permitida/denegada |

Decisiones pendientes: alcance comercial/técnico de alarmas legacy y lugares; catálogo tag vs B5; permisos metadata para hardware_superadmin; cómo incorporar overlays nuevos; qué significa «última vez visto» en central; disponibilidad/paginación de históricos. Evitar sincronización bidireccional: hardware central gobierna identidad; Horneo gobierna reglas y relaciones operativas propias.

## 8. Comprobaciones mínimas de staging para que las ejecute el equipo

No se ejecutaron aquí. Usar acceso ya autorizado y sesión habitual, sin mostrar credenciales. En DevTools registrar solo ruta, status, formato array/no array, tamaño y si se solicitó inventario. Para un mismo usuario: dashboard→devices→history→gateways, sin cambiar sesión. Revisar `/categories`, `/users`, `/companies` y consola; no exportar HAR con Authorization, nombres o emails. Comparar conjuntos de IDs dentro del navegador y compartir únicamente si coinciden y sus conteos, no cuerpos de entidades.

En la base **central** correspondiente, las siguientes consultas devuelven solo agregados. Configurar `:user_id` con el ID del usuario de la prueba, sin mostrar email/token; si el esquema difiere, detenerse, no adaptar escrituras:

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';

SELECT role, count(*) AS users FROM users WHERE id = :user_id GROUP BY role;
SELECT c.active, m.role, count(*) AS memberships
FROM company_user_memberships m JOIN companies c ON c.id=m.company_id
WHERE m.user_id=:user_id GROUP BY c.active,m.role;

WITH scope AS (
  SELECT u.id,u.role,m.company_id
  FROM users u
  LEFT JOIN company_user_memberships m ON m.user_id=u.id
    AND m.role IN ('hardware_readonly','hardware_technician')
  LEFT JOIN companies c ON c.id=m.company_id
  WHERE u.id=:user_id
    AND (u.role IN ('ADMIN','hardware_superadmin','USER') OR c.active=TRUE)
), visible_devices AS (
  SELECT d.* FROM devices d WHERE EXISTS (
    SELECT 1 FROM scope s WHERE s.role IN ('ADMIN','hardware_superadmin')
      OR (s.role='USER' AND d.company_id IS NULL AND d.owner_id=s.id)
      OR (s.role IN ('hardware_readonly','hardware_technician') AND d.company_id=s.company_id)
  )
), visible_gateways AS (
  SELECT g.* FROM gateways g WHERE EXISTS (
    SELECT 1 FROM scope s WHERE s.role IN ('ADMIN','hardware_superadmin')
      OR (s.role='USER' AND g.company_id IS NULL AND g.owner_id=s.id)
      OR (s.role IN ('hardware_readonly','hardware_technician') AND g.company_id=s.company_id)
  )
)
SELECT 'devices' AS entity,count(*) AS visible,
       count(*) FILTER(WHERE last_seen_at IS NOT NULL) AS observed FROM visible_devices
UNION ALL SELECT 'gateways',count(*),NULL::bigint FROM visible_gateways;

SELECT device_type,status,active,(company_id IS NULL) AS unassigned,
       count(*) AS devices,count(*) FILTER(WHERE last_seen_at IS NOT NULL) AS observed
FROM devices GROUP BY device_type,status,active,(company_id IS NULL);
SELECT count(*) AS normalized_device_duplicate_groups FROM (
  SELECT 1 FROM devices GROUP BY regexp_replace(lower(ble_mac),'[^0-9a-f]','','g') HAVING count(*)>1
) x;
SELECT count(*) AS normalized_gateway_duplicate_groups FROM (
  SELECT 1 FROM gateways GROUP BY regexp_replace(lower(mac_address),'[^0-9a-f]','','g') HAVING count(*)>1
) x;
SELECT count(*) AS gateways_with_multiple_active_places FROM (
  SELECT gateway_id FROM gateway_places WHERE active=TRUE GROUP BY gateway_id HAVING count(*)>1
) x;
SELECT count(*) AS lowercase_letter_gateway_macs FROM gateways
WHERE mac_address ~ '[a-f]';
SELECT count(*) AS records FROM device_records;
SELECT count(*) AS gateway_accounts_present FROM gateways g WHERE EXISTS (
  SELECT 1 FROM vmq_auth_acl a WHERE a.mountpoint='' AND a.client_id=
    regexp_replace(lower(g.mac_address),'[^0-9a-f]','','g')
);
ROLLBACK;
```

Los agregados globales requieren operador autorizado; no equivalen al scope de usuario. No seleccionar password/hash, payloads o auditorías completas. Si metadata falla, bastan mensaje técnico/status sanitizados y nombres de migraciones/columnas ausentes, no log SQL con datos privados.

En **cold_compliance**, por separado (no join cross-database):

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT count(*) AS tags,count(hardware_device_id) AS mapped,
       count(DISTINCT hardware_device_id) AS unique_mapped FROM tags;
SELECT count(*) AS gateways,count(hardware_gateway_id) AS mapped,
       count(DISTINCT hardware_gateway_id) AS unique_mapped FROM gateways;
SELECT count(*) AS current_presence_rows FROM tag_gateway_presence_state;
ROLLBACK;
```

Counts no prueban que cada mapping apunte al equipo/empresa correcto. Si los agregados detectan diferencia, una segunda revisión autorizada debe comparar IDs centrales y MAC normalizada en privado, sin trabajadores/DNI y sin modificar filas. No ejecutar scripts `--apply` como diagnóstico.

## 9. Pruebas realizadas y aceptación necesaria

### Realizadas en esta revisión

Lectura de HTML/JS/routes/servicios/migraciones/SQL y Git; no se ejecutó SQL. Se usó Node VM en memoria con JS real de las páginas, DOM y apiGet simulados; no archivos de fixture persistidos ni solicitudes reales:

- 8 grupos de aserciones frontend, 0 fallos: devices y gateways renderizan 13/6 con metadata válida; error users bloquea cada inventario; error categories bloquea devices; history ofrece 13; dashboard cuenta inventario sin last_seen y deja recientes vacío; error grupos bloquea configs de alarmas.
- 8 grupos de aserciones de RBAC/contratos, 0 fallos: roles globales, scoped por compañía, USER owner sin compañía, normalización central diferente por entidad, comparación textual MK4 y discrepancia tag/B5. Se transpilaron módulos en memoria con pool simulado, sin cargar config/.env.
- 2 casos adicionales con el procesador MK4 real transpilado en memoria y conexión simulada: gateway guardada en minúsculas termina en ROLLBACK sin INSERT de histórico; la misma MAC guardada en mayúsculas permite INSERT del record y UPDATE del dispositivo. No se ejecutaron estas escrituras en PostgreSQL.

Son **16 grupos de comprobaciones locales y 2 casos del procesador**, no pruebas PostgreSQL o browser completo. DOM simplificado no prueba cache, CSS ni scripts del servidor. La comparación SQL case-sensitive se revisó en contrato/código y conexión simulada, no contra la base desplegada. No se ejecutaron suites funcionales completas ni builds: el único cambio de esta entrega es Markdown.

### Criterios para una futura corrección

1. Mismo usuario/compañía y snapshot: IDs D iguales en contador, inventario, history y selector alarmas; G coincide con IDs únicos tras validar ubicación. Separar sublistas de observación.
2. Metadata 403/500/timeout y errores DOM: inventario carga lo autorizado o muestra error inequívoco; nunca falso empty; ningún permiso se amplía.
3. ADMIN y hardware_superadmin ven no asignadas; scoped no las ve/opera; compañía desactivada excluye scoped; readonly no escribe; owner legacy no confiere membership.
4. Alta por UI/API/bootstrap/reconciliación produce entidad canónica única por MAC semántica. Tests de concurrencia y rollback PG15 aislado; ningún hash/ACL/secret cambiado por conciliar UI.
5. MAC con case/separadores y letras: misma resolución en lista/by-mac/interna/procesador MK4; sin autocrear equipo a partir de paquete.
6. Modelo B5 confirmado en bootstrap/conciliación es aceptado por Horneo; sensor/tag genérico no se convierte automáticamente. Overlay y central no se duplican ni se confunden sus IDs.
7. Inventario preparado sin conexión ni lecturas sigue visible; histórico vacío se distingue de 404/500; GW presence no exige persistir raw3070.
8. Dos ubicaciones activas se detectan/rechazan por el mecanismo decidido; count no se infla; asignaciones concurrentes no crean relaciones contradictorias.
9. Aislamiento de referencias en alarmas, dispositivos y diarios: operaciones con entidad de otra compañía no autorizan ni revelan recursos ajenos; preservar empresa histórica y redacción de secretos.
10. Browser local desktop/mobile prueba secuencia misma sesión y dataset, red/API/permisos/render; staging solo después de autorización. Ninguna prueba publica MQTT ni ejecuta acciones físicas.

## 10. Resultado documental

No se declara resuelta ADM-001 ni conciliados datos desplegados. La primera actuación propuesta es probar la cadena de carga y versión bajo la misma sesión; la segunda, validar contratos MAC/tipo y mappings existentes. Solo si esa evidencia demuestra incompatibilidades se diseña una migración/conciliación nueva, revisable y autorizada.

La entrega inicial fue exclusivamente documental. La corrección posterior autorizada se describe a continuación; las secciones anteriores conservan los hallazgos del código anterior y no son una afirmación del estado desplegado.

## 11. Corrección autorizada de código — 30-09-2026

### Base y evidencia aportada de staging

Rama `codex/administracion-conciliacion-fixes`, creada desde `origin/main` después de `git fetch origin main`; base `d103edfb5f15cb3088e756845cd2c4075500f65e`. No parte de un main local atrasado.

El usuario aporta comprobaciones realizadas en staging; esta entrega **no accedió a staging**:

- Administración: 13 dispositivos, todos B5/estado active/active=true y con compañía; 6 gateways con compañía. Ningún dispositivo tiene `last_seen_at`.
- Los dos inventarios cargan actualmente. El vacío original **no se reproduce**: no se demuestra su causa retrospectiva ni se declara cerrado ADM-001.
- No hay duplicados por MAC normalizada ni gateways con varias ubicaciones activas.
- Horneo: 13 tags y 5 gateways, enlaces centrales únicos, sin ID central inexistente ni diferencia de MAC normalizada.
- La sexta gateway es del usuario para pruebas: no se incorpora a Horneo automáticamente.
- Estos agregados no prueban coincidencia de compañías, autorización ni preparación de cuentas/ACL del broker.

### Causas reproducidas y correcciones

| Punto | Causa comprobada localmente | Corrección y alcance |
|---|---|---|
| Inventarios | La inicialización esperaba categorías/usuarios/compañías antes de consultar inventario; un 403/500/timeout de metadatos podía impedir renderizarlo. | Inventario y metadatos se cargan independientemente en `backend/public`. Estados cargando/vacío válido/error/denegado, reintentos y ausencia de mensajes vacíos contradictorios. |
| Acciones dependientes | Los formularios podían carecer de opciones válidas cuando fallaba un recurso auxiliar. | Crear/editar dispositivo queda deshabilitado mientras falten sus metadatos; editar gateway global requiere propietarios y asignar compañía requiere compañías. Desactivar y alta MAC-only no dependen de esos metadatos. No se modifican autorizaciones del servidor. |
| Histórico y alarmas | Selectores fallidos y resultados parciales podían confundirse con ausencia de lecturas/reglas. | Histórico distingue error del selector y del diario, permite reintento y descarta respuestas de selección obsoleta. Configs/alarmas se leen aunque falle su formulario; un fallo del conjunto evita mostrarlo como completo. |
| Subpanel técnico gateway | La carga conjunta fallida dejaba diarios/fotografía previos y feedback ambiguo. | Se limpian resultados parciales, se indica fallo y reintento; un refresco concurrente no crea otra consulta conjunta. La última observación central tiene estado independiente del inventario global. |
| Observaciones | Textos vacíos sugerían ausencia de inventario o un periodo no solicitado. | Resumen: ausencia de última observación central no es ausencia de equipos. Histórico: hasta 500 registros centrales, no presencia de Horneo. Mensajes: hasta 200 MK4, no raw MKGW3. Diarios técnicos: hasta 200 por diario. Ningún evento artificial. |
| MAC | Alta/onboarding guardaban gateway en minúsculas y MK4 buscaba en mayúsculas por igualdad literal. | Contrato compartido en `utils/mac.ts`: 12 hex o seis octetos con `:`/`-` uniforme; trim; gateway minúscula/dispositivo mayúscula. By-MAC públicas/internas y MK4 comparan columnas normalizadas sin actualizar filas. El onboarding reutiliza el contrato. Los formularios rechazan basura en vez de borrarla silenciosamente. |
| Ambigüedad y altas | Elegir la primera coincidencia normalizada permitiría asociar observaciones a una entidad arbitraria. | Lecturas by-MAC visibles devuelven 409 ante entidades diferentes coincidentes; MK4 descarta observación ambigua sin autocrear. Altas legacy comprueban colisiones dentro de transacción con advisory lock por MAC (gateway comparte clave de onboarding). Claim legacy no actualiza si hay más de una coincidencia; conserva respuesta 404 no reclamable para no revelar inventario fuera del alcance. |

El timeout de los GET del frontend es 15 segundos, incluye lectura JSON y limpia su timer. POST/PUT/PATCH/DELETE físicos no cambian. No se cambia `normalizeGatewayMac` usado por ACK/comandos ni ningún payload, topic o protocolo de fabricante.

Los JOIN de ubicación siguen sin corregirse: dos ubicaciones activas no son dos gateways. La detección de ambigüedad pública cuenta IDs distintos para no confundir ese problema con una colisión MAC. No hay limpieza de datos ni índices nuevos; el coste de las búsquedas normalizadas debe medirse antes de proponer índices.

### Vías programáticas: decisión pendiente explícita

Se mantienen sin modificar ni ejecutar bootstrap y conciliadores. El bootstrap central de producción crea `device_type='tag'`; `reconcileHorneoDevices.ts` crea B5 y actualiza solo tipos B5/unknown según su contrato actual. Los 13 B5 verificados en staging no prueban el modelo de cada futura entrada programática. Antes de cambiar esas vías, se necesita evidencia de modelo por dispositivo o una decisión de negocio que limite explícitamente el origen a B5 demostrados. No se infiere por nombre/MAC, no se convierte indiscriminadamente tag/sensor a B5 y no se duplican inventarios/overlays.

### Pruebas persistidas y resultados

- `administrationLoading.test.ts`: ejecuta los JS efectivos con Node VM y DOM/API ficticios. Roles ADMIN, hardware_superadmin, técnico, readonly y USER; errores 403/500/timeout de cada recurso auxiliar; inventario válido/vacío/error/reintento; alarmas e histórico independientes; subpanel técnico parcial/concurrencia; formatos MAC del formulario y timeout GET.
- `inventoryMac.test.ts`: peticiones HTTP reales sobre Express local, autenticación firmada ficticia y pool simulado. Scope/404 entre compañías y USER legacy, denegación de escrituras, MAC inválida/normalizada/ambigua; procesador MK4 real con conexión simulada, rechazo de ambigüedad y de observación cross-company. No demuestra ejecución de SQL real.
- `inventoryMac.postgres.test.ts`: prueba opt-in persistida para PostgreSQL **15**, inventario normalizado y escritura MK4 sin MQTT. Exige URL loopback, nombre de base terminado en `_isolated_test` y consentimiento `INVENTORY_MAC_ALLOW_DATABASE_TESTS=true`; crea/elimina solo su schema UUID. **No ejecutada**: Docker local no tiene daemon disponible. No usar base compartida.
- Backend: typecheck y build correctos; suite completa **227 pruebas: 223 aprobadas, 0 fallidas, 4 omitidas**. Omisiones: pruebas que requieren PostgreSQL aislado, incluida la nueva. No se cuentan como aprobadas.
- Horneo sin cambios: typecheck y build correctos; suite completa **154: 152 aprobadas, 0 fallidas, 2 omitidas**. Compilación en directorio nuevo para conservar el `dist` no versionado preexistente. Un primer intento fuera del servicio falló por una ruta relativa de una prueba; la repetición con ubicación correcta pasó.
- Sintaxis de todos los módulos `backend/public/js/*.js` comprobada mediante `node --input-type=module --check`; `git diff --check` correcto.
- Navegador real local mediante Playwright y `administration-browser-fixture.cjs`: misma sesión ADMIN ficticia, resumen 13/6, inventarios 13/6, selector histórico 13, sin última detección. Con `/users` 403 siguen 13 filas y edición deshabilitada; reintento restaura edición sin recargar inventario. En viewport 390×844 siguen 13 filas y no aparece falso vacío. No equivale a una auditoría visual integral o prueba contra el despliegue. El servidor de fixtures solo escucha loopback y acepta GET; no carga app, .env, DB ni MQTT.

Las pruebas de fixtures y navegador no verifican compañías reales, ACL, presencia de Horneo ni conectividad del broker. Se conserva la distinción entre inventario registrado, cuenta preparada, sesión conectada y observación recibida. El helper de carga y las pruebas influyeron en la corrección; ninguna skill autoriza operaciones externas.

### Validación posterior propuesta en staging (requiere autorización aparte)

1. Ejecutar primero la nueva prueba PostgreSQL 15 en base desechable loopback, junto con pruebas de onboarding existentes; no apuntar al entorno compartido. Revisar SQL y rendimiento de lookup antes de considerar la rama validada contra PostgreSQL.
2. Bajo la misma sesión y compañía, comparar IDs autorizados de resumen, inventarios, selector histórico y selector de alarmas; comprobar los 13/6 actuales sin exigir `last_seen_at`. Repetir con técnico/readonly y USER legacy sin ampliar permisos.
3. Simular 403/500/red lenta de metadatos mediante interceptación del navegador, no cambiando roles/ACL/datos: inventario permanece, acciones afectadas se deshabilitan, reintento recupera. Un 403 del propio inventario no muestra vacío válido ni datos previos.
4. Repetir lectura by-MAC con case/separadores bajo el mismo scope; inválidas 400, ajenas 404 y ambigüedad controlada 409 solo con fixtures, nunca introduciendo duplicados reales.
5. Confirmar por separado coincidencia de compañías y preparación del broker con agregados de solo lectura ya propuestos; no asumir conexión online ni publicar comandos para comprobarla. No incorporar la gateway de pruebas a Horneo.
6. Si reaparece ADM-001, conservar build servido, rol/scope, rutas/status y errores sanitizados para reproducirlo; HTTP 200 o las correcciones locales no cierran por sí solos el incidente.

**Límites:** no hay migraciones, backfill, limpieza de MAC, cambios de permisos/compañías, overlays, credenciales o ACL; no se cambian Horneo, B5/RSSI/ACK/alarmas físicas. Sin bases compartidas, MQTT real, hardware, correos, push, merge ni despliegue. El punto tag/B5 y la validación PostgreSQL aislada siguen pendientes.
