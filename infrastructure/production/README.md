# Paridad segura de producción

Este directorio versiona por primera vez la definición reproducible del Compose principal. No sustituye automáticamente `/opt/horizonst-production/docker-compose.production.yml`: antes de promoverlo, operaciones debe compararlo con el archivo activo y aprobar cualquier diferencia. Correo y webmail siguen en su Compose independiente.

## Decisiones de diseño

- Proyecto, red y volúmenes conservan exactamente los nombres `horizonst-production*`.
- Los cinco servicios son `postgres`, `vernemq`, `app`, `cold_compliance_service` y `horizonst_store`. No se incluyen RFID Access, Elecnor, correo, webmail, UI MQTT ni servicios auxiliares de staging.
- Los contextos de build apuntan a `/opt/horizonst`; todos los servicios consumen el entorno protegido `/opt/horizonst-production/config/.env`.
- Todos los puertos publicados usan `127.0.0.1`. Hardware Manager queda en `127.0.0.1:3000` y no se le asigna dominio.
- `app` usa `acces_control_server_backend`, `MQTT_REQUIRED=true` y persistencia `app`. El código solo persiste crudo de `devices/MK4`; `gw/...`, incluido `3070`, se procesa en sus diarios específicos.
- Horneo conserva `cold-compliance-service-production`, topics exactos obtenidos por empresa y `SYNC_QUEUE_ENABLED=false`.
- `TRUSTED_PROXY_IP` es obligatorio y exacto. No se acepta `trust proxy=true`, un CIDR completo ni el valor supuesto de staging.

## Variables que deben añadirse al entorno protegido

Estas son las nuevas claves necesarias para Hardware Manager y su integración. Las claves DB, MQTT, Store y correo ya existentes se reutilizan; no se copian secretos a otro archivo.

| Variable | Obligatoria | Valor/criterio seguro |
| --- | --- | --- |
| `TRUSTED_PROXY_IP` | sí | gateway exacta de `horizonst-production`, obtenida con `docker network inspect` |
| `JWT_SECRET` | sí | aleatorio, mínimo 32 caracteres |
| `JWT_EXPIRES_IN` | no | `8h` |
| `CORS_ALLOWED_ORIGINS` | no | vacío mientras no haya UI pública; lista explícita después |
| `HARDWARE_MANAGER_PORT` | no | `3000`; siempre publicado en loopback |
| `MQTT_RAW_RETENTION_HOURS` | no | `48` |
| `MQTT_MAINTENANCE_INTERVAL_MS` | no | `60000` |
| `MQTT_MAINTENANCE_BATCH_SIZE` | no | `10000` |
| `INTERNAL_SERVICE_RATE_LIMIT_PER_MINUTE` | no | `120` |
| `GATEWAY_COMMAND_TIMEOUT_MS` | no | `8000` |
| `GATEWAY_COMMAND_SWEEP_INTERVAL_MS` | no | `5000` |
| `B5_SESSION_PASSWORD` | sí | secreto B5 existente/validado; nunca en logs o Git |
| `B5_CONNECT_TIMEOUT_MS` | no | `12000` |
| `B5_ACTION_TIMEOUT_MS` | no | `8000` |
| `HARDWARE_MANAGER_ENABLED` | sí | empezar en `false`; cambiar a `true` solo en la fase indicada |
| `HARDWARE_MANAGER_SERVICE_TOKEN` | sí al activar | token `hst_svc_…` generado por el procedimiento seguro |
| `HARDWARE_MANAGER_TIMEOUT_MS` | no | `3000` |
| `HARDWARE_MANAGER_COMMAND_TIMEOUT_MS` | no | `20000` para comandos individuales |
| `HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS` | no | `45000`, nunca menor de 40000 |
| `HARDWARE_MANAGER_MQTT_TOPIC_REFRESH_MS` | no | `30000` |
| `HARDWARE_MANAGER_CACHE_TTL_MS` | no | `30000` |
| `HARDWARE_MANAGER_CACHE_ERROR_TTL_MS` | no | `5000` |
| `PRESENCE_HEARTBEAT_RETENTION_DAYS` | no | `7` |
| `PRESENCE_MAINTENANCE_INTERVAL_MS` | no | `60000` |
| `PRESENCE_MAINTENANCE_BATCH_SIZE` | no | `10000` |
| `SYNC_QUEUE_SYNCED_RETENTION_HOURS` | no | `24`; `SYNC_QUEUE_ENABLED` queda fijado a `false` en Compose |
| `BACKEND_MAIL_ENABLED` | no | `false` en el primer despliegue local |

