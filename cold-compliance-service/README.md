# cold_compliance_service

Servicio desacoplado para cumplimiento normativo en cámaras frigoríficas dentro del ecosistema HorizonST, con soporte de **alertado activo sobre tags MK-Button (BXP-B-CR)** vía gateway MKGW3.

## Arquitectura

- **Ingesta MQTT (`gw/{mac}/publish`)**: cliente robusto con reconexión, handler chain e idempotencia por `event_id`.
- **Parser adaptable**: soporta payloads heterogéneos (MOKO/MKx) sin acoplar la lógica normativa.
- **Dominio de cumplimiento**: reglas 45/15, acumulado diario, batería baja, incidencias.
- **Tag control desacoplado**:
  - `compliance` decide cuándo alertar;
  - `tag-control` traduce a comando MQTT y gestiona reintentos/timeout/correlación;
  - `mqtt` transporta;
  - `audit` registra trazabilidad.
- **Persistencia jurídica**: eventos append-only (`presence_events`, `audit_log`, `incident_notes`) + historial de comandos (`tag_commands`, `tag_command_attempts`, `tag_command_responses`).
- **Modo offline/sync**: `sync_queue` para sincronización diferida y reintentos.

## Árbol principal

```txt
src/
  config/
  db/
  modules/
    mqtt/
    presence/
    compliance/
    alerts/
    incidents/
    workers/
    tags/
    cameras/
    reports/
    audit/
    sync/
    tag-control/
      application/
      domain/
      infrastructure/
  middleware/
  utils/
migrations/
```

## MQTT de Horneo

- **Gateway → Horneo (eventos)**: `gw/{gatewayMac}/publish`
- **Hardware Manager → Gateway (comandos)**: `gw/{gatewayMac}/subscribe`

Horneo solo consume eventos y no publica comandos MQTT directos. Los tópicos y
el formato de MAC del protocolo productivo no cambian.

## MQTT configuration

This service requires a VerneMQ `client_id` registered in `vmq_auth_acl` (VerneMQ + `vmq_diversity` + PostgreSQL).

Required identity:
- `client_id`: `cold-compliance-service`
- `username`: `Horizon@user2024`
- password stored as bcrypt in broker DB (`crypt(..., gen_salt('bf'))`)

Required topics (ACL):
- subscribe: una entrada exacta `gw/{gatewayMac}/publish` por cada gateway activa asignada a Horneo;
- publish: ninguno para Horneo; la alarma física B5, RSSI y configuración B5 se ejecutan mediante Hardware Manager.

> HorizonST enforces ACL by `client_id`, not only by username/password.
> The service will not work unless this broker registration exists.

## Database

This service must use a **dedicated PostgreSQL database**.

Example:

```env
DB_NAME=cold_compliance
```

Do **NOT** use the main `horizonst` database, because table names overlap (`gateways`, `workers`, `tags`, etc.) and schema types differ.

Migrations in this service create their own operational schema (`plants`, `workers`, `tags`, `gateways`, `cold_rooms`, `cold_room_sessions`, `alerts`, `incidents`, and related tables), so they must run against an empty/dedicated DB for this microservice.

To coexist safely with HorizonST core, keep core table names unchanged and isolate this service at database level.

## Ejecución local

```bash
cp .env.example .env
npm ci
npm run dev
```

## Variables clave

### Core
- `MQTT_URL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`
- `MQTT_SUB_TOPICS=` (sin comodines; con Hardware Manager activo se obtiene dinámicamente el inventario de gateways)
- `HARDWARE_MANAGER_MQTT_TOPIC_REFRESH_MS=30000`
- `HARDWARE_MANAGER_COMMAND_TIMEOUT_MS=20000`
- `HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS=45000` (presupuesto HTTP para los cuatro comandos secuenciales de configuración B5)

### Compliance
- `MAX_CONTINUOUS_MINUTES=45`
- `PRE_ALERT_MINUTES=40`
- `REQUIRED_BREAK_MINUTES=15`
- `MAX_DAILY_MINUTES=360`

### Selección de gateway para alarmas físicas
- `TAG_CONTROL_GATEWAY_STRATEGY=hybrid` (`last_seen|camera_assigned|hybrid`)

## Endpoints

### Salud
- `GET /health`
- `GET /ready`

### Gestión base
- `POST /workers`, `GET /workers`, `PATCH /workers/:id`, `POST /workers/:id/assign-tag`
- `POST /tags`, `GET /tags`
- `POST /cameras`, `GET /cameras`
- `GET /events/presence`, `GET /events/active-sessions`, `GET /events/workday/:workerId`
- `GET /alerts/active`, `GET /alerts/history?severity=warning`
- `GET /incidents`, `POST /incidents/:id/notes`, `POST /incidents/:id/close`
- `GET /reports/daily-summary.xlsx`, `GET /reports/incidents.pdf`

