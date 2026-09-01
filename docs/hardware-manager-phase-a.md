# HorizonST Hardware Manager — Fase A

Fecha: 1 de septiembre de 2026

Rama: `codex/manual-emergency-b5`

Estado: implementación preparada y validada localmente; no desplegada y sin migraciones ejecutadas contra entornos desplegados.

## 1. Arquitectura implementada

El servicio Docker `app`, construido desde `backend/`, conserva su estructura Express y su frontend efectivo en `backend/public/`. Esta fase añade la base de seguridad y multiempresa sin crear otro backend ni mover todavía el procesamiento MQTT/ACK desde Horneo.

```text
Usuario interno
  │ JWT + rol técnico
  v
app / Hardware Manager (Fase A)
  ├─ companies + memberships
  ├─ gateways y devices company-scoped
  ├─ mensajes e historial company-scoped
  ├─ auditoría técnica
  └─ inventario legacy NULL visible solo a superadmin

cold-compliance-service / Horneo
  ├─ inventario local todavía intacto
  ├─ presencia, sesiones, alertas e informes intactos
  └─ tag-control HTTP autenticado y autorizado

VerneMQ
  ├─ gw/{gatewayMac}/publish
  └─ gw/{gatewayMac}/subscribe
```

La fuente de verdad final sigue siendo Hardware Manager. En Fase A no se han migrado todavía gateways/tags de Horneo ni modificado sus FKs.

## 2. Migración nueva

Se añade `backend/migrations/001_hardware_manager_phase_a.sql`. El arranque de `app` ejecuta migraciones SQL versionadas después de sus ajustes legacy existentes. La tabla `app_schema_migrations` registra nombre, SHA-256 y fecha de aplicación; una modificación posterior de un fichero ya aplicado provoca fallo de arranque.

El Dockerfile copia `backend/migrations/` tanto a la fase de build como a runtime. Puede sobrescribirse la ubicación con `APP_MIGRATIONS_DIR` para herramientas o despliegues no estándar.

La migración es aditiva:

- no borra datos;
- no modifica migraciones antiguas;
- no hace `company_id` obligatorio todavía;
- añade índices por empresa;
- amplía el constraint de roles conservando `ADMIN` y `USER`;
- usa transacción por fichero.

No se ha ejecutado esta migración contra staging ni producción.

## 3. Modelo `companies`

`companies` incluye:

| Campo | Tipo/regla |
|---|---|
| `id` | UUID, PK, generado por PostgreSQL |
| `code` | hasta 64 caracteres, minúsculas, único, patrón alfanumérico/`_`/`-` |
| `name` | texto obligatorio |
| `active` | booleano, activo por defecto |
| `created_at` | timestamptz |
| `updated_at` | timestamptz |

No existe DELETE de empresa. La retirada se hace con `active = false`. Las FKs de hardware y memberships usan `ON DELETE RESTRICT`.

## 4. Memberships

`company_user_memberships` relaciona usuario y empresa:

- PK compuesta `(user_id, company_id)` evita duplicados;
- FK de usuario con `ON DELETE CASCADE`;
- FK de empresa con `ON DELETE RESTRICT`;
- rol de membership limitado a `hardware_readonly` o `hardware_technician`;
- un membership no puede elevar a técnico a un usuario cuyo rol máximo es readonly;
- las empresas inactivas dejan de formar parte del scope efectivo.

El `company_id` nunca se toma como autorización desde el frontend. El backend obtiene las empresas permitidas desde la identidad JWT y sus memberships. Los superadministradores globales pueden operar sobre todas.

## 5. RBAC

| Rol | Lectura company-scoped | Edición técnica acotada | Empresas/usuarios/hardware |
|---|---:|---:|---:|
| `hardware_readonly` | Sí | No | No |
| `hardware_technician` | Sí | Sí, únicamente en memberships con rol técnico | No altas/bajas ni cambio de empresa |
| `hardware_superadmin` | Global | Global | Sí |
| `ADMIN` | Global | Global | Alias superadmin legado |
| `USER` | Solo recursos legacy propios con `company_id IS NULL` | Compatibilidad legacy propia | No |

