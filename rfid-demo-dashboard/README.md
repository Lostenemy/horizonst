# RFID Demo Dashboard

Módulo independiente para demo RFID de inventario en tiempo real sobre HorizonST.

## Qué hace

- Se conecta al broker MQTT y se suscribe a `devices/RF1`.
- Soporta payload real del lector (`reads[]` con EPC) y payload simple (`cardId/readerMac`).
- Resuelve si una etiqueta está registrada consultando `public.rfid_demo_tags` (`active=true`).
- Aplica lógica de inventario tipo toggle (IN/OUT) por EPC.
- Aplica anti-rebote configurable (debounce) para duplicados instantáneos.
- Persiste histórico y estado en PostgreSQL usando tablas propias.
- Expone dashboard web visual con actualización en tiempo real (Socket.IO).

## Aislamiento de base de datos

- Base de datos por defecto: `rfid_demo`.
- No depende de la base `horizonst`.
- Puede borrarse la base `rfid_demo` sin afectar al sistema principal.

## Variables de entorno

Usa `.env` propio del servicio:

```bash
cd rfid-demo-dashboard
cp .env.example .env
```

Valores por defecto válidos para Docker en HorizonST:

- `RFID_DEMO_DB_HOST=postgres`
- `RFID_DEMO_DB_PORT=5432`
- `RFID_DEMO_DB_USER=horizonst`
- `RFID_DEMO_DB_PASSWORD=horizonst`
- `RFID_DEMO_DB_NAME=rfid_demo`
- `RFID_DEMO_MQTT_HOST=vernemq`
- `RFID_DEMO_MQTT_PORT=1883`

### Autenticación MQTT en HorizonST (vmq_auth_acl)

En HorizonST el broker valida credenciales contra PostgreSQL (`vmq_auth_acl`) y requiere `client_id` fijo.

Variables MQTT requeridas:

- `RFID_DEMO_MQTT_USER`
- `RFID_DEMO_MQTT_PASS`
- `RFID_DEMO_MQTT_CLIENT_ID`

## Docker / Docker Compose

El contenedor está preparado para ejecutarse sin pasos manuales extra:

- build con `npm ci`
- compilación con `npm run build`
- arranque con `node dist/index.js`

Además, las migraciones se ejecutan automáticamente al iniciar el proceso.

Flujo esperado de despliegue del servicio:

```bash
cd rfid-demo-dashboard
cp .env.example .env

cd ..
docker compose build
docker compose up -d
```

Ejemplo standalone:

```bash
cd rfid-demo-dashboard
cp .env.example .env
docker build -t rfid-demo-dashboard:local .
docker run --rm -p 3200:3200 --env-file .env rfid-demo-dashboard:local
```

## Endpoints

- `GET /health`
- `GET /api/dashboard/initial`
- `GET /api/dashboard/events?limit=50`
- `GET /api/dashboard/active`
- `GET /api/dashboard/unregistered`
- `GET /api/tags?limit=500`
- `POST /api/tags`

## Eventos Socket.IO

- `dashboard:init`
- `reading:new`
- `dashboard:summary`
- `inventory:delta`

## Reglas de negocio

- Primera lectura EPC => `IN` (activo)
- Segunda lectura EPC => `OUT` (inactivo)
- Alterna sucesivamente
- Lecturas dentro de ventana debounce del mismo `epc+reader+antenna` se registran como `IGNORED`

## Notas

- No modifica tablas existentes de HorizonST.
- Usa tablas nuevas: `rfid_demo_read_events`, `rfid_demo_inventory_state` y `rfid_demo_tags`.
- `rfid_demo_tags` define qué EPC se considera registrada.


## Seed opcional para demo comercial

Si quieres mostrar datos variados de tags registradas en una demo:

```bash
psql -h <host> -U <user> -d rfid_demo -f migrations/seed_demo_tags.sql
```

Este seed inserta EPCs plausibles con nombres de activos verosímiles y hace upsert por EPC.
