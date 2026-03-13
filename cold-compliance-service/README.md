# cold_compliance_service

Servicio desacoplado para cumplimiento normativo en cámaras frigoríficas dentro del ecosistema HorizonST.

## Arquitectura

- **Ingesta MQTT (`gw/{mac}/publish`)**: cliente robusto con reconexión e idempotencia por `event_id`.
- **Parser adaptable**: soporta payloads heterogéneos (MOKO/MKx) sin acoplar la lógica normativa.
- **Dominio de cumplimiento**: reglas 45/15, acumulado diario, batería baja, incidencias.
- **Persistencia jurídica**: eventos append-only (`presence_events`, `audit_log`, `incident_notes`) + sesiones trazables.
- **Modo offline/sync**: cola `sync_queue` para sincronización diferida y reintentos.

## Estructura

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
  middleware/
  utils/
```

## Ejecución local

```bash
cp .env.example .env
npm ci
npm run dev
```

## Variables de entorno clave

- `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`
- `MQTT_SUB_TOPICS=gw/+/publish`
- `MAX_CONTINUOUS_MINUTES=45`
- `REQUIRED_BREAK_MINUTES=15`
- `MAX_DAILY_MINUTES=360`
- `BATTERY_ALERT_THRESHOLD=20`

## Endpoints

- `GET /health`
- `GET /ready`
- `POST /workers`, `GET /workers`, `PATCH /workers/:id`
- `POST /workers/:id/assign-tag`
- `POST /tags`, `GET /tags`
- `POST /cameras`, `GET /cameras`
- `GET /events/presence`, `GET /events/active-sessions`, `GET /events/workday/:workerId`
- `GET /alerts/active`, `GET /alerts/history?severity=warning`
- `GET /incidents`, `POST /incidents/:id/notes`, `POST /incidents/:id/close`
- `GET /reports/daily-summary.xlsx`
- `GET /reports/incidents.pdf`

## Flujo funcional de ejemplo

1. Gateway publica en `gw/007007e0c804/publish`.
2. Parser detecta tag y evento `enter`.
3. Se guarda `presence_event` (idempotente).
4. Se abre sesión en `cold_room_sessions`.
5. Al evento `exit`, se cierra sesión y se acumula jornada.
6. Si excede límites, se crean alertas/incidencias y traza de auditoría.

## Supuestos del MVP

- El parser infiere `enter/exit` desde `eventType`, `zoneEvent` o `inZone`.
- `gateway_mac` se mapea a cámara vía tabla `gateways`.
- Sincronización cloud es placeholder: marca como `synced` para validar pipeline.

## Despliegue en Docker Compose

Añadir servicio:

```yaml
cold_compliance_service:
  build:
    context: ./cold-compliance-service
  env_file:
    - ./cold-compliance-service/.env
  environment:
    - DB_HOST=postgres
    - DB_PORT=5432
    - DB_USER=${DB_USER}
    - DB_PASSWORD=${DB_PASSWORD}
    - DB_NAME=${DB_NAME:-horizonst}
    - MQTT_URL=${COLD_MQTT_URL:-mqtt://vernemq:1883}
    - MQTT_USERNAME=${MQTT_USER}
    - MQTT_PASSWORD=${MQTT_PASS}
    - MQTT_SUB_TOPICS=${COLD_MQTT_SUB_TOPICS:-gw/+/publish}
    - PORT=${COLD_COMPLIANCE_PORT:-3100}
  depends_on:
    - postgres
    - vernemq
  restart: unless-stopped
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:${COLD_COMPLIANCE_PORT:-3100}/health || exit 1"]
    interval: 20s
    timeout: 4s
    retries: 5
  ports:
    - "127.0.0.1:${COLD_COMPLIANCE_PORT:-3100}:${COLD_COMPLIANCE_PORT:-3100}"
  networks:
    - horizonst
```
