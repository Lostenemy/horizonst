# Inventario de variables de producción

Los nombres de la columna «variable del proceso» proceden del código. El Compose fija internamente los valores que no deben variar y reutiliza `/opt/horizonst-production/config/.env` para los secretos. `APP_MIGRATIONS_DIR`, `DATABASE_URL` y las variables `*_ALLOW_DATABASE_TESTS`/`*_TEST_DATABASE_URL` son controles de desarrollo o test y no deben añadirse al entorno de producción.

## Backend / Hardware Manager

| Variable del proceso | Requisito | Valor en el artefacto |
| --- | --- | --- |
| `NODE_ENV`, `HOST`, `PORT` | fijadas | `production`, `0.0.0.0`, `3000`; solo se publica en loopback |
| `TRUSTED_PROXY_IP` | obligatoria | IP exacta del gateway de la red Docker |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | obligatorias | `postgres:5432`, credenciales protegidas, `horizonst` |
| `JWT_SECRET` | obligatoria | aleatoria, mínimo 32 caracteres |
| `JWT_EXPIRES_IN` | opcional | `8h` |
| `CORS_ALLOWED_ORIGINS` | opcional | vacío hasta aprobar orígenes explícitos |
| `MQTT_HOST`, `MQTT_PORT` | fijadas | `vernemq:1883` |
| `MQTT_USER`, `MQTT_PASS` | obligatorias | usuario/contraseña operativos ya protegidos |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | alias | no usar; el Compose usa los nombres anteriores |
| `MQTT_CLIENT_ID` | fijada | `acces_control_server_backend` |
| `MQTT_CLIENT_PREFIX` | no usada | fallback de código; queda anulada por client ID explícito |
| `MQTT_KEEPALIVE` | opcional | código: `60` |
| `MQTT_RECONNECT_PERIOD` | opcional | código: `1000`, mínimo `500` |
| `MQTT_RECONNECT_MAX_PERIOD` | opcional | código: `30000`, mínimo `2000` |
| `MQTT_PROTOCOL_ID`, `MQTT_PROTOCOL_VERSION` | opcionales | `MQTT`, `4` |
| `MQTT_CLEAN` | opcional | `true` |
| `MQTT_CONNECT_TIMEOUT` | opcional | `10000` |
| `MQTT_PERSISTENCE_MODE`, `MQTT_REQUIRED` | fijadas | `app`, `true` |
| `MQTT_RAW_RETENTION_HOURS` | opcional | `48`, mínimo `1` |
| `MQTT_MAINTENANCE_INTERVAL_MS` | opcional | `60000`, mínimo `60000` |
| `MQTT_MAINTENANCE_BATCH_SIZE` | opcional | `10000`, mínimo `100` |
| `INTERNAL_SERVICE_RATE_LIMIT_PER_MINUTE` | opcional | `120` |
| `GATEWAY_COMMAND_TIMEOUT_MS` | opcional | `8000` |
| `GATEWAY_COMMAND_SWEEP_INTERVAL_MS` | opcional | `5000` |
| `B5_SESSION_PASSWORD` | obligatoria | secreto protegido; nunca auditado en payload/log |
| `B5_CONNECT_TIMEOUT_MS`, `B5_ACTION_TIMEOUT_MS` | opcionales | `12000`, `8000` |
| `MAIL_ENABLED` | fijada inicialmente | `false` mediante `BACKEND_MAIL_ENABLED` |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `CONTACT_RECIPIENTS`, `MAIL_EHLO_DOMAIN`, `MAIL_TLS_REJECT_UNAUTHORIZED` | condicionales | solo necesarias al habilitar correo Backend; definirlas explícitamente antes |
| `EMQX_MGMT_HOST`, `EMQX_MGMT_PORT`, `EMQX_MGMT_USERNAME`, `EMQX_MGMT_PASSWORD`, `EMQX_MGMT_SSL`, `EMQX_MGMT_MAX_RETRIES`, `EMQX_MGMT_RETRY_INTERVAL_MS` | no usadas | solo modo `emqx`; producción fija modo `app` |

## Horneo

