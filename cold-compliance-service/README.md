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

## MQTT (sin romper esquema productivo)

- **App → Gateway (comandos)**: `gw/{gatewayMac}/subscribe`
- **Gateway → App (reply + eventos)**: `gw/{gatewayMac}/publish`

## Formato de comandos soportados

### LED (1101)
```json
{
  "msg_id": 1101,
  "device_info": { "mac": "4C11AE8BE624" },
  "data": { "mac": "AABBCCDDEEFF", "led_state": 1, "duration": 5000 }
}
```

### Buzzer (1102)
```json
{
  "msg_id": 1102,
  "device_info": { "mac": "4C11AE8BE624" },
  "data": { "mac": "AABBCCDDEEFF", "buzzer_state": 1, "frequency": 2000, "duration": 3000 }
}
```

### Vibración (1103)
```json
{
  "msg_id": 1103,
  "device_info": { "mac": "4C11AE8BE624" },
  "data": { "mac": "AABBCCDDEEFF", "vibration_state": 1, "intensity": 100, "duration": 2000 }
}
```

## Correlación y resultados gateway

Se correlaciona por `msg_id + gateway_mac` y se interpreta `result_code`:
- `0`: success
- `1`: length error
- `2`: type error
- `3`: range error
- `4`: no object error

Estados de comando: `pending`, `sent`, `ack_ok`, `ack_error`, `timeout`, `failed`.

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
- `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`
- `MQTT_SUB_TOPICS=gw/+/publish`
- `MQTT_COMMAND_TOPIC_TEMPLATE=gw/{gatewayMac}/subscribe`

### Compliance
- `MAX_CONTINUOUS_MINUTES=45`
- `PRE_ALERT_MINUTES=40`
- `REQUIRED_BREAK_MINUTES=15`
- `MAX_DAILY_MINUTES=360`

### Tag-control
- `TAG_CONTROL_ENABLED=true`
- `TAG_CONTROL_DEFAULT_TIMEOUT_MS=8000`
- `TAG_CONTROL_MAX_RETRIES=2`
- `TAG_CONTROL_MSG_ID_START=1100`
- `TAG_CONTROL_REQUIRE_REPLY=true`
- `TAG_CONTROL_DEDUP_WINDOW_MS=10000`
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

### Tag-control
- `POST /tag-control/led`
- `POST /tag-control/buzzer`
- `POST /tag-control/vibration`
- `POST /tag-control/custom`
- `POST /tag-control/custom-alert` (alias legacy)
- `GET /tag-control/commands`
- `GET /tag-control/commands/active`
- `GET /tag-control/commands/:id`
- `GET /tag-control/templates`
- `POST /tag-control/templates`
- `PATCH /tag-control/templates/:id`

## Flujo comando-respuesta completo

1. `compliance` o API manual solicita alerta de tag.
2. `tag-control` resuelve trabajador/tag/gateway (estrategia configurable).
3. Valida parámetros y construye payload.
4. Publica en `gw/{gatewayMac}/subscribe`.
5. Espera reply en `gw/{gatewayMac}/publish`.
6. Persiste intentos, response y estado final.
7. Registra auditoría de resultado.

## Supuestos de protocolo

- El gateway MKGW3 actúa como puente BLE.
- El ACK del gateway confirma recepción/parseo del comando MQTT, **no garantiza siempre** la ejecución física final en periférico si firmware no expone confirmación profunda.
- Parámetros exactos y semántica final pueden variar por firmware BXP-B-CR; el servicio queda preparado para ajustar templates y validadores.

## Docker Compose

Servicio ya integrado en `docker-compose.yml` raíz como `cold_compliance_service`.

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
