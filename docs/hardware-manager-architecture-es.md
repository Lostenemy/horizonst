# Informe de arquitectura — HorizonST Hardware Manager

Fecha de auditoría: 1 de septiembre de 2026

Rama auditada: `codex/manual-emergency-b5`

Alcance: diseño y auditoría; sin despliegues, migraciones ni cambios de comportamiento.

## Resumen ejecutivo

La recomendación es **reutilizar y refactorizar parcialmente el servicio Docker `app`** como base del HorizonST Hardware Manager (opción B). No debe usarse tal como está ni conviene crear un tercer backend.

`app` ya es la aplicación horizontal más próxima al dominio buscado: dispone de inventario genérico de gateways y dispositivos BLE, histórico técnico, almacenamiento MQTT, autenticación, API y una interfaz de administración independiente de Horneo. Sin embargo, su modelo y su seguridad no son todavía suficientes para una herramienta interna de infraestructura. Además, la implementación madura de comandos, ACK, RSSI y B5 reside actualmente en `cold-compliance-service`, y el diagnóstico GATT/MQTT está en `mqtt-ui-api`.

La evolución recomendada es incremental y tiene como condición final que `app` sea la **única fuente de verdad** de gateways y dispositivos:

1. endurecer autenticación, autorización y exposición de `app`;
2. introducir `companies` y convertir sus tablas de hardware en el inventario técnico canónico y multiempresa;
3. ofrecer una UI Hardware Manager sobre `app`;
4. migrar gateways y dispositivos de Horneo al inventario central, asignados obligatoriamente a su empresa;
5. reutilizar inicialmente mediante APIs internas la ejecución MQTT/ACK ya probada en Horneo;
6. trasladar esa capacidad a un único módulo de infraestructura en Hardware Manager, sin crear otro servicio;
7. mantener en Horneo presencia, trabajadores, asignaciones, cumplimiento, alertas e incidencias, referenciando IDs centrales;
8. retirar de Horneo las tablas, APIs y pantallas de inventario técnico después de migrar sus relaciones y validar la convivencia.

Los topics actuales son parte del contrato y no deben cambiar:

- publicación de gateway: `gw/{gatewayMac}/publish`;
- comandos hacia gateway: `gw/{gatewayMac}/subscribe`.

## 1. Estado actual

### 1.1 Servicios relevantes

| Servicio Docker | Código | Puerto host | Responsabilidad observada | Base de datos |
|---|---|---:|---|---|
| `app` | `backend/` + `backend/public/` | `127.0.0.1:3000` | Aplicación general HorizonST: inventario BLE, lugares, usuarios, mensajes MQTT y alarmas | `horizonst` |
| `cold_compliance_service` | `cold-compliance-service/` | `127.0.0.1:3100` | Horneo: presencia, cámaras, cumplimiento, trabajadores, alertas, informes y, hoy, gestión técnica BLE | `cold_compliance` |
| `mqtt_ui_api` | `mqtt-ui-api/` | `127.0.0.1:4010` | Estado de VerneMQ, métricas, diagnóstico TLS y laboratorio GATT con correlación de respuesta | Sin base propia |
| `mqtt_ui` | `mqtt-ui/` | `127.0.0.1:8090` | Interfaz de estado MQTT y laboratorio GATT | — |
| `vernemq` | `vernemq/` + imagen VerneMQ | puertos definidos por composición | Broker MQTT y autenticación/ACL en PostgreSQL | tabla `vmq_auth_acl` |
| `postgres` | imagen PostgreSQL | interno | Aloja, al menos, `horizonst` y `cold_compliance` | PostgreSQL |

Existen otros servicios —portal, tienda, correo y utilidades— que no deben incorporarse al dominio del Hardware Manager.

### 1.2 Distribución actual de responsabilidades

La responsabilidad hardware está fragmentada:

- `app` mantiene un inventario genérico y telemetría histórica;
- Horneo mantiene otro inventario de gateways/tags y ejecuta RSSI, B5 y comandos físicos;
- `mqtt_ui_api` implementa otra conexión MQTT y un flujo GATT de diagnóstico;
- VerneMQ es el transporte común;
- cada servicio tiene autenticación propia y modelos de roles incompatibles.

Esto genera tres representaciones parciales del mismo mundo físico y ninguna autoridad técnica única. El estado objetivo corrige expresamente esta situación: `horizonst` será propietario del inventario global, con empresa obligatoria; `cold_compliance` dejará de contener tablas de inventario independientes.

### 1.3 Exposición de red

La composición enlaza los servicios de aplicación a `127.0.0.1`, lo cual es una buena base. El ejemplo Nginx publica `app` bajo `/administracion/` y su API bajo `/api/` en el dominio principal. La configuración histórica de producción también publica `/administracion/` hacia el puerto 3000. Por tanto, no debe asumirse que `app` sea una consola exclusivamente interna aunque el contenedor no publique directamente a interfaces externas.

### 1.4 Fuentes auditadas

La conclusión se basa en `docker-compose.yml`, Dockerfiles, `backend/src`, `backend/public`, `frontend/public`, `db`, `cold-compliance-service/src`, sus migraciones y web, `mqtt-ui-api`, `mqtt-ui` y las configuraciones Nginx versionadas. No se ha inspeccionado ni modificado ningún secreto o `.env`, ni se ha consultado una base desplegada.

## 2. Qué es exactamente `app`

### 2.1 Ejecución y entrega web

`app` construye `backend/` con Node.js 20 y TypeScript, ejecuta `dist/index.js`, escucha por defecto en el puerto 3000 y expone `/health`. El mismo proceso Express sirve los archivos estáticos de `backend/public/` bajo `/administracion`; la raíz redirige a esa ruta.

El frontend no es un SPA compilado. Es una administración HTML/CSS/JavaScript sin framework, incluida en la imagen del backend. Existe además `frontend/public/`, una copia anterior o divergente que **no es la que copia el Dockerfile de `app`**. Esta duplicidad debe resolverse documentalmente antes de ampliar la UI; hoy la fuente efectiva es `backend/public/`.

