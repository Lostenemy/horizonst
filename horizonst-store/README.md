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
- `POST /api/distributor/documents`: recibe `multipart/form-data` con `documentType` y `file`. Solo admite PDFs, valida tamaño con `store.settings.document_max_size_bytes`, genera nombres seguros, reemplaza documentos anteriores del mismo tipo y devuelve el perfil a `pending` limpiando aprobaciones previas.
- `GET /api/distributor/documents`: lista documentos del distribuidor con `id`, `document_type`, `status` y `created_at`.

Tipos documentales permitidos: `certificado_censal`, `modelo_036`, `modelo_037`, `cif_empresa`, `certificado_autonomo`, `escrituras` y `otro`.

### API administrativa mínima

- `GET /api/admin/distributors`: lista distribuidores con filtros opcionales `validation_status`, `email` y `company_name`.
- `GET /api/admin/distributors/:id`: devuelve usuario, perfil y documentos asociados.
- `PATCH /api/admin/distributors/:id/status`: cambia el estado a `pending`, `needs_more_info`, `approved`, `rejected`, `suspended` o `closed`; al aprobar completa `approved_at` y `approved_by`.
- `GET /api/admin/distributor-documents/:id`: consulta el detalle administrativo de un documento.
- `PATCH /api/admin/distributor-documents/:id/status`: revisa documentos con estados `pending`, `approved`, `rejected` o `replaced`; `rejected` requiere `review_notes`.
- `GET /api/admin/distributor-documents/:id/download`: descarga segura de PDFs para administradores sin revelar rutas físicas.

Las acciones principales del portal (`distributor_profile_updated`, `distributor_document_uploaded`, `distributor_validation_status_changed` y `distributor_document_approved`, `distributor_document_rejected`, `distributor_document_replaced`, `admin_distributor_document_downloaded`) quedan registradas en `store.audit_log`.

## Fase 4: carrito persistente y solicitudes de presupuesto

La fase 4 añade un carrito persistente basado en `store.quotes` y `store.quote_items`. El carrito activo de cada usuario autenticado es siempre su quote con `status = draft`; si no existe, `GET /api/cart` lo crea automáticamente. No hay pagos online en esta fase.

### Estados de quote

Estados válidos: `draft`, `submitted`, `in_review`, `sent`, `accepted`, `rejected` y `cancelled`.

### Endpoints de carrito

Todas las rutas requieren `Authorization: Bearer <accessToken>` y rol `customer`, `distributor` o `admin`.

- `GET /api/cart`: devuelve el carrito `draft` del usuario con sus líneas; crea uno vacío si no existe.
- `POST /api/cart/items`: añade o incrementa una línea de producto o plan SaaS activo.
  - Producto: `{"item_type":"product","product_id":"uuid","quantity":2}`.
  - Plan SaaS: `{"item_type":"saas_plan","saas_plan_id":"uuid","quantity":1}`.
  - Los planes Enterprise o sin precio anual automático devuelven error y deben tratarse por contacto comercial.
- `PATCH /api/cart/items/:id`: actualiza `quantity` de una línea del carrito `draft` propio; `quantity` debe ser mayor que cero.
- `DELETE /api/cart/items/:id`: elimina una línea del carrito `draft` propio y recalcula totales.
- `POST /api/cart/submit`: cambia el carrito de `draft` a `submitted`, genera `quote_number`, guarda `submitted_at` y registra auditoría. No permite enviar carritos vacíos.

### Descuento de distribuidor

Los clientes normales y administradores usan `discount_percent = 0`. Los usuarios con rol `distributor` solo reciben descuento cuando `store.distributor_profiles.validation_status = approved`; en ese caso se aplica el `discount_percent` del perfil. Si el distribuidor está pendiente, rechazado, suspendido o en cualquier estado distinto de `approved`, el descuento aplicado es `0`.

El descuento se calcula por línea en céntimos enteros y se refleja en `line_discount_cents`; el total agregado se guarda en `store.quotes.discount_cents`. El IVA usa el `tax_rate` del producto o plan y todos los importes se almacenan en céntimos (`subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`).