`ADMIN` se conserva como alias global para no invalidar usuarios y JWT existentes. Las nuevas altas deben usar los roles `hardware_*`.

Un técnico puede editar nombre, descripción y relaciones operativas permitidas. No puede crear/desactivar hardware, cambiar empresa/propietario/tipo/estado administrativo ni administrar usuarios. Readonly no puede mutar recursos.

## 6. Cambios de seguridad

### Registro y usuarios

- `POST /api/auth/register` devuelve 403 y no crea usuarios;
- las altas se realizan mediante `/api/users` por superadmin autenticado;
- JWT admite los tres nuevos roles;
- un usuario normal no puede crear ni autoasignarse un rol administrativo;
- se conserva la protección del último superadministrador global.

### Secretos

Se eliminaron defaults inseguros del código para:

- `JWT_SECRET`;
- `DB_PASSWORD`;
- `EMQX_MGMT_PASSWORD` cuando se usa persistencia EMQX;
- `MAIL_PASSWORD` cuando el correo está habilitado;
- `RFID_ACCESS_API_TOKEN` cuando RFID está habilitado.

La configuración falla al cargar si falta un secreto obligatorio. Ningún secreto real fue añadido a código, documentación o tests.

### CORS y headers

- CORS usa `CORS_ALLOWED_ORIGINS` como allowlist;
- sin allowlist, las llamadas sin `Origin` y el uso same-origin siguen funcionando, pero no se emiten permisos CORS a orígenes externos;
- se añaden CSP compatible con la UI actual, `nosniff`, denegación de frames, referrer policy, COOP y permissions policy;
- cada respuesta recibe `X-Request-Id`; se conserva un valor entrante solo si cumple un patrón seguro.

### Horneo `tag-control`

Todas las rutas `/tag-control/*` requieren sesión Horneo válida. Lecturas de histórico, activos y templates requieren autenticación. LED, buzzer, vibración, custom commands y cambios de templates requieren `superadministrador`.

Las llamadas internas continúan invocando servicios directamente. No atraviesan el router y no se ha modificado la ejecución automática de alarmas, ACK o BLE.

RSSI y configuración B5 ya estaban protegidos por autenticación y `superadministrador` en `/gateways` y permanecen así.

## 7. Inventario central preparado

### Gateways

`horizonst.gateways` recibe `company_id UUID NULL` con FK e índice `(company_id, active, id)`.

Las APIs incluyen empresa en listados/detalle, admiten asignación por superadmin y aplican scope dentro del SQL. DELETE pasa a desactivación lógica para evitar pérdida de históricos.

### Devices

`horizonst.devices` recibe:

- `company_id UUID NULL`;
- `device_type`: `tag`, `b5`, `sensor`, `beacon` o `unknown`;
- `status`: `active`, `inactive`, `maintenance`, `retired` o `unknown`.

`updated_at` ya existía y se reutiliza. Los valores iniciales son `unknown` y `active`; no se intenta inferir tipos sin evidencia.

DELETE pasa a desactivación lógica (`active = false`, `status = inactive`). El claim legacy solo opera sobre dispositivos sin empresa.

### Observaciones

El procesador MQTT sigue aceptando registros legacy. Si gateway y dispositivo ya tienen empresa y son distintas, descarta la observación para impedir contaminación cruzada. Si uno o ambos siguen sin empresa, mantiene el comportamiento transitorio para no romper el backfill gradual.

## 8. Aislamiento multiempresa

Las consultas de gateway/device combinan identificador y scope en el mismo SQL. Una respuesta 404 no revela si un recurso de otra empresa existe.

Se aplica a:

- listado y detalle de gateways;
- resolución de gateway por MAC;
- edición y asignación de lugar;
- listado, agrupación y detalle de devices;
- resolución de device por MAC;
- edición, categoría e historial de device;
- mensajes MQTT asociados a gateways conocidos.

Reglas:

- global superadmin: todas las empresas y recursos legacy sin asignar;
- membership: solo `company_id = ANY(empresas autorizadas)`;
- usuario legacy: solo `company_id IS NULL AND owner_id = usuario`;
- hardware sin empresa no es visible para técnico/readonly;
- cambio de `company_id` reservado a superadmin;
- company enviada en body se valida como dato y pertenencia objetivo, nunca como prueba de autorización.