## Control técnico de hardware

El control técnico de hardware pertenece a Hardware Manager.

Horneo conserva la selección funcional del B5 y del gateway para las alarmas de
compliance y presencia, pero no ofrece endpoints manuales de control técnico ni
publica directamente comandos MQTT. Las tablas locales de tags, gateways y el
histórico de comandos se conservan.

## Docker Compose

Servicio ya integrado en `docker-compose.yml` raíz como `cold_compliance_service`.

## Deployment

Minimum deployment sequence:

1. Create dedicated DB for the service:
   - `CREATE DATABASE cold_compliance OWNER horizonst;`
2. Register MQTT identity in `vmq_auth_acl` (client + ACL for both topics).
3. Configure `cold-compliance-service/.env` (`DB_*`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`).
4. Start container with Docker Compose.

A SQL helper template is included at `scripts/register-mqtt-client.sql`.

## Reverse proxy (Nginx)

- El servicio **no configura Nginx automáticamente**.
- Escucha en `PORT` interno (por defecto `3100`) y está preparado para publicarse detrás de proxy inverso.
- Express usa `trust proxy = true`, por lo que respeta `X-Forwarded-For` y `X-Forwarded-Proto`.
- Rutas mínimas para monitorización desde Nginx/upstream: `/health` y `/ready`.
- Dominio objetivo de publicación: `horneo.horizonst.com.es` (configurado fuera de este servicio).

## Optional DB bootstrap (shared PostgreSQL host)

If the database does not exist yet, create it once with a privileged role:

```sql
CREATE DATABASE cold_compliance OWNER horizonst;
```

A helper script is included at `scripts/create-database.sql`.

## Web MVP integrado

- UI servida por el propio servicio en `/` (estáticos en `/web/*`).
- El superadministrador inicial debe crearse mediante un procedimiento separado de bootstrap o administración:
  - proporcionar el correo y una contraseña generada específicamente para el entorno mediante variables de entorno o entrada interactiva;
  - almacenar únicamente un hash bcrypt y no guardar credenciales ni secretos en Git;
  - abortar si el usuario ya existe, salvo confirmación administrativa explícita;
  - exigir el cambio inmediato de la contraseña inicial.
- Cualquier credencial inicial compartida anteriormente debe considerarse comprometida y no debe reutilizarse.
- Endpoints funcionales añadidos para MVP:
  - Auth: `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/forgot-password`, `/auth/reset-password`
    - Recuperación de contraseña con correo SMTP real (token + enlace); no depende de logs manuales.
  - Usuarios: `/users` (desactivación solo `administrador` y `superadministrador`; borrado solo `superadministrador`)
  - Dashboard: `/dashboard/presence`, `/dashboard/alerts`
  - Alarmas configurables: `/alarm-rules`
  - Inventario: `/gateways`, `/tags`
  - Tiempo real operativo: `/realtime/snapshot` y `/realtime/stream` (SSE con detalle de trabajadores dentro, tiempo, tag y alertas activas)
  - Informes inspección: `/reports/inspection.pdf`, `/reports/inspection.xlsx`

- Seguridad de credenciales:
  - `.env.example` solo incluye placeholders (`change_me` / `example.invalid`).
  - No se versionan secretos reales ni credenciales productivas.
- Restricción de roles en creación de usuarios:
  - La UI no ofrece `superadministrador` como rol de alta.
  - Backend rechaza creación/edición de usuarios a `superadministrador` vía `/users`.

- SMTP interno recomendado en Docker: usar `MAIL_HOST=mail.horizonst.com.es` y alias de red en el servicio `mail` para validar TLS por nombre de host.

- Semántica dashboard:
  - `Trabajadores detectados dentro` se calcula desde sesiones activas (`cold_room_sessions.ended_at IS NULL`).
  - `Alarmas activas (disparadas)` son alertas/incidencias abiertas (`alerts.acknowledged_at IS NULL`).
  - La configuración de reglas (`encendida`/`apagada`) y su estado operativo (`activa`) se consulta en la pantalla de gestión de alarmas.

- Parser MQTT de presencia: se ignoran mensajes de autodescripción de gateway (device_name/company_name/product_model/firmware...) para no usar `ble_mac` de gateway como `tag_uid`.
- En payloads `data[]` se priorizan detecciones beacon/tag reales (`mac`, `type=bxp-button`, `type_code=7`) para abrir sesiones válidas de trabajador.

- Timestamp MQTT normalizado: soporta epoch en ms/segundos e ISO-8601 antes de persistir `presence_events` y evaluar compliance.