### 2.2 Rutas UI actuales

La administración efectiva incluye:

- dashboard;
- dispositivos;
- gateways;
- historial de dispositivos;
- mensajes MQTT;
- alarmas;
- categorías;
- usuarios y grupos;

Es una base visual aprovechable para listados y formularios, pero mezcla infraestructura hardware con funciones generales/antiguas. No incluye estado online real, firmware, IP, ejecución de comandos, ACK, configuración B5 ni diagnóstico de conectividad.

### 2.3 API actual

Todas las rutas siguientes cuelgan de `/api`:

| Área | Rutas principales | Evaluación |
|---|---|---|
| Autenticación | `POST /auth/register`, `POST /auth/login` | Requiere endurecimiento urgente |
| Usuarios | `/users`, `/users/groups` | Aprovechable tras adaptar roles y ámbito |
| Gateways | CRUD y `POST /gateways/:id/assign-place` | Base reutilizable, incompleta técnicamente |
| Dispositivos | CRUD, claim, categoría, agrupación e historial | Base reutilizable, incompleta para tipos y asignaciones |
| Lugares | CRUD y fotografías | Puede evolucionar o mapearse a site/installation |
| Categorías | CRUD y fotografías | Útil como clasificación, no sustituye un `device_type` estable |
| Mensajes | `GET /messages` | Útil para diagnóstico de lectura |
| Alarmas | configuración, listado, acknowledge y resolve | Dominio antiguo; no confundir con alertas operativas de Horneo |
| Contacto | envío público | Fuera de alcance |

### 2.4 Persistencia

`app` usa la base `horizonst`. Las tablas relevantes son:

- `gateways` y `gateway_places`;
- `devices` y `device_records`;
- `mqtt_messages`;
- `places`;
- `users`, `user_groups` y `user_group_members`;
- `device_categories`.

También contiene tablas de fotografías y alarmas generales. Estas no deben trasladarse automáticamente al nuevo dominio.

### 2.5 MQTT

El backend se conecta al broker y se suscribe a topics legacy (`devices/MK1`, `MK2`, `MK3`, `MK4`, etc.) y al topic real `gw/+/publish`. Puede persistir mensajes crudos en `mqtt_messages`, según `MQTT_PERSISTENCE_MODE`, con una retención configurada actualmente a 48 horas en la composición.

Los decodificadores legacy alimentan `device_records` y actualizan la última telemetría de dispositivos previamente registrados. El flujo `gw/+/publish` se persiste, pero no existe en `app` un parser general de MKGW3 equivalente al de Horneo. Tampoco hay descubrimiento/provisioning controlado de hardware desconocido: el procesador descarta gateways o dispositivos no registrados/inactivos.

### 2.6 Autenticación y roles

`app` usa JWT Bearer. La UI guarda token y usuario en `localStorage`. Solo existen `ADMIN` y `USER`, con filtros de propietario en varias rutas.

Problemas bloqueantes:

- `POST /api/auth/register` no exige autenticación y acepta `role: ADMIN`; permite autoalta administrativa;
- la configuración admite valores inseguros por defecto para secretos y credenciales, en vez de fallar al arrancar;
- CORS se habilita sin allowlist;
- un token de larga vida en `localStorage` amplía el impacto de XSS;
- los roles no expresan técnico frente a solo lectura;
- el modelo `owner_id = usuario` no representa clientes o instalaciones;
- no hay auditoría uniforme de acciones administrativas.

### 2.7 Decisión A/B/C

**Decisión: B, reutilizable parcialmente.**

No es A porque faltan seguridad, tenancy ligera, estado técnico, catálogo de tipos, command journal y ACK persistente; además hay deuda de frontend y dominios mezclados. No es C porque ya resuelve justamente las piezas horizontales más costosas de volver a crear: servicio independiente de cliente, inventario genérico, API, UI, persistencia de mensajes y telemetría. Crear otra aplicación produciría un tercer backend MQTT y agravaría la duplicación.

## 3. Funcionalidades reutilizables

### 3.1 Inventario detallado

La columna “Destino” expresa la decisión arquitectónica, no una modificación ya realizada.