Los mensajes sin gateway resoluble son visibles únicamente para superadmin global.

## 9. Endpoints nuevos y modificados

### Empresas

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/companies` | rol técnico; resultado acotado |
| POST | `/api/companies` | superadmin |
| GET | `/api/companies/:id` | rol técnico dentro de scope |
| PATCH | `/api/companies/:id` | superadmin |
| GET | `/api/companies/:id/memberships` | superadmin |
| PUT | `/api/companies/:id/memberships/:userId` | superadmin |
| DELETE | `/api/companies/:id/memberships/:userId` | superadmin |

### Hardware existente ampliado

| Método | Ruta | Cambio |
|---|---|---|
| GET | `/api/gateways` | company-scoped |
| GET | `/api/gateways/:id` | detalle company-scoped |
| GET | `/api/gateways/by-mac/:mac` | resolución company-scoped |
| POST/PUT/DELETE | `/api/gateways...` | RBAC, empresa, auditoría, baja lógica |
| GET | `/api/devices` | company-scoped |
| GET | `/api/devices/:id` | detalle company-scoped |
| GET | `/api/devices/by-mac/:mac` | resolución company-scoped |
| GET | `/api/devices/:id/history` | scope en la misma consulta |
| POST/PUT/DELETE | `/api/devices...` | RBAC, empresa/tipo/estado, auditoría, baja lógica |
| GET | `/api/messages` | mensajes company-scoped |

No se crea `/api/hardware/v1` en esta fase porque las rutas existentes cubren limpiamente el contrato mínimo. El versionado se reserva para el futuro command journal o para un contrato interno que difiera del API administrativo.

## 10. Auditoría técnica

`technical_audit_log` registra:

- actor;
- acción;
- tipo e ID de entidad;
- empresa cuando existe;
- request ID;
- resultado;
- before/after redactado;
- timestamp.

Se auditan creación/modificación de empresas, memberships, usuarios, gateways y devices, asignaciones técnicas y desactivaciones. El redactor elimina recursivamente campos cuyo nombre indique password, secret, token, credential, authorization o contraseña BLE.

Los comandos técnicos de Horneo conservan su auditoría existente. Cuando el command journal se traslade a Hardware Manager deberá escribir en esta auditoría o enlazarla mediante request ID.

## 11. Compatibilidad legacy

Se mantienen:

- roles `ADMIN` y `USER`;
- `owner_id` en gateways/devices;
- registros con `company_id NULL`;
- tablas, FKs, UI e inventario Horneo;
- CRUD técnico Horneo, ahora mejor protegido;
- `frontend/public/` sin cambios; `backend/public/` sigue siendo la UI efectiva;
- MQTT y el cliente actual;
- parser y procesamiento de Horneo.

La UI efectiva muestra empresa/tipo y permite al superadmin asignarlos. Las acciones se ocultan para readonly; technician ve edición acotada y no ve alta/desactivación. No se ha realizado una reescritura visual.

## 12. Variables de entorno

| Variable | Regla |
|---|---|
| `JWT_SECRET` | obligatoria, mínimo 32 caracteres |
| `DB_PASSWORD` | obligatoria |
| `CORS_ALLOWED_ORIGINS` | lista separada por comas; configurar dominio(s) reales |
| `EMQX_MGMT_PASSWORD` | obligatoria si `MQTT_PERSISTENCE_MODE=emqx` |
| `MAIL_PASSWORD` | obligatoria si `MAIL_ENABLED=true` |
| `RFID_ACCESS_API_TOKEN` | obligatoria si `RFID_ACCESS_ENABLED=true` |
| `APP_MIGRATIONS_DIR` | opcional; ubicación alternativa de migraciones SQL |

Antes de construir/desplegar, el operador debe verificar estas variables en el gestor de secretos. El ejemplo deshabilita correo/RFID y deja valores secretos vacíos; no es una configuración de producción.

## 13. Identidad futura de servicio Horneo

No se implementa todavía para evitar introducir un esquema de tokens incompleto antes de migrar Horneo. El contrato aprobado para Fase B es:

```text
principal.type = service
principal.code = horneo
principal.company_id = <UUID empresa Horneo>
scopes = [hardware.read]
```

Requisitos de implementación:

- token opaco generado una vez y almacenado solo como hash;
- rotación y expiración/revocación;
- autenticación separada de usuarios humanos;
- `company_id` resuelto desde la identidad persistida, nunca desde request/frontend;
- scopes mínimos (`hardware.read`; acciones operativas explícitas si llegan a necesitarse);
- rate limit y auditoría por identidad/request ID;
- resolución por ID y MAC mediante los endpoints company-scoped o un contrato interno versionado;
- ningún token de usuario/superadmin reutilizado por Horneo.

## 14. Rollback

Rollback seguro de aplicación:

1. no ejecutar operaciones destructivas ni editar la migración aplicada;
2. volver a la imagen/commit anterior de `app` y Horneo;
3. mantener las tablas/columnas nuevas: son aditivas y nullable, por lo que el código anterior las ignora;
4. comprobar login, inventario legacy, MQTT y Horneo;
5. investigar antes de reintentar la migración; un checksum distinto debe tratarse como error, no forzarse.

No se recomienda eliminar `companies`, memberships, auditoría o columnas como rollback inmediato. Una retirada posterior exigiría migración nueva, comprobar cero referencias, convertir roles técnicos a roles compatibles y obtener autorización explícita.

## 15. Compatibilidad B5, RSSI y presencia

No se cambiaron:

- `gw/{gatewayMac}/publish`;
- `gw/{gatewayMac}/subscribe`;
- payloads o `msg_id` MKGW3;
- comandos B5 1045, 1053, 1059 y 1063;
- éxito por ACK individual con `result_code = 0`;
- parser 3070, `bxp-button`, `frame_type = 1`, `alarm_status = 1`;
- deduplicación por tag/trigger count;
- `dispatchPhysicalAlarm: false`;
- RSSI threshold, margen de entrada, renovación de sesión o separación `last_seen_at`/`last_presence_at`.

La suite completa de Horneo valida estos contratos.

## 16. Riesgos conocidos

- las migraciones se validaron estáticamente y por compilación, pero no se ejecutaron contra una copia PostgreSQL del entorno;
- los registros nuevos aún pueden quedar sin empresa por compatibilidad con la UI/flujo legacy; solo superadmin puede verlos y Fase B debe impedir nuevas altas sin empresa;
- `owner_id`, `places` y categorías siguen siendo modelos legacy no company-scoped completos;
- Horneo todavía tiene inventario y ejecutor MQTT/ACK propios por requisito de Fase A;
- `localStorage` sigue almacenando JWT; su sustitución por cookie segura requiere una migración de sesión separada;
- CSP mantiene `'unsafe-inline'` para compatibilidad con la UI actual;
- las dependencias instaladas reportan vulnerabilidades conocidas; no se aplicó `npm audit fix` porque podría introducir cambios fuera de alcance o incompatibles;
- no existe todavía identidad de servicio Horneo ni command journal central;
- técnicos no pueden administrar empresas/memberships desde UI; el CRUD administrativo es API en esta fase.

## 17. Pendientes exactos para Fase B

1. crear la empresa Horneo en Hardware Manager;
2. implementar identidad de servicio `horneo` con `hardware.read` y rotación segura;
3. inventariar y normalizar todas las MAC de `cold_compliance.gateways`;
4. detectar duplicados/conflictos con `horizonst.gateways`;
5. importar idempotentemente cada gateway con `company_id = Horneo`;
6. añadir `hardware_gateway_id` nullable a relaciones operativas Horneo mediante migración nueva;
7. hacer backfill y validar uno-a-uno, huérfanos, cámaras/planta y RSSI;
8. añadir resolución Horneo por ID/MAC usando identidad de servicio;
9. probar aislamiento negativo frente a una segunda empresa;
10. mover B5/RSSI/configuración al contrato central o adapter aprobado, sin cambiar MQTT;
11. hacer obligatoria la empresa para nuevas altas una vez completado el backfill;
12. mantener dual-read y rollback hasta completar métricas de convivencia;
13. no eliminar aún tags/FKs: corresponden a Fase C/D.