| Variable | Requisito | Valor seguro/default |
| --- | --- | --- |
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | fijada/opcional | `production`, `3100`, `info` |
| `TRUSTED_PROXY_IP` | obligatoria | misma IP exacta del bridge |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | obligatorias | `postgres:5432`, protegidas, `cold_compliance` |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_CLIENT_ID` | obligatorias | `mqtt://vernemq:1883`, credenciales existentes, `cold-compliance-service-production` |
| `MQTT_SUB_TOPICS` | opcional | vacío; HM suministra topics exactos al activar integración |
| `PRESENCE_EXIT_TIMEOUT_MS`, `PRESENCE_SWEEP_INTERVAL_MS` | opcionales | `30000`, `10000` |
| `PRESENCE_RSSI_ENTRY_MARGIN_DB` | opcional | `5` |
| `PRESENCE_HEARTBEAT_RETENTION_DAYS`, `PRESENCE_MAINTENANCE_INTERVAL_MS`, `PRESENCE_MAINTENANCE_BATCH_SIZE` | opcionales | `7`, `60000`, `10000` |
| `OPERATIONAL_GRACE_MINUTES`, `REENTRY_REMINDER_INTERVAL_MS` | opcionales | `15`, `180000` |
| `MAX_CONTINUOUS_MINUTES`, `PRE_ALERT_MINUTES`, `REQUIRED_BREAK_MINUTES`, `MAX_DAILY_MINUTES` | opcionales | `45`, `40`, `15`, `360` |
| `INCIDENT_GRACE_MINUTES`, `DEAD_MAN_DEFAULT_MINUTES`, `BATTERY_ALERT_THRESHOLD` | opcionales | `2`, `3`, `20` |
| `SYNC_BATCH_SIZE`, `SYNC_QUEUE_ENABLED`, `SYNC_QUEUE_SYNCED_RETENTION_HOURS` | fijada/opcionales | `100`, `false`, `24` |
| `TAG_CONTROL_GATEWAY_STRATEGY`, `TAG_CONTROL_GATEWAY_CANDIDATE_LIMIT`, `TAG_CONTROL_GATEWAY_CANDIDATE_WINDOW_MS` | opcionales | `hybrid`, `4`, `120000` |
| `TAG_ALARM_PHYSICAL_ENABLED` | opcional | `true`; no cambiar durante la promoción |
| `TAG_ALARM_CONNECT_MAX_RETRIES`, `TAG_ALARM_BLE_SESSION_TTL_MS` | opcionales | `2`, `120000` |
| `TAG_ALARM_POST_CONNECT_DELAY_MS`, `TAG_ALARM_BETWEEN_ACTION_DELAY_MS`, `TAG_ALARM_DUAL_ACTION_WAIT_MS` | opcionales | `1200`, `500`, `60000` |
| `HARDWARE_MANAGER_ENABLED` | obligatoria | `false` hasta completar aprovisionamiento; después `true` |
| `HARDWARE_MANAGER_BASE_URL` | fijada | `http://app:3000` |
| `HARDWARE_MANAGER_SERVICE_TOKEN` | obligatoria al activar | token protegido `hst_svc_…` |
| `HARDWARE_MANAGER_TIMEOUT_MS` | opcional | `3000` |
| `HARDWARE_MANAGER_COMMAND_TIMEOUT_MS` | opcional | `20000` |
| `HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS` | opcional | `45000`, mínimo admitido `40000` |
| `HARDWARE_MANAGER_MQTT_TOPIC_REFRESH_MS` | opcional | `30000` |
| `HARDWARE_MANAGER_CACHE_TTL_MS`, `HARDWARE_MANAGER_CACHE_ERROR_TTL_MS` | opcionales | `30000`, `5000` |
| `MAIL_ENABLED`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `MAIL_EHLO_DOMAIN`, `MAIL_TLS_REJECT_UNAUTHORIZED`, `APP_BASE_URL` | existentes | se mapean desde `COLD_*`; conservar valores reales actuales |

## Store

| Variable | Requisito | Valor seguro/default |
| --- | --- | --- |
| `NODE_ENV`, `PORT`/`STORE_PORT` | fijadas | `production`, `4020` |
| `TRUSTED_PROXY_IP` | obligatoria | IP exacta del bridge |
| `DATABASE_URL` | no usada | Compose usa `DB_*`; no definir simultáneamente |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | obligatorias | `postgres:5432`, protegidas, `horizonst` |
| `STORE_DOCUMENTS_PATH` | fijada | `/opt/horizonst/store-data/documents` y bind existente |
| `STORE_CORS_ORIGIN`, `STORE_PUBLIC_BASE_URL` | obligatorias | `https://horizonst.es` en la arquitectura descrita |
| `STORE_JWT_SECRET` | obligatoria | secreto aleatorio, no valor de desarrollo |
| `STORE_ACCESS_TOKEN_TTL`, `STORE_REFRESH_TOKEN_TTL` | opcionales | `15m`, `30d` |
| `STORE_PASSWORD_RESET_TTL`, `STORE_EMAIL_VERIFICATION_TTL` | opcionales | `1h`, `24h` |
| `STORE_MAIL_ENABLED` | opcional | conservar estado actual; `false` si no se valida SMTP |
| `STORE_MAIL_HOST`, `STORE_MAIL_PORT`, `STORE_MAIL_SECURE`, `STORE_MAIL_USER`, `STORE_MAIL_PASSWORD`, `STORE_MAIL_FROM`, `STORE_MAIL_EHLO_DOMAIN`, `STORE_MAIL_TLS_REJECT_UNAUTHORIZED`, `STORE_MAIL_COMMERCIAL_TO` | condicionales | obligatorias/coherentes si mail está habilitado; no placeholders en producción |
| `STORE_APPCC_GUIDE_URL` | opcional | URL pública actual del recurso |

## Claves del archivo protegido consumidas por interpolación

Además de los nombres exactos anteriores, el Compose usa `COLD_COMPLIANCE_DB_NAME`, `HARDWARE_MANAGER_PORT`, `BACKEND_MAIL_ENABLED` y las claves `COLD_*` como nombres de despliegue para mapear valores existentes a las variables exactas de cada proceso. No son leídas directamente por el código de las aplicaciones.