| Función | Backend/API actual | Frontend actual | Tabla/estado | Destino recomendado |
|---|---|---|---|---|
| Alta/edición/baja de gateway | `app`: `/api/gateways` | `backend/public` | `horizonst.gateways` | Mantener y ampliar en Hardware Manager; sustituir baja física por desactivación/control de dependencias |
| MAC y descripción de gateway | `app` y Horneo | Ambas UIs | `horizonst.gateways` y `cold_compliance.gateways` | Hacer canónico en `app`; eliminar el inventario Horneo tras migrar referencias |
| Asignación lógica de gateway | `app`: `assign-place`; Horneo: cámara/planta | Ambas | `gateway_places`; `gateways.cold_room_id/plant_id` | Empresa/site/installation en Hardware Manager; Horneo conserva solo su relación operativa cámara↔gateway central |
| Online/offline y última conexión | No hay API canónica | No hay UI fiable | Derivable de MQTT, no modelado | Añadir materialización técnica con umbral configurable |
| IP/firmware de gateway | Parcialmente observable en respuestas GATT, no inventariado | Laboratorio GATT | No canónico | Añadir campos observados/capabilities sin exigirlos cuando el protocolo no los entregue |
| RSSI threshold | Horneo: `POST /gateways/:id/apply-rssi` | Inventario Horneo | `cold_compliance.gateways.rssi_threshold`; comando 1042 | Reutilizar API provisionalmente; centralizar configuración deseada/aplicada y ACK después |
| Mensajes MQTT | `app`: `/api/messages` | Administración `app` | `mqtt_messages` | Reutilizar como fuente de consulta, con redacción, filtros y retención explícita |
| Diagnóstico broker | `mqtt_ui_api`: status/metrics/diagnostics | `mqtt_ui` | En memoria/observer | Integrar por API interna; no duplicar cliente/diagnóstico |
| Pruebas GATT | `mqtt_ui_api`: connect/info/status/stream | `mqtt_ui` | Correlación en memoria | Integrar/adaptar con permisos, auditoría y command journal |
| Alta/edición/baja de dispositivo | `app`: `/api/devices`; Horneo: `/tags` | Ambas | `horizonst.devices`; `cold_compliance.tags` | Hacer `devices` canónico; migrar FKs y retirar `cold_compliance.tags` |
| MAC/tag UID | `ble_mac` y `tag_uid` | Ambas | Dos tablas/bases | Normalizar y mapear; no fusionar datos destructivamente |
| Tipo de dispositivo | Categoría/`adv_type` en `app`; modelo en Horneo | Parcial | No hay tipo técnico estable | Añadir catálogo/enum extensible: tag, B5, sensor, beacon, unknown |
| Batería/RSSI/último gateway/visto | Procesador `app` y parser Horneo | Historial parcial | `devices`, `device_records`, eventos Horneo | Centralizar telemetría técnica; Horneo conserva la interpretación operativa |
| Asignación a trabajador | Horneo: `/workers/:id/assign-tag` | Horneo | `worker_tag_assignments` | Mantener la relación en Horneo, usando `hardware_device_id` central y validación de empresa |
| Alarmas de cliente | Horneo | Horneo | `alerts`, `incidents`, reglas | Mantener en Horneo |
| Comandos BLE | Horneo: `/tag-control/*` | Principalmente API/flujo de alarmas | templates, commands, attempts, responses | Reutilizar implementación, trasladar administración técnica tras asegurarla |
| Histórico de comandos y ACK | Horneo tag-control | Limitado | cuatro tablas de comandos | Base reutilizable; convertir en journal técnico único |
| Configuración B5 | Horneo: `POST /gateways/:id/configure-emergency-button` | Botón en inventario Horneo | Resultado no persistido como command journal | Exponer desde Hardware Manager; conservar temporalmente endpoint y adaptador |
| Emergencia manual B5 | Consumidor/parser Horneo | Centro de alertas | `alerts` y `audit_log` | Mantener en Horneo: es una función operativa, no de administración técnica |

### 3.2 Trabajo B5 auditado

La rama contiene el contrato probado para MKGW3 V2.4:

- 1045 envía el objeto de filtros completo y habilita únicamente `bxp_button`;
- 1053 habilita `switch_value` y solo `double_press`;
- 1059 habilita timestamp, advertising y parsing;
- 1063 configura subida en tiempo real con `interval: 0`;
- los cuatro comandos se envían secuencialmente al topic existente;
- cada comando espera ACK y solo `result_code = 0` es éxito;
- la API devuelve éxito global únicamente si los cuatro comandos son aceptados;
- el parser de emergencia exige `msg_id = 3070`, `type = bxp-button`, `frame_type = 1` y `alarm_status = 1`;
- la deduplicación usa `tagUid + triggerCount`, bloqueo transaccional y ventana de 60 segundos;
- `dispatchPhysicalAlarm: false` impide realimentar buzzer/vibración al originar una emergencia manual.

Esta lógica no debe reescribirse desde cero. Debe quedar cubierta por un contrato interno estable y reutilizarse desde Hardware Manager.

### 3.3 Limitaciones del ACK actual

El listener de Horneo correlaciona por `gatewayMac + msgId`, acepta variantes de identificador de respuesta y registra ACK de comandos que existen en `tag_commands`. Sus waiters viven en memoria del proceso.

Para la configuración B5, la API espera el ACK y lo devuelve al cliente, pero los cuatro comandos no se crean previamente en `tag_commands`. En consecuencia, el resultado no queda como histórico técnico persistente. Además:

- un reinicio pierde esperas en curso;
- varias réplicas no compartirían waiters;
- dos operaciones simultáneas con el mismo gateway/msg_id pueden recibir el mismo ACK;
- no hay `correlation_id` del protocolo; la serialización por gateway debe ser explícita;
- RSSI 1042 todavía informa solo “publicado” y no verifica ACK.

El Hardware Manager necesita un command journal persistente y exclusión por gateway, manteniendo la correlación compatible con el firmware.

## 4. Funcionalidades actualmente dentro de Horneo que deberían salir

### 4.1 Mantener en Horneo

- trabajadores y usuarios operativos del cliente;
- asignación de tag a trabajador;
- presencia y estado dentro/fuera;
- cámaras frigoríficas, sesiones y jornadas;
- reglas de cumplimiento;
- alertas, acknowledge, archivo e incidencias;
- informes y exportaciones;
- flujo de emergencia manual B5 y su deduplicación;
- alarmas físicas derivadas de reglas operativas;
- referencias de gateway/dispositivo necesarias para interpretar eventos.

### 4.2 Trasladar al Hardware Manager

- alta, edición, activación y baja controlada de gateways;
- alta y clasificación técnica de tags/B5/dispositivos;
- MAC, modelo, firmware, capabilities y estado técnico;
- RSSI threshold deseado, aplicación remota y verificación;
- configuración MKGW3 y B5;
- comandos manuales LED/buzzer/vibración y plantillas técnicas;
- pruebas GATT y de conectividad;
- mensajes MQTT diagnósticos;
- command journal, intentos, ACK, timeout y errores;
- métricas y alertas técnicas de hardware.

### 4.3 Retirada obligatoria y duplicación únicamente transitoria

La UI Horneo actualmente muestra Inventario solo al `superadministrador`, con CRUD de tags y gateways, edición de RSSI, “Aplicar RSSI” y “Configurar B5”. Debe retirarse como resultado de la migración, aunque no en esta entrega documental ni antes de disponer de la alternativa central. Durante la transición debe:

1. seguir funcionando sin cambios de protocolo;
2. ser marcada como gestión heredada;
3. pasar a consumir exclusivamente las APIs internas del Hardware Manager, acotadas a la empresa Horneo;
4. pasar a solo lectura cuando la nueva UI esté validada;
5. eliminarse con sus endpoints CRUD técnicos una vez migrados datos, relaciones y permisos y aprobado el runbook de reversión;
6. retirar finalmente `cold_compliance.gateways` y `cold_compliance.tags` como inventarios, después de migrar todas sus FKs y dependencias mediante migraciones nuevas.

Una caché técnica en memoria o una caché derivada con TTL para continuidad operativa no constituye una segunda fuente de verdad si es no editable, invalidable y siempre identificada como derivada. No debe existir sincronización bidireccional ni CRUD local.

## 5. Arquitectura recomendada

### 5.1 Arquitectura objetivo

```text
 Usuarios internos HorizonST
 superadmin / técnico / lectura
             |
             v
 +-----------------------------------------------+
 | HorizonST Hardware Manager                    |
 | evolución del servicio app                    |
 |                                               |
 | UI + API de inventario + estado + comandos    |
 | autenticación/RBAC + auditoría                |
 +-----------+------------------+----------------+
             |                  |
             |                  +-------> API de diagnóstico existente
             |                            (mqtt_ui_api, integración transitoria)
             |
             +------ command bus / ACK único ------+
             |                                      |
             v                                      v
       PostgreSQL horizonst                      VerneMQ
       inventario canónico                  gw/{mac}/subscribe
       companies/scopes                     gw/{mac}/publish
       telemetría técnica
             |
             | API/eventos internos company-scoped
             v
 +-----------------------------------------------+
 | Aplicaciones cliente                          |
 | Horneo y futuras aplicaciones                 |
 | referencias a hardware_id, presencia,         |
 | asignaciones, reglas y alertas                |
 +-----------------------------------------------+
```

### 5.2 Límites de dominio

**Hardware Manager es el único propietario de:** empresas, identidad física, pertenencia de gateway/dispositivo a empresa, configuración deseada/aplicada, estado observado, diagnóstico, comandos técnicos y auditoría técnica.

**Horneo es propietario de:** trabajadores, asignación laboral, cámaras, presencia, cumplimiento, incidentes y alertas operativas. Sus relaciones guardan el ID central del dispositivo/gateway, no una copia editable de su inventario. Resuelve identidad, estado y pertenencia mediante API/eventos del Hardware Manager.

**VerneMQ es transporte, no base de verdad.** La recepción de un publish no equivale a configuración aceptada.

### 5.3 Estrategia de reutilización sin tercer backend

Durante la migración, `app` incorpora la UI y orquesta temporalmente APIs existentes:

- inventario y mensajes: API propia de `backend`;
- B5, RSSI y comandos: API interna autenticada de `cold-compliance-service`, solo hasta trasladar el ejecutor;
- diagnóstico/GATT: API interna de `mqtt_ui_api`.

Después, el código común de publicación, normalización de ACK y command journal debe trasladarse a **un único módulo de infraestructura dentro de `app`**, pudiendo compartir librerías puras pero siendo Hardware Manager el único proceso que publica comandos técnicos y correlaciona ACK. Horneo solicita acciones de negocio de alto nivel cuando las necesite; no administra ni construye comandos MKGW3.

También se recomienda que Hardware Manager sea el consumidor global de los topics de gateway y emita hacia Horneo un flujo interno normalizado y acotado a la empresa. Así Horneo continúa procesando presencia, heartbeats, RSSI operativo y alarmas sin poder observar hardware de otras empresas. Como transición, Horneo puede suscribirse a la lista exacta de gateways obtenida dinámicamente de la API central y validarla de nuevo por empresa; nunca debe usar una lista hardcodeada ni conservar indefinidamente `gw/+/publish` con acceso global.

### 5.4 Reglas de integración

- mantener exactamente los topics actuales;
- derivar siempre `company_id` de la identidad autenticada o del hardware resuelto, nunca de un valor confiado al frontend;
- normalizar MAC en entrada y usar un formato canónico para comparación;
- una sola suscripción responsable de correlacionar ACK;
- una cola/lock por gateway para comandos sin correlación única;
- persistir intención antes de publicar y resultado después del ACK;
- distinguir `queued`, `published`, `ack_success`, `ack_error`, `timeout`, `cancelled`;
- no marcar “configurado” con solo publicar;
- conservar payload solicitado, payload publicado y respuesta, con redacción de secretos;
- idempotencia para operaciones repetibles y auditoría de actor/motivo.

## 6. Modelo de datos y propiedad multiempresa

### 6.1 Fuente de verdad propuesta

Las tablas `horizonst.gateways`, `horizonst.devices`, `horizonst.device_records` y `horizonst.mqtt_messages` son la mejor base para la autoridad técnica. Deben quedar bajo `companies` y ser la única fuente de verdad. Las tablas homónimas de `cold_compliance` permanecen solo el tiempo imprescindible para migrar sus FKs actuales; no son parte de la arquitectura final.

No debe crearse una FK entre bases. Inicialmente, la identidad se reconcilia por MAC normalizada. A continuación, Horneo sustituye sus FKs a `tags`/`gateways` por identificadores opacos centrales (`hardware_device_id`, `hardware_gateway_id`) validados mediante API. Esos IDs en sesiones, alertas, incidentes o asignaciones son referencias operativas, no un inventario duplicado.

El análisis de dependencias muestra que `cold_compliance.tags` está referenciada por asignaciones, sesiones, alertas, incidentes, comandos, sesiones BLE y estados de presencia. `cold_compliance.gateways` está vinculada a cámaras/planta y comandos. Por ello no se pueden borrar directamente: cada relación necesita columna central paralela, backfill verificado, dual-read temporal, cambio de constraints y retirada posterior en una migración nueva.

### 6.2 Cambios aditivos candidatos

Son propuestas para fases posteriores, no tablas/endpoints existentes ni instrucciones de migración inmediata:

| Concepto | Cambio mínimo | Motivo |
|---|---|---|
| `companies` | id UUID, code/nombre, estado, timestamps | Propietario obligatorio y frontera de aislamiento |
| `company_user_memberships` | company_id, user_id, rol/scope | Acceso multiempresa verificable en backend |
| `sites` | company_id, nombre, zona horaria | Ubicación administrativa estable |
| `installations` | company_id/site_id, nombre/tipo | Agrupa una solución desplegada; Horneo puede mapear su planta |
| Gateway técnico | company_id NOT NULL, installation_id, model, firmware observado, IP observada, last_seen_at, status, capabilities JSON | Propiedad y estado sin asumir disponibilidad de todos los campos |
| Device técnico | company_id NOT NULL, device_uid/ble_mac, device_type, model, firmware, status, capabilities JSON | Propiedad e inventario genérico más allá de tags |
| Observaciones por gateway | device_id, gateway_id, last_seen_at, last_rssi, battery, payload resumen | Un dispositivo puede verse desde varios gateways |
| Configuración | resource, desired_config JSON, applied_config JSON, version, timestamps | Distingue intención de confirmación |
| Command journal | gateway/device, msg_id, payload, state, actor, published/ack timestamps, result_code/msg, timeout, duration | Trazabilidad y ACK persistente |
| Auditoría | actor, rol, ámbito, acción, entidad, before/after, request id, timestamp | Responsabilidad técnica |
| Referencias Horneo | hardware_device_id/hardware_gateway_id en relaciones operativas | Sustituir FKs al inventario local sin copiar hardware |

Antes de elegir nombres definitivos hay que revisar volumen, retención, índices por `(gateway_id, created_at)`, unicidad de MAC normalizada, concurrencia, FKs y política `ON DELETE`. Todas las modificaciones serán migraciones nuevas; no se editarán migraciones antiguas.

### 6.3 Multicliente pragmático

Jerarquía recomendada:

```text
company
  └─ site
      └─ installation
          ├─ gateway
          └─ device (directo o mediante asignación)

Horneo plant/cold_room
  └─ referencia o mapping a installation/gateway
```

No se necesita todavía aislamiento físico por base o esquema. Sí se necesita desde el principio:

- `company_id` obligatorio en gateways y devices y derivable en toda consulta autorizada;
- scopes de usuario por company/site/installation;
- índices y constraints que eviten asociaciones cruzadas;
- servicios que no acepten un `company_id` del cliente sin verificarlo;
- identificadores opacos en nuevas entidades;
- una empresa “Horneo” y, si hace falta, una empresa “HorizonST interna/legacy” para importar lo existente sin bloquear la evolución.

`company` es la frontera obligatoria de aislamiento. `plant` sigue siendo un concepto de Horneo y no debe convertirse automáticamente en el tenant global; una planta es una ubicación/operación de una empresa y puede mapearse a `site` o `installation`.

Para usuarios del Hardware Manager, la empresa autorizada se obtiene de `company_user_memberships`. Para `cold-compliance-service`, una identidad de servicio se vincula en servidor a la empresa Horneo; el frontend no envía un ámbito confiable. Un superadmin puede seleccionar empresa, pero el backend comprueba su membership/capability en cada acceso.

## 7. APIs

### 7.1 APIs existentes a reutilizar

**En `app`:**

- `/api/gateways`: listado, alta, edición, baja y asignación a lugar;
- `/api/devices`: listado, alta, claim, edición, baja, categoría e historial;
- `/api/messages`: mensajes MQTT persistidos;
- `/api/users` y grupos: base administrativa, tras corregir identidad y RBAC;
- `/api/places`: base de ubicación, pendiente de decidir su migración a site/installation.

**En Horneo, existentes y solo transitorias para administración técnica:**

- `/gateways`: inventario Horneo que debe retirarse;
- `POST /gateways/:id/apply-rssi`: publicación 1042, hoy sin ACK verificado;
- `POST /gateways/:id/configure-emergency-button`: 1045/1053/1059/1063 con ACK individual;
- `/tags`: inventario técnico que debe retirarse, conservando las asignaciones mediante IDs centrales;
- `/tag-control/led`, `/buzzer`, `/vibration`, `/custom`;
- `/tag-control/commands`, `/commands/active`, `/commands/:id`;
- `/tag-control/templates`.

**En `mqtt_ui_api`:**

- `/api/status`, `/api/metrics`, `/api/diagnostics`;
- `/api/gatt/connect`, `/inquire-device-info`, `/inquire-status`;
- stream SSE mediante ticket temporal.

### 7.2 Brechas de seguridad previas a reutilización

Las rutas `/tag-control/*` se montan sin `requireAuth` ni `requireRoles`. Esto afecta tanto a comandos físicos como a lectura/edición de templates e histórico. Es un bloqueante: antes de conectarlas a otra UI deben autenticarse, autorizarse y auditar actor/ámbito. No basta con ocultar botones en el frontend.

La API interna entre servicios necesita credenciales de servicio con alcance mínimo, rotación y trazabilidad. No debe reutilizar el token de un superadministrador ni exponerse directamente a Internet.

### 7.3 Contratos que faltan

Los siguientes nombres son **contratos propuestos**, no endpoints existentes. Deben confirmarse al implementar para evitar duplicar lógica:

- resumen técnico de dashboard;
- detalle técnico agregado de gateway, estado y dispositivos vistos;
- detalle de dispositivo y observaciones por gateway;
- prueba de comunicación con resultado persistido;
- aplicar configuración/RSSI mediante command journal;
- configurar B5 y consultar cada comando/ACK;
- listado/filtros de comandos y mensajes;
- estado de configuración deseada frente a aplicada;
- CRUD de companies y asignación company/site/installation;
- resolución interna de gateway/device por ID o MAC bajo el scope de la empresa autenticada;
- feed/eventos técnicos acotados por empresa para aplicaciones cliente;
- lectura de asignación operativa proveniente de Horneo.