El archivo `production.env.example` enumera también las variables existentes que el Compose consume. `MQTT_CLIENT_ID`, `MQTT_PERSISTENCE_MODE`, `MQTT_REQUIRED`, `SYNC_QUEUE_ENABLED`, `HARDWARE_MANAGER_BASE_URL` y los puertos internos se fijan en Compose para impedir desviaciones accidentales.

## Bloqueos previos obligatorios

1. Comparar el Compose versionado con el Compose activo externo. No se puede certificar desde el repositorio que sus healthchecks/logging/restart sean idénticos sin esa revisión humana.
2. Consultar duplicados en `vmq_auth_acl` antes de Backend 005. Si existen, detenerse y decidir fila por fila; no borrarlos automáticamente.
3. Inventariar todas las MAC de overlays Horneo. Si el inventario central está vacío, ejecutar el bootstrap versionado descrito en `runbook.md`; nunca saltar directamente a 017/019.
4. Verificar que Store normal tiene exactamente 001–015 registrados. Ejecutar únicamente `npm run migrate:security`; 016 debe registrarse en `store.security_migrations`, no en el historial normal.
5. Obtener la IP exacta del proxy con `docker network inspect horizonst-production --format '{{(index .IPAM.Config 0).Gateway}}'` y confirmar con una petición de diagnóstico. No mostrar cabeceras de autorización.

## Aprovisionamiento sin exponer secretos

`provision-hardware-manager.sql` se ejecuta después de Backend 001–011. Recibe únicamente el hash SHA-256 y el hint del token, nunca el token. Reutiliza `username` y el hash bcrypt de la fila MQTT de Horneo; no imprime ni duplica la contraseña en claro. Modifica solo la fila destino `acces_control_server_backend`, eliminando de ella propiedades `qos` incompatibles y fijando permisos mínimos:

- publicación: `gw/+/subscribe`;
- suscripción: `devices/MK4`, `gw/+/publish`.

El principal `horneo-production` queda limitado a `hardware.read` y `hardware.command`. Una segunda ejecución con el mismo hash es idempotente; una rotación revoca los tokens activos anteriores sin borrar historia.

Generación recomendada en una sesión root sin trazas (`set +x`, `umask 077`):

```sh
read -r HORNEO_COMPANY_ID
read -r DB_USER
read -r DB_NAME
SERVICE_TOKEN="hst_svc_$(openssl rand -base64 32 | tr -d '=\n' | tr '+/' '-_')"
TOKEN_HASH="$(printf %s "$SERVICE_TOKEN" | sha256sum | cut -d' ' -f1)"
TOKEN_HINT="$(printf %s "$SERVICE_TOKEN" | tail -c 8)"

docker compose --env-file /opt/horizonst-production/config/.env \
  -f /opt/horizonst-production/docker-compose.production.yml exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  -v principal_code=horneo-production -v company_id="$HORNEO_COMPANY_ID" \
  -v token_hash="$TOKEN_HASH" -v token_hint="$TOKEN_HINT" \
  -v mqtt_source_client_id=cold-compliance-service-production \
  -v mqtt_backend_client_id=acces_control_server_backend \
  < /opt/horizonst/infrastructure/production/provision-hardware-manager.sql
```

Guardar `SERVICE_TOKEN` como `HARDWARE_MANAGER_SERVICE_TOKEN` mediante el editor de secretos del entorno protegido, cerrar la shell y verificar que el archivo mantiene propietario y modo previos. No usar `echo`, historial ni logs. `DB_USER` y `DB_NAME` deben coincidir con el entorno protegido; no es necesario leer ni imprimir la contraseña.

## Validación automatizada

```sh
node infrastructure/production/tests/validate-production-artifacts.mjs
node infrastructure/production/tests/production-migrations.postgres.mjs
```

El segundo comando crea y destruye un contenedor PostgreSQL 15 aislado; nunca acepta una URL de base externa. Requiere un daemon Docker local y las builds de Backend, Horneo y Store.
