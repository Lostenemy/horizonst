# HorizonST Store

Servicio privado base para la futura tienda HorizonST en `tienda.horizonst.com.es`. Este incremento prepara backend Node.js/TypeScript/Express, frontend estático sin toolchain pesada, migraciones del esquema PostgreSQL `store`, catálogo inicial y healthchecks. No incluye pagos online ni flujos completos de catálogo, presupuestos, distribuidores o administración.

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

Las migraciones viven en `migrations/`. El script de migración usa el JavaScript compilado en `dist/db/migrate.js`, por lo que primero debe ejecutarse el build:

```bash
cd horizonst-store
npm run build
npm run migrate
```

La migración inicial crea `store` y tablas base para usuarios, perfiles de clientes/distribuidores, documentos, productos, planes SaaS, leads, presupuestos, ajustes y auditoría. No usa `ON DELETE CASCADE`; las relaciones comerciales restringen borrados o preservan referencias con `ON DELETE SET NULL` donde aplica.

## Endpoints

- `GET /health`
- `GET /api/health`
- `GET /api/catalog/products`
- `GET /api/catalog/saas-plans`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/customer/profile`
- `PATCH /api/customer/profile`

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

## Incremento 2: autenticación y área cliente

### Variables nuevas

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `STORE_JWT_SECRET` | Secreto HMAC HS256 para access tokens JWT. En producción debe ser largo y privado. | `dev-only-change-me` |
| `STORE_ACCESS_TOKEN_TTL` | Duración del access token (`s`, `m`, `h`, `d`). | `15m` |
| `STORE_REFRESH_TOKEN_TTL` | Duración del refresh token persistente. | `30d` |
| `STORE_PASSWORD_RESET_TTL` | Duración de tokens de reset de password. | `1h` |

### Endpoints auth

- `POST /api/auth/register`: crea cliente `active` y perfil base. La tabla de verificación de email queda preparada, pero el envío/verificación de correo no queda funcional en este incremento.
- `POST /api/auth/login`: solo permite `users.status = active`; `suspended`, `closed` y pendientes reciben respuesta genérica.
- `POST /api/auth/refresh`: emite un nuevo access token usando refresh token persistente válido.
- `POST /api/auth/logout`: revoca el refresh token enviado.
- `GET /api/auth/me`: devuelve el usuario autenticado con `Authorization: Bearer <accessToken>`.
- `POST /api/auth/request-password-reset`: genera token hasheado; en desarrollo devuelve `resetToken` para pruebas locales.
- `POST /api/auth/reset-password`: cambia password con token válido y revoca sesiones.

### Área cliente

- `GET /api/customer/profile`: perfil del usuario autenticado.
- `PATCH /api/customer/profile`: actualiza datos básicos y facturación.

### Flujo auth

1. Registro crea usuario cliente y perfil base en el esquema `store.*`.
2. Login valida password con scrypt, exige estado `active`, devuelve JWT corto y refresh token opaco.
3. La BD guarda únicamente hashes SHA-256 de refresh/reset/verificación, nunca tokens planos.
4. Refresh comprueba expiración/revocación y estado activo del usuario.
5. Logout marca `revoked_at`; reset de password marca el token usado y revoca refresh tokens activos.

### Migraciones en Docker/runtime

El contenedor runtime debe ejecutar migraciones con el JavaScript compilado:

```bash
docker compose build horizonst_store
docker compose run --rm horizonst_store npm run migrate
# internamente: node dist/db/migrate.js
```

### Pruebas rápidas con curl

```bash
curl http://127.0.0.1:4020/api/health
curl http://127.0.0.1:4020/api/catalog/products
curl -X POST http://127.0.0.1:4020/api/auth/register -H 'Content-Type: application/json' -d '{"email":"cliente@example.com","password":"Password1234","fullName":"Cliente Demo"}'
curl -X POST http://127.0.0.1:4020/api/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente@example.com","password":"Password1234"}'
ACCESS_TOKEN=...; curl http://127.0.0.1:4020/api/auth/me -H "Authorization: Bearer $ACCESS_TOKEN"
REFRESH_TOKEN=...; curl -X POST http://127.0.0.1:4020/api/auth/logout -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```