Se recomienda agruparlos bajo una versión explícita, por ejemplo `/api/hardware/v1`, **solo cuando se implemente el contrato**. Internamente, los adapters llamarán a las APIs existentes hasta completar la centralización. No se deben añadir endpoints paralelos que publiquen directamente a MQTT.

Toda ruta de listado, detalle, histórico, comando o asignación debe aplicar el predicado de empresa en SQL o en la capa de repositorio antes de devolver datos. Consultar por ID y comprobar después no es suficiente si el primer resultado puede filtrar existencia. Para servicios, el token incluye un `company_id` no sobreescribible; para humanos, el scope se calcula desde memberships. Los comandos vuelven a resolver que gateway y dispositivo pertenecen a la misma empresa justo antes de publicar.

### 7.4 Forma mínima de respuesta de comando

Toda operación de comando debe exponer, como mínimo:

- id persistente del comando/operación;
- gateway y dispositivo, si aplica;
- `msg_id` y payload efectivo;
- estado de publicación;
- ACK recibido o no;
- `result_code` y `result_msg`;
- timestamps de creación, publicación y ACK;
- duración y timeout;
- actor y motivo;
- resultado agregado derivado, nunca independiente de los pasos.

Para B5, el agregado es éxito solo si 1045, 1053, 1059 y 1063 terminan en `ack_success` con `result_code = 0`.

## 8. UI propuesta

### 8.1 Navegación

```text
Dashboard
Gateways
  └─ Detalle / dispositivos / mensajes / comandos / configuración
Dispositivos
  └─ Detalle / observaciones / comandos / asignación
Configuración B5
Comandos
Diagnóstico MQTT
Clientes e instalaciones        (solo roles autorizados)
Usuarios y auditoría            (solo superadmin)
```

### 8.2 Dashboard

Debe mostrar gateways totales/online/offline, dispositivos conocidos y vistos recientemente, batería baja, errores/timeout de comandos, alertas técnicas y actividad MQTT reciente. Cada métrica debe indicar ventana temporal y enlazar al listado filtrado. “Online” debe derivarse de `last_seen_at` y una política visible, no de `active`.

### 8.3 Gateways

Listado: empresa, MAC, descripción, instalación, estado, última comunicación, IP/firmware si se observan, RSSI configurado, número de dispositivos recientes y errores. El selector de empresa solo muestra scopes autorizados; no es un filtro de seguridad por sí mismo.

Detalle: identidad/capabilities; configuración deseada/aplicada; dispositivos vistos; mensajes; comandos/ACK; botón de prueba; RSSI; configuración B5. Las acciones destructivas requieren confirmación, dependencias visibles y desactivación preferente.

### 8.4 Dispositivos

Listado genérico con empresa, UID/MAC, tipo (`tag`, `b5`, `sensor`, `beacon`, `unknown`), descripción, batería, RSSI, último gateway, última detección, estado, instalación y asignación operativa si existe.

Detalle: información técnica, historial, gateways que lo detectan, RSSI por gateway, batería, comandos permitidos por capability, resultados/ACK y errores. La UI no debe ofrecer comandos incompatibles con el modelo/capabilities.

### 8.5 Configuración B5

La pantalla selecciona gateway objetivo, muestra firmware/capability conocida y presenta los cuatro pasos. Para cada uno debe distinguir:

```text
1045  publicado  -> ACK result_code=0 -> aceptado
1053  publicado  -> ACK result_code=4 -> rechazado: no object error
1059  timeout    -> sin confirmación
1063  pendiente
```

Debe mostrar el payload exacto con datos sensibles redactados, bloquear ejecuciones concurrentes sobre el mismo gateway y permitir reintentar de forma controlada. “B5 configurado correctamente” aparece solo con cuatro ACK exitosos. No se debe convertir un HTTP 202 o publish MQTT en éxito.

### 8.6 Diagnóstico MQTT

No hace falta administrar el broker. La pantalla debe filtrar mensajes por fecha, topic, gateway, tipo y `msg_id`; mostrar timestamp, payload, resultado y parseo; y limitar tamaño/retención. Debe reutilizar `mqtt_messages` y las métricas/diagnósticos existentes.

El payload crudo puede contener información operativa o identificadores: acceso de lectura restringido, redacción, paginación, límites y registro de consulta/exportación.

### 8.7 Comandos

Listado con gateway, dispositivo, `msg_id`, estado, actor, fechas, ACK, código/mensaje, duración, timeout y error. El detalle incluye intentos y payloads. Los filtros de errores y timeouts deben alimentar dashboard y soporte.

## 9. Seguridad

### 9.1 Roles propuestos

| Rol | Lectura | Configuración/comandos | Administración |
|---|---|---|---|
| `hardware_readonly` | Inventario, estado, comandos y mensajes dentro de su ámbito | No | No |
| `hardware_technician` | Sí | Pruebas, RSSI, B5 y comandos permitidos en su ámbito | No puede crear tenants, usuarios ni borrar hardware |
| `hardware_superadmin` | Global | Global | Usuarios, empresas, ámbitos, altas/bajas y políticas |

Para acciones de alto impacto se puede exigir además una capability concreta (`gateway.configure`, `device.command`, `mqtt.payload.read`) sin multiplicar roles.

### 9.2 Medidas prioritarias

1. cerrar o eliminar el registro público y prohibir autoasignación de rol;
2. proteger todas las rutas tag-control con autenticación y RBAC;
3. eliminar defaults inseguros y fallar al arrancar si faltan secretos;
4. restringir CORS y aplicar Helmet/CSP;
5. preferir sesión segura en cookie `HttpOnly`, `Secure`, `SameSite` con CSRF, o tokens cortos y rotación si se mantiene Bearer;
6. no aceptar tokens por query salvo tickets específicos, de un solo uso y vida corta;
7. aislar la consola en hostname interno, VPN/SSO o allowlist de red, además de autenticación de aplicación;
8. credenciales MQTT por servicio con ACL mínima: leer `gw/+/publish` y escribir solo los topics necesarios;
9. rate limit, lock por gateway y confirmación para comandos físicos;
10. auditoría inmutable de login, cambios, comandos, payload, resultado y ámbito;
11. evitar enumeración/IDOR: validar pertenencia en cada consulta y preferir 404 cuando corresponda;
12. redacción de contraseñas BLE, tokens y credenciales en logs/payloads.

