# HorizonST Store

Servicio privado base para la futura tienda HorizonST en `tienda.horizonst.com.es`. Este incremento prepara backend Node.js/TypeScript/Express, frontend React/Vite, migraciones del esquema PostgreSQL `store`, catálogo inicial y healthchecks. No incluye pagos online ni flujos completos de catálogo, presupuestos, distribuidores o administración.

## Puerto y Docker

- Puerto interno: `4020`
- Publicación local: `127.0.0.1:4020:4020`
- Servicio Compose: `horizonst_store`
- Documentos futuros: `/opt/horizonst/store-data/documents` montado en el contenedor en la misma ruta.

## Variables de entorno

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `PORT` / `STORE_PORT` | Puerto HTTP del servicio | `4020` |
| `DB_HOST` | Host PostgreSQL | `postgres` |
| `DB_PORT` | Puerto PostgreSQL | `5432` |
| `DB_USER` | Usuario PostgreSQL | `horizonst` |
| `DB_PASSWORD` | Password PostgreSQL | `horizonst` |
| `DB_NAME` | Base existente de HorizonST | `horizonst` |
| `DATABASE_URL` | URL PostgreSQL alternativa | sin valor |
| `STORE_DOCUMENTS_PATH` | Ruta para documentos de distribuidores | `/opt/horizonst/store-data/documents` |
| `STORE_CORS_ORIGIN` | Origen permitido para CORS | `http://127.0.0.1:4020` |

## Comandos

```bash
npm install
npm run typecheck
npm run build
npm run migrate
npm start
```

Docker:

```bash
docker compose build horizonst_store
docker compose up -d horizonst_store
```

## Migraciones

Las migraciones viven en `migrations/` y se aplican con:

```bash
cd horizonst-store
npm run migrate
```

La migración inicial crea `store` y tablas base para usuarios, perfiles de clientes/distribuidores, documentos, productos, planes SaaS, leads, presupuestos, ajustes y auditoría. No usa `ON DELETE CASCADE`; las relaciones comerciales restringen borrados o preservan referencias con `ON DELETE SET NULL` donde aplica.

## Endpoints

- `GET /health`
- `GET /api/health`
- `GET /api/catalog/products`
- `GET /api/catalog/saas-plans`
- `POST /api/auth/register` (preparación segura con bcrypt)
- `POST /api/auth/login` (sin emisión de sesión/JWT en incremento 1)

## Catálogo inicial

Precios en céntimos:

- `gateway_ble` — Gateway BLE HorizonST — `19000`
- `gateway_antenna` — Antena para Gateway BLE — `15000`
- `tag_ble` — Tag BLE HorizonST — `7500`
- `poe_power_supply` — Fuente PoE — `15000`

Planes SaaS anuales en céntimos:

- `starter` — Starter — `58000` — 12 tags / 5 gateways
- `professional` — Professional — `80000` — 20 tags / 10 gateways
- `enterprise` — Enterprise — precio a consultar

## Estructura

```text
horizonst-store/
  Dockerfile
  migrations/
  src/
    config/
    db/
    modules/
      auth/
      catalog/
      health/
      users/
  web/
    src/
```
