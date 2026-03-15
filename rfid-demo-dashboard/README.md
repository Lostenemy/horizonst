# RFID Demo Dashboard

Módulo independiente para demo RFID de inventario en tiempo real sobre HorizonST.

## Qué hace

- Se conecta al broker MQTT y se suscribe a `devices/RF1`.
- Soporta payload real del lector (`reads[]` con EPC) y payload simple (`cardId/readerMac`).
- Resuelve si una etiqueta está registrada consultando `public.rfid_cards.card_uid`.
- Aplica lógica de inventario tipo toggle (IN/OUT) por EPC.
- Aplica anti-rebote configurable (debounce) para duplicados instantáneos.
- Persiste histórico y estado en PostgreSQL usando tablas propias.
- Expone dashboard web visual con actualización en tiempo real (Socket.IO).

## Estructura

- `src/`: backend TypeScript
- `public/`: frontend estático
- `migrations/`: SQL idempotente

## Variables de entorno

Revisar `.env.example`.

## Desarrollo local

```bash
cd rfid-demo-dashboard
npm install
npm run dev
```

App: `http://localhost:3200`

## Build y ejecución

```bash
npm run build
npm start
```

## Endpoints

- `GET /health`
- `GET /api/dashboard/initial`
- `GET /api/dashboard/events?limit=50`
- `GET /api/dashboard/active`
- `GET /api/dashboard/unregistered`

## Eventos Socket.IO

- `dashboard:init`
- `reading:new`
- `dashboard:summary`
- `inventory:delta`

## Migración SQL

Ejecutar una vez contra la base `horizonst`:

```bash
psql -h <host> -U <user> -d horizonst -f migrations/001_rfid_demo_dashboard.sql
```

## Reglas de negocio

- Primera lectura EPC => `IN` (activo)
- Segunda lectura EPC => `OUT` (inactivo)
- Alterna sucesivamente
- Lecturas dentro de ventana debounce del mismo `epc+reader+antenna` se registran como `IGNORED`

## Docker

```bash
docker build -t rfid-demo-dashboard:local .
docker run --rm -p 3200:3200 --env-file .env rfid-demo-dashboard:local
```

## Notas

- No modifica tablas existentes de HorizonST.
- Usa tablas nuevas: `rfid_demo_read_events` y `rfid_demo_inventory_state`.