### 9.3 Riesgos concretos encontrados

- autoalta como `ADMIN` en `app`;
- endpoints físicos de `/tag-control` sin autorización;
- `app` públicamente alcanzable a través de Nginx según configuración versionada;
- almacenamiento de JWT de `app` en `localStorage`;
- tres mecanismos de autenticación no federados;
- secretos con fallback inseguro;
- diagnóstico TLS de `mqtt_ui_api` conecta sin validar certificado para la comprobación;
- autorización por propietario de usuario, insuficiente para ámbitos multiempresa.

Estos hallazgos deben resolverse antes de declarar la nueva consola apta para producción.

## 10. Plan de migración

### Preparación — Contratos, seguridad y observabilidad

- documentar identidad MAC y topics como contratos;
- cerrar registro administrativo y proteger tag-control;
- definir RBAC, company scopes y acceso interno;
- añadir request/correlation IDs y auditoría;
- inventariar todas las FKs/consultas de Horneo que dependen de `tags` y `gateways`;
- fijar métricas de no regresión para presencia, alarmas, ACK y latencia MQTT.

Criterio de salida: no hay rutas técnicas mutables sin autenticación/autorización y existe una matriz aprobada de ownership y migración.

### Fase A — Hardware Manager y empresas

- evolucionar `app` a Hardware Manager sin reescritura masiva;
- declarar `backend/public` como fuente UI y separar la navegación hardware de alarmas legacy;
- crear `companies` y memberships mediante migraciones aditivas;
- añadir `company_id` inicialmente nullable a gateways/devices para permitir backfill, y hacerlo obligatorio solo tras validar que no quedan huérfanos;
- añadir roles, APIs company-scoped, estado técnico y auditoría;
- implementar command journal y mover la ejecución MQTT/ACK al Hardware Manager;
- desplegar únicamente con autorización y detrás de acceso interno.

### Fase B — Gateways de Horneo

- crear la empresa Horneo y sus site/installation necesarios;
- exportar gateways locales, normalizar MAC y detectar duplicados/conflictos;
- insertar o vincular cada gateway en `horizonst.gateways` con `company_id = Horneo` de forma idempotente;
- añadir `hardware_gateway_id` a relaciones operativas de cámara/planta y backfill;
- comparar conteos, MAC, RSSI y asociaciones; ningún gateway puede quedar sin empresa;
- cambiar RSSI, B5, pruebas y configuración para ejecutarse exclusivamente en Hardware Manager.

### Fase C — Tags y dispositivos de Horneo

- añadir catálogo genérico de tipos/capabilities;
- exportar tags, normalizar UID/MAC y reconciliar con `horizonst.devices`;
- asignar obligatoriamente cada dispositivo a la empresa Horneo;
- añadir columnas `hardware_device_id` paralelas en asignaciones, sesiones, alertas, incidentes, comandos, sesiones BLE y estado de presencia;
- backfill idempotente y comprobaciones uno-a-uno, duplicados y huérfanos;
- mantener durante el dual-read el ID local solo como puente de migración.

### Fase D — Horneo consume exclusivamente hardware central

- identidad de servicio Horneo ligada en backend a `company_id = Horneo`;
- resolver gateways/dispositivos mediante API central o eventos company-scoped;
- reemplazar joins a inventario local por referencias centrales y datos obtenidos del Hardware Manager;
- mantener `worker ↔ hardware_device_id` como relación operativa local;
- mover la ingestión MQTT global al Hardware Manager y entregar a Horneo eventos normalizados de su empresa; como paso transitorio, usar suscripciones exactas derivadas de la API central;
- probar aislamiento negativo con IDs, MAC y comandos de otra empresa;
- impedir toda escritura técnica desde Horneo.

### Fase E — Eliminar administración e inventario técnico de Horneo

- retirar de la UI alta/baja/edición de gateways y tags, RSSI, B5, firmware y diagnósticos;
- retirar APIs `/gateways` y `/tags` de CRUD técnico y los endpoints técnicos de configuración;
- mantener solo endpoints operativos de asignación trabajador-dispositivo, que validan empresa en Hardware Manager;
- retirar el ejecutor MQTT/ACK local una vez no existan consumidores;
- mediante migraciones nuevas, eliminar FKs y finalmente las tablas locales `tags` y `gateways` solo cuando las comprobaciones demuestren cero dependencia;
- conservar referencias centrales e históricos operativos.

### Fase F — Verificación funcional y cierre

- validar con MKGW3 V2.4 y B5 reales los comandos 1045/1053/1059/1063 y sus ACK;
- verificar presencia, heartbeats, RSSI, sesiones, alarmas, incidencias e informes;
- verificar emergencia B5, deduplicación y `dispatchPhysicalAlarm: false`;
- comparar conteos y comprobar que todo hardware de Horneo tiene empresa;
- demostrar que Horneo no puede listar, usar ni comandar hardware de otra empresa;
- ejecutar rollback ensayado, observación prolongada y cierre del dual-read.

No se debe saltar directamente a la fase E ni borrar tablas para “limpiar” duplicados. La separación se considera terminada solo cuando se cumplen simultáneamente estas condiciones:

1. todos los gateways de Horneo están en Hardware Manager;
2. todos sus dispositivos están en Hardware Manager;
3. todos tienen `company_id = Horneo` y no quedan huérfanos;
4. Horneo solo ve y utiliza hardware de esa empresa;
5. Horneo ya no ofrece administración técnica;
6. presencia, heartbeats, RSSI operativo, trabajadores, sesiones, alarmas, B5 e informes siguen funcionando;
7. `cold_compliance` no conserva un segundo inventario técnico independiente.

