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
- `POST /api/auth/verify-email`
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
| `STORE_EMAIL_VERIFICATION_TTL` | Duración de tokens de verificación de email. | `24h` |

### Endpoints auth

- `POST /api/auth/register`: crea cliente `pending_email_verification`, perfil base y token opaco de verificación; en desarrollo devuelve `verificationToken`, nunca en producción.
- `POST /api/auth/verify-email`: valida token no usado, no revocado y no expirado; activa únicamente usuarios `pending_email_verification` y marca el token `used_at`/`revoked_at`.
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

1. Registro crea usuario cliente pendiente de verificación, perfil base y token de verificación en el esquema `store.*`.
2. Verificación de email activa el usuario y consume/revoca el token.
3. Login valida password con scrypt, exige estado `active`, devuelve JWT corto y refresh token opaco.
4. La BD guarda únicamente hashes SHA-256 de refresh/reset/verificación, nunca tokens planos.
5. Refresh comprueba expiración/revocación y estado activo del usuario.
6. Logout marca `revoked_at`; reset de password marca el token usado y revoca refresh tokens activos.
7. En producción el proceso falla al arrancar si `STORE_JWT_SECRET` no está definido o conserva el valor inseguro de desarrollo.

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
VERIFICATION_TOKEN=...; curl -X POST http://127.0.0.1:4020/api/auth/verify-email -H 'Content-Type: application/json' -d "{\"token\":\"$VERIFICATION_TOKEN\"}"
curl -X POST http://127.0.0.1:4020/api/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente@example.com","password":"Password1234"}'
ACCESS_TOKEN=...; curl http://127.0.0.1:4020/api/auth/me -H "Authorization: Bearer $ACCESS_TOKEN"
REFRESH_TOKEN=...; curl -X POST http://127.0.0.1:4020/api/auth/logout -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```

## Portal de distribuidores

La fase 3 añade `POST /api/auth/register-distributor` para solicitar alta como distribuidor, además de APIs protegidas para distribuidores y administración. Las rutas de distribuidor requieren JWT con `role = distributor`; las rutas administrativas requieren `role = admin`.

### Área privada de distribuidor

- `GET /api/distributor/profile`: devuelve usuario, perfil de distribuidor, estado de validación y fechas relevantes.
- `PATCH /api/distributor/profile`: actualiza únicamente datos fiscales y de contacto permitidos (`company_name`, `tax_id`, `billing_address`, `city`, `province`, `postal_code`, `country`, `website`, `contact_person`). No acepta cambios directos de `validation_status`, `approved_at` ni `approved_by`.
- `POST /api/distributor/documents`: recibe `multipart/form-data` con `documentType` y `file`. Solo admite PDFs, valida tamaño con `store.settings.document_max_size_bytes`, genera nombres seguros y almacena los ficheros bajo `STORE_DOCUMENTS_PATH` sin exponer rutas internas.
- `GET /api/distributor/documents`: lista documentos del distribuidor con `id`, `document_type`, `status` y `created_at`.

Tipos documentales permitidos: `certificado_censal`, `modelo_036`, `modelo_037`, `cif_empresa`, `certificado_autonomo`, `escrituras` y `otro`.

### API administrativa mínima

- `GET /api/admin/distributors`: lista distribuidores con filtros opcionales `validation_status`, `email` y `company_name`.
- `GET /api/admin/distributors/:id`: devuelve usuario, perfil y documentos asociados.
- `PATCH /api/admin/distributors/:id/status`: cambia el estado a `pending`, `needs_more_info`, `approved`, `rejected`, `suspended` o `closed`; al aprobar completa `approved_at` y `approved_by`.
- `GET /api/admin/distributor-documents/:id/download`: descarga segura de PDFs para administradores sin revelar rutas físicas.

Las acciones principales del portal (`distributor_profile_updated`, `distributor_document_uploaded`, `distributor_validation_status_changed` y `admin_distributor_document_downloaded`) quedan registradas en `store.audit_log`.