### Endpoints admin de presupuestos

Todas las rutas requieren rol `admin`.

- `GET /api/admin/quotes`: lista presupuestos con filtros opcionales `status`, `email` y `quote_number`.
- `GET /api/admin/quotes/:id`: devuelve el presupuesto con datos básicos del usuario y líneas.
- `PATCH /api/admin/quotes/:id/status`: cambia el estado administrativo a `in_review`, `sent`, `accepted`, `rejected` o `cancelled`; acepta `internal_notes` opcional. No permite modificar quotes en `draft` y registra auditoría.

### Auditoría

Se registran eventos sin payload sensible en `store.audit_log`: `cart_item_added`, `cart_item_updated`, `cart_item_removed`, `quote_submitted` y `quote_status_changed`.

### Pruebas manuales sugeridas

1. Registrar y activar un cliente, hacer login y llamar `GET /api/cart`; debe crearse un carrito `draft` vacío.
2. Añadir un producto activo con `POST /api/cart/items` y verificar subtotales, IVA y total en céntimos.
3. Añadir dos veces el mismo producto; debe incrementarse la cantidad de la línea existente.
4. Actualizar cantidad con `PATCH /api/cart/items/:id` y eliminarla con `DELETE /api/cart/items/:id`.
5. Intentar `POST /api/cart/submit` con carrito vacío; debe devolver error.
6. Enviar un carrito con líneas; debe pasar a `submitted` con `quote_number` definitivo y `submitted_at`.
7. Hacer logout/login y verificar que un carrito `draft` existente se conserva.
8. Probar distribuidor aprobado y no aprobado para confirmar que solo el aprobado recibe descuento.
9. Como admin, listar `/api/admin/quotes`, consultar un quote y cambiar estado de un quote no draft.

## Fase 5A: Frontend SPA base

La fase 5A sustituye la demo estática por una SPA React + TypeScript + Vite ubicada en `web/`. El build sigue generando `web/dist`, que es el directorio servido por Express y esperado por Docker.

### Desarrollo frontend

```bash
cd horizonst-store/web
npm ci
npm run dev
npm run typecheck
npm run build
```

El servidor Vite puede usarse contra el backend Express publicado en `http://127.0.0.1:4020`; en despliegue, Express sirve los assets compilados desde `web/dist`.

### Rutas implementadas

Públicas:

- `/`
- `/login`
- `/register`
- `/register-distributor`
- `/verify-email`
- `/forgot-password`
- `/reset-password`
- `/catalog`
- `/saas-plans`

Privadas:

- `/dashboard`
- `/account`
- `/cart`
- `/quotes`

Distribuidor:

- `/distributor`
- `/distributor/profile`
- `/distributor/documents`

Admin:

- `/admin` como placeholder protegido por rol `admin`.

### Decisiones técnicas

- Tokens encapsulados en `web/src/lib/auth.ts` para poder migrar a cookies `httpOnly` sin repartir acceso directo a `localStorage` por la aplicación.
- Cliente API centralizado en `web/src/lib/api.ts` con cabecera `Authorization: Bearer` automática, refresh token en `401`, reintento único de la petición original y limpieza de sesión si el refresh falla.
- `AuthProvider` realiza bootstrap con `GET /api/auth/me` al arrancar si hay access token, expone `loading`, `authenticated` y `user`, y permite que `ProtectedRoute` y `RoleRoute` esperen antes de decidir redirecciones.
- CSS propio en `web/src/styles.css`, sin Tailwind ni frameworks de UI pesados.

### Limitaciones conocidas y Fase 5B

- `/quotes` muestra una pantalla informativa porque todavía no hay endpoint de “mis presupuestos” para cliente/distribuidor.
- `/admin` es un placeholder; el CRUD administrativo completo queda para fases posteriores.
- `/distributor/documents` lista documentos, pero la subida multipart PDF se deja para Fase 5B para no ampliar la superficie de formularios en esta entrega.
- La sesión usa `localStorage` de forma encapsulada mientras el backend no migre a cookies `httpOnly`.