## 11. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Dos autoridades de gateway/tag durante transición | Configuración sobre equipo equivocado o datos divergentes | MAC canónica, mapping explícito, reconciliación y métricas de drift |
| Doble suscripción/ejecución de comandos | ACK entregado a consumidor incorrecto o comando duplicado | Un ejecutor responsable, lock por gateway, command journal |
| Waiters ACK en memoria | Pérdida en reinicio/escalado | Estado persistente, consumidor único y recuperación de timeout |
| Confundir publish con éxito | UI informa configuración falsa | Estados separados; éxito solo por ACK 0 |
| Regresión de B5 | No se detecta emergencia o se generan falsas alarmas | Tests de frame/alarm/trigger, hardware staging, mantener topics/payloads |
| Regresión de presencia | Sesiones o alarmas incorrectas | Horneo conserva parser/estado; replay de payloads y pruebas de regresión |
| Realimentación de alarma manual | Buzzer/vibración involuntarios | Mantener `dispatchPhysicalAlarm: false` y test contractual |
| Cambio de RSSI afecta detección | Dispositivos dejan de verse | Mostrar deseado/aplicado, ACK, rollback lógico y ventana de observación |
| Borrado de inventario con histórico | Pérdida/violación de FKs | Desactivación, checks de dependencias y migraciones aditivas |
| Exposición de comandos sin auth | Acciones físicas no autorizadas | Bloquear tag-control antes de integración y segmentar red |
| Datos MQTT sensibles | Exposición de payloads/identificadores | RBAC específico, redacción, retención y auditoría |
| Modelo multiempresa insuficiente | IDOR y rediseño con segundo cliente | company obligatoria, memberships y scope backend desde fase A |
| Cache/resolución central no disponible | Horneo no puede asociar un evento nuevo | Caché de solo lectura con TTL, circuit breaker, métricas y fail closed para hardware desconocido |
| MQTT wildcard entre empresas | Horneo observa datos ajenos | Ingestión global central y feed company-scoped; transición con topics exactos generados y ACL |
| Frontends duplicados | Se edita una UI que no se despliega | Declarar `backend/public` canónico y retirar duplicado con entrega separada |
| Dependencia interna de Horneo prolongada | Acoplamiento técnico | Adapter con contrato/versionado y fecha de extracción, no llamadas ad hoc |
| Firmware/capabilities heterogéneos | Comandos incompatibles | Descubrimiento de capacidades, allowlist por modelo/versión y confirmación |

### Validación necesaria antes de producción

- typecheck/build/tests de `backend`, Horneo y `mqtt_ui_api`;
- pruebas de autorización negativas para cada rol y ámbito;
- replay de MQTT real anonimizado;
- staging con MKGW3/B5 real para ACK 0/error/timeout;
- prueba de concurrencia de comandos al mismo gateway;
- reinicio durante una espera de ACK;
- regresión de presencia, incidentes y emergencia manual;
- prueba de rollback de cada fase y reconciliación de inventario;
- revisión de Nginx, TLS, ACL MQTT y secretos en el entorno objetivo.

## 12. Recomendación final sobre `app`

**Reutilizar y refactorizar `app`; no sustituirlo y no usarlo sin cambios.**

Es el único componente actual cuyo propósito ya es horizontal y cuya combinación de inventario, UI, API, telemetría y mensajes encaja con una consola central. La inversión debe dirigirse a convertir esa base en un producto técnico coherente, no a levantar otro backend.

La frontera recomendada es:

- `app` evoluciona a HorizonST Hardware Manager y **única autoridad** de empresas, inventario y configuración;
- Horneo conserva el dominio operativo, guarda referencias centrales y consume únicamente hardware de su empresa;
- MQTT/ACK/comandos técnicos se consolidan en Hardware Manager; Horneo solicita solo acciones operativas autorizadas;
- `mqtt_ui_api` aporta temporalmente diagnóstico/GATT mediante adapter y después se integra o reduce según uso real;
- las pantallas técnicas de Horneo se mantienen durante el dual-run y después se eliminan junto con sus CRUD e inventarios locales.

Los primeros cambios de implementación deben ser de seguridad y contrato, no de UI: cerrar el registro de administradores, proteger tag-control, definir scopes y hacer persistentes los comandos/ACK. Solo entonces debe exponerse el nuevo Hardware Manager a usuarios internos.

## Anexo A — Matriz de propiedad objetivo

| Entidad/capacidad | Propietario objetivo | Consumidores |
|---|---|---|
| Gateway físico e identidad | Hardware Manager | Horneo, futuras apps |
| Dispositivo físico/capabilities | Hardware Manager | Horneo, futuras apps |
| Empresa propietaria y scopes | Hardware Manager | Todas las aplicaciones autorizadas |
| Telemetría técnica | Hardware Manager | Soporte y aplicaciones autorizadas |
| Configuración y comandos | Hardware Manager | Horneo mediante API |
| ACK e histórico técnico | Hardware Manager | Soporte, Horneo |
| Trabajador y asignación laboral | Horneo | Hardware Manager solo lectura referencial |
| Presencia/cumplimiento | Horneo | UI e informes Horneo |
| Emergencia manual/alerta | Horneo | Operación Horneo; diagnóstico técnico referencial |
| Broker y ACL MQTT | Infraestructura HorizonST | Servicios autorizados |

## Anexo B — Deuda técnica priorizada

### P0 — Bloqueante

- registro público con elevación a administrador en `app`;
- tag-control sin autenticación/RBAC;
- defaults inseguros de secretos;
- ausencia de ámbito multicliente en autorización.

### P1 — Antes de centralizar comandos

- persistencia y correlación robusta de ACK;
- serialización por gateway;
- ACK para RSSI 1042;
- command journal también para configuración B5;
- credenciales de servicio y auditoría técnica.

### P2 — Evolución funcional

- estado online/firmware/IP/capabilities;
- tipo genérico de dispositivo;
- observaciones por gateway;
- consolidación de UI duplicada;
- retirada gradual de dominios legacy de la navegación Hardware Manager.
