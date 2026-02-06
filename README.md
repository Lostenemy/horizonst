# HorizonST Access Control Platform

HorizonST es una plataforma integral para la monitorización de dispositivos BLE capturados por gateways MQTT. El proyecto incluye:

- **Servidor Node.js/TypeScript** que decodifica tramas de los canales `devices/MK1`, `devices/MK2` y `devices/MK3`, aplica reglas de deduplicación basadas en tiempo y lugar y persiste la información en PostgreSQL.
- **Portal web HTML5 + JavaScript** accesible a través de `www.horizonst.com.es` con funcionalidades diferenciadas para administradores y usuarios finales.
- **Infraestructura Docker** compuesta por la aplicación, PostgreSQL, pgAdmin4 y VerneMQ. El proxy inverso Nginx se despliega
  **fuera** de Docker y expone la web en HTTPS junto con pgAdmin.
- **Microservicio de control de accesos RFID (Elecnor)** con interfaz web propia, autenticación con sesiones HTTP, paneles de tarjetas/trabajadores/cuentas/accesos/seguimiento y persistencia en una base de datos PostgreSQL dedicada creada automáticamente.

## Estado del repositorio

- `backend/`: API principal BLE/LoRa con el portal web incrustado en `backend/public` tras el build, ingestión MQTT y servicios de alarmas.
- `frontend/`: código fuente del portal HTML5 que se copia a `backend/public` durante el empaquetado.
- `rfid-access-service/`: microservicio Node.js independiente para los flujos Elecnor (accesos RFID), con frontend estático en `public/`, API Express en `src/` y persistencia en PostgreSQL.
- `mqtt-ui/`: interfaz web ligera para observabilidad básica de VerneMQ.
- `mqtt-ui-api/`: backend API (Express) que autentica usuarios y consume el sidecar interno de observabilidad.
- `vernemq-observer/`: sidecar interno que ejecuta `vmq-admin` y expone datos en JSON solo dentro de Docker.
- `db/`: esquema y seed SQL del backend principal.
- `docker-compose*.yml`: orquestaciones completas (`docker-compose.yml`) y específicas para el microservicio RFID (`docker-compose.rfid-access.yml`).
- `nginx/` y `mailserver/`: configuraciones de referencia para el proxy inverso externo y el servidor de correo.

## Requisitos

- Docker ≥ 24
- Docker Compose ≥ 2.20

## Puesta en marcha

1. **Clonar el repositorio y situarse en la raíz:**
   ```bash
   git clone <repo>
   cd horizonst
   ```

2. **Configurar variables de entorno (fuera del repositorio):**
   - Cree un `.env` en la raíz (o use secretos Docker) con las credenciales de infraestructura. Ejemplo mínimo:
     ```env
     DB_USER=horizonst
     DB_PASSWORD=defina_un_secreto
     MQTT_USER=defina_un_usuario
     MQTT_PASS=defina_un_secreto
     PGADMIN_DEFAULT_EMAIL=admin@horizonst.com.es
     PGADMIN_DEFAULT_PASSWORD=defina_un_secreto
     RFID_WEB_SESSION_SECRET=defina_un_secreto
     RFID_WEB_USERNAME=admin
     RFID_WEB_PASSWORD=defina_un_secreto
     ```
   - El contenedor de la app consume además `backend/.env`. Incluya la configuración mínima para enlazar con VerneMQ dentro de la red de Docker. `MQTT_USER`/`MQTT_PASS` son para clientes internos (app, rfid_access) y `MQTT_USERNAME`/`MQTT_PASSWORD_HASH` se usan solo para el seed de `vmq_auth_acl` en PostgreSQL:
     ```env
     MQTT_HOST=vernemq
     MQTT_PORT=1883
     MQTT_PERSISTENCE_MODE=app
     ```
     El modo `app` hace que la API se suscriba a todos los topics (`#`) y persista los mensajes en `mqtt_messages`.
   - Para enrutar los envíos de correo desde la API configure además:
     ```env
     MAIL_HOST=mail
     MAIL_PORT=465
     MAIL_SECURE=true
     MAIL_USER=no_reply@horizonst.com.es
     MAIL_PASSWORD=defina_un_secreto
     MAIL_FROM=no_reply@horizonst.com.es
     CONTACT_RECIPIENTS=contacto@horizonst.com.es,soporte@horizonst.com.es
     MAIL_EHLO_DOMAIN=horizonst.com.es
     MAIL_TLS_REJECT_UNAUTHORIZED=false
     ```
     El valor `MAIL_TLS_REJECT_UNAUTHORIZED=false` permite utilizar el certificado autofirmado generado por defecto en el contenedor `mail`. Cambie a `true` cuando cargue certificados emitidos por una CA.

3. **Construir e iniciar los servicios de aplicación y datos:**
   ```bash
   docker compose up --build -d
   ```
   Esto levantará:
   - `app`: API y portal web (puerto interno 3000).
   - `rfid_access`: microservicio Node.js que valida lecturas RFID frente a una API externa y gobierna los actuadores MQTT.
   - `postgres`: base de datos PostgreSQL inicializada con `db/schema.sql` y `db/seed.sql`.
   - `pgadmin`: consola de administración disponible en `http://localhost:5050/pgadmin4` (credenciales definidas en `.env`).
   - `vernemq`: broker MQTT expuesto en el puerto `1887` del host (sin TLS).
   - `mail` y `webmail` solo se levantan si activa el perfil `mail` (ver siguiente paso).
   - `vernemq` usa PostgreSQL como backend de autenticación y autorización mediante `vmq_diversity` y la tabla `vmq_auth_acl`. Para bases de datos existentes, aplique manualmente `db/mqtt.sql` o mediante su sistema de migraciones antes del despliegue.

### Migración en bases existentes (PostgreSQL)

El script `db/mqtt.sql` solo se ejecuta automáticamente en bases nuevas. En entornos con volumen de PostgreSQL ya inicializado, ejecute la migración manualmente:

```bash
./scripts/migrate-mqtt.sh
```

Para inspeccionar datos o ejecutar consultas manuales, use `psql` dentro del contenedor con los parámetros explícitos (evita errores tipo `role "root" does not exist`):

```bash
docker compose exec postgres psql -U "${DB_USER}" -d "${DB_NAME:-horizonst}"
```

Si necesita conectarse como superusuario del contenedor:

```bash
docker compose exec postgres psql -U postgres -d "${DB_NAME:-horizonst}"
```

Para inicializar manualmente el esquema de `vmq_auth_acl` en entornos ya desplegados:

```bash
docker compose exec -T -e PGPASSWORD="${DB_PASSWORD}" postgres \
  psql -U "${DB_USER}" -d "${DB_NAME:-horizonst}" < db/mqtt.sql
```

Verificación rápida:

```bash
docker compose exec -e PGPASSWORD="${DB_PASSWORD}" postgres \
  psql -U "${DB_USER}" -d "${DB_NAME:-horizonst}" -c "\\dt vmq_auth_acl"
```

Si quiere insertar automáticamente una identidad MQTT al crear la base de datos (solo en volúmenes nuevos), puede definir en el `.env`:

- `MQTT_CLIENT_ID`
- `MQTT_USERNAME`
- `MQTT_PASSWORD_HASH` (bcrypt completo)
- `MQTT_PUBLISH_ACL_JSON` (JSON)
- `MQTT_SUBSCRIBE_ACL_JSON` (JSON)

Con esas variables, el init script `db/mqtt-init.sh` inserta una fila en `vmq_auth_acl` durante el primer arranque.

El script `scripts/migrate-mqtt.sh` también crea/actualiza de forma idempotente la identidad de GATT Lab (`client_id` por defecto `mqtt-ui-api-gatt`) con ACL mínimas para publicar en `/MK110/+/receive` y suscribirse a `/MK110/+/send`.

### VerneMQ + PostgreSQL (vmq_diversity)

Esta instalación utiliza una imagen Docker personalizada de VerneMQ para incluir el módulo Lua `bcrypt`, requerido por el script oficial `auth/postgres.lua`.

```bash
docker compose build vernemq
docker compose up -d vernemq
```

VerneMQ utiliza el plugin `vmq_diversity` con el script oficial `/vernemq/share/lua/auth/postgres.lua`. Este script trabaja con la tabla `vmq_auth_acl` y exige `client_id` como parte de la identidad MQTT.

La imagen personalizada instala y copia `bcrypt.so` en `/vernemq/share/lua/bcrypt.so`, y el script oficial lo carga para validar hashes bcrypt.

> Nota sobre bcrypt: VerneMQ soporta hashes con prefijo `$2a$`. Si sus hashes actuales son `$2b$`, valide compatibilidad o migre los hashes.

### Ejemplos de usuarios y ACLs MQTT (vmq_auth_acl)

> Nota: VerneMQ espera hashes bcrypt completos en `password` (incluyendo el salt en el propio hash).

```sql
-- Dispositivo MQTT de ejemplo (reemplace por valores reales)
INSERT INTO vmq_auth_acl (mountpoint, client_id, username, password, publish_acl, subscribe_acl)
VALUES (
  '',
  'device-123',
  'device-123',
  '$2b$10$hash_bcrypt_de_ejemplo',
  '[{"pattern": "devices/123/tx", "qos": 1}]',
  '[{"pattern": "devices/123/rx", "qos": 1}]'
);

-- ACLs amplias bajo un prefijo específico
UPDATE vmq_auth_acl
SET publish_acl = '[{"pattern":"gateways/gw-0001/#","qos":1}]'::jsonb,
    subscribe_acl = '[{"pattern":"gateways/gw-0001/#","qos":1}]'::jsonb
WHERE client_id = 'gw-0001';
```

### Requisito del portal de administración (MQTT)

El portal de administración debe gestionar `client_id` como identidad MQTT principal y mantener una fila en `vmq_auth_acl` por cada dispositivo/gateway. Recomendación:

- exponer y permitir editar `client_id`
- mantener `username` alineado con `client_id` (al menos mientras se use la estrategia username = client_id)

4. **(Opcional) Levantar el stack de correo:**
   ```bash
   docker compose --profile mail up --build -d
   ```
   Esto levantará:
   - `mail`: servidor SMTP/IMAP basado en docker-mailserver expuesto en los puertos `25`, `465`, `587` y `993` del host.
   - `webmail`: interfaz Roundcube ligada a `http://127.0.0.1:8080/` (utilícela detrás de Nginx en producción mediante `/webmail/`).

5. **(Opcional) Lanzar únicamente el microservicio RFID:**
   Si solo necesita depurar el flujo de validación RFID, puede emplear el `docker-compose.rfid-access.yml` incluido en la raíz
   del proyecto:
   ```bash
   docker compose -f docker-compose.rfid-access.yml up --build -d
   ```
   Este archivo genera un contenedor aislado `rfid_access` dentro de su propia red `rfid_access_net`. Ajuste las variables de
   entorno `MQTT_HOST`, `MQTT_PORT`, `MQTT_USER` y `MQTT_PASS` si desea conectarse a un broker diferente al predeterminado.

6. **Acceder al portal:**
   - Durante el desarrollo puede acceder a `http://127.0.0.1:3000/`. En producción debe hacerlo a través de Nginx por `https://horizonst.com.es/`.
   - Inicie sesión con las credenciales de administrador definidas en su configuración de entorno/seed y cámbielas tras el primer inicio de sesión.

### Servidor de correo HorizonST

- La configuración de Docker Mailserver vive en `mailserver/`. Los flags del servicio (Fail2Ban, Managesieve, ClamAV/SpamAssassin, etc.) se cargan desde el `.env` raíz: copie el bloque de correo de `.env.example` al `.env` real antes de recrear el contenedor para evitar cambios involuntarios. Todos los datos persistentes se guardan en los volúmenes `mail_data`, `mail_state` y `mail_logs`.
- `mailserver/config/postfix-accounts.cf` declara (con hashes `SHA512-CRYPT`) las cuentas `notificaciones@horizonst.com.es`, `admin@horizonst.com.es` y `no_reply@horizonst.com.es`. Regenerar los hashes con `docker compose --profile mail exec mail setup password hash <usuario>` y compartir las contraseñas reales por un canal seguro; evite dejar texto plano en el repositorio.
- `mailserver/config/postfix-aliases.cf` enruta `contacto@horizonst.com.es` y `soporte@horizonst.com.es` hacia `notificaciones@horizonst.com.es` para centralizar las solicitudes del portal.
- `mailserver/fail2ban/postfix.local` amplía la directiva `ignoreip` de Fail2Ban a la subred Docker (`172.18.0.0/16`) y evita falsos positivos al acceder desde los contenedores internos. El fichero se monta en `/etc/fail2ban/jail.d/postfix.local`.
- `mailserver/roundcube/20-horizonst.php` se inyecta en `/var/roundcube/config/` y fuerza el prefijo `/webmail/`, además de indicar que TLS se termina en Nginx (`force_https = false`) y que Roundcube debe seguir usando IMAP/SMTP internos con certificados autofirmados mientras dure la fase de pruebas.
- Roundcube se expone mediante la imagen oficial `roundcube/roundcubemail:1.6.11-apache`, con sus datos (`/var/roundcube`) persistidos en el volumen `webmail_data`. Tras Nginx se publica en `https://horizonst.com.es/webmail/` mediante el snippet `nginx/snippets/roundcube.conf`, por lo que todo el HTML debe generarse bajo `/webmail/`.
- Para usar certificados reales (por ejemplo Let’s Encrypt), defina `MAIL_SSL_TYPE=manual`, `MAIL_SSL_CERT_PATH` y `MAIL_SSL_KEY_PATH` en `.env` y monte los ficheros del host en un `docker-compose.override.yml`, por ejemplo:
  ```yaml
  services:
    mail:
      volumes:
        - /etc/letsencrypt/live/mail.horizonst.com.es/fullchain.pem:/etc/ssl/certs/fullchain.pem:ro
        - /etc/letsencrypt/live/mail.horizonst.com.es/privkey.pem:/etc/ssl/private/privkey.pem:ro
  ```
  Después actualice `MAIL_SSL_CERT_PATH=/etc/ssl/certs/fullchain.pem` y `MAIL_SSL_KEY_PATH=/etc/ssl/private/privkey.pem`, y cambie `MAIL_TLS_REJECT_UNAUTHORIZED=true` en la app.
- Para firmar DKIM ejecute una vez `docker compose exec mail setup config dkim` y publique el registro TXT indicado en su DNS (`mailserver/config/opendkim/keys/`).
- Recuerde crear los registros DNS necesarios: `MX` apuntando a `mail.horizonst.com.es`, SPF (`v=spf1 mx ~all`) y, opcionalmente, DMARC (`_dmarc`). Abra en el cortafuegos los puertos TCP `25`, `465`, `587` y `993` hacia el host que ejecuta Docker.

### Procedimiento de actualización (entorno productivo)

Siga siempre los mismos pasos para aplicar cambios y evitar configuraciones divergentes:

1. `git pull`
2. `docker compose pull && docker compose up -d`
3. `docker compose --profile mail exec mail setup reload` *(solo si usa el stack de correo o reinicie el servicio mail si cambia la configuración base)*
4. `docker compose --profile mail exec webmail apachectl -k graceful`
5. `nginx -t && sudo systemctl reload nginx`

## Estructura del proyecto

```
backend/             # Servidor Node.js + TypeScript
frontend/public/     # Portal HTML5 + JS servido de forma estática
mqtt-ui/             # UI propia para VerneMQ (frontend estático)
mqtt-ui-api/         # Backend API para la UI (Express)
vernemq-observer/    # Sidecar interno para ejecutar vmq-admin
nginx/               # Configuración de referencia para el proxy inverso externo
rfid-access-service/ # Servicio independiente para control de accesos RFID mediante MQTT
db/                  # Definiciones SQL de esquema y datos iniciales
docker-compose.yml
docker-compose.rfid-access.yml
```

El portal web se mantiene en `frontend/public` y se copia a `backend/public` durante el empaquetado para que las páginas estáticas acompañen a la API.

## Observabilidad VerneMQ (UI)

La UI se despliega como un frontend estático (`mqtt-ui`) y un backend API (`mqtt-ui-api`) que consulta un sidecar interno (`vernemq-observer`) basado en `vmq-admin`. El broker no se expone directamente.

### URL de acceso

- `https://mqtt-ui.horizonst.com.es`

### Arquitectura

- **VerneMQ**: broker en ejecución sin API HTTP pública.
- **vernemq_observer**: sidecar interno que ejecuta `vmq-admin` y expone JSON solo dentro de la red Docker.
- **mqtt_ui_api**: backend protegido con JWT que consume el sidecar.
- **mqtt_ui**: frontend estático que consulta la API.

Flujo: `UI → API → Observer → vmq-admin`.

### Puertos

- UI: `127.0.0.1:8090`
- API: `127.0.0.1:4010`

> En producción, publique ambos servicios detrás de Nginx en HTTPS y no exponga `vernemq_observer`.

### Flujo de despliegue (obligatorio)

```bash
cp .env.example .env
docker compose up -d --build
```

No edite `.env` manualmente; los valores salen del `.env.example`.

### Variables de entorno necesarias

Defina en el `.env` de infraestructura (o secretos Docker):

```env
# Credenciales de acceso a la UI (backend)
MQTT_UI_ADMIN_USER=defina_un_usuario
MQTT_UI_ADMIN_PASSWORD=defina_un_secreto
MQTT_UI_JWT_SECRET=defina_un_secreto_largo

# Valores por defecto en .env.example
# MQTT_UI_ADMIN_USER=admin
# MQTT_UI_ADMIN_PASSWORD=20025@BLELoRa
# MQTT_UI_JWT_SECRET=change_me_random_secret

# Sidecar interno de observabilidad (vmq-admin)
VMQ_OBSERVER_BASE_URL=http://vernemq_observer:4040
VMQ_OBSERVER_STATUS_PATH=/status
VMQ_OBSERVER_METRICS_PATH=/metrics
VMQ_OBSERVER_LISTENERS_PATH=/listeners
VMQ_OBSERVER_CLUSTER_PATH=/cluster
VMQ_OBSERVER_TIMEOUT_MS=4000

# Diagnóstico MQTT TLS
MQTT_DIAG_HOST=mqtt.horizonst.com.es
MQTT_DIAG_PORT=8883

# GATT Lab (MKGW3 via MQTT)
GATT_DEFAULT_PASS=Moko4321
GATT_TIMEOUT_MS=10000
GATT_RATE_LIMIT_WINDOW_MS=60000
GATT_RATE_LIMIT_MAX=20
GATT_MQTT_HOST=vernemq
GATT_MQTT_PORT=1883
GATT_MQTT_TLS=false
GATT_MQTT_REJECT_UNAUTHORIZED=true
GATT_MQTT_USERNAME=
GATT_MQTT_PASSWORD=
# Si se dejan vacíos, mqtt_ui_api usa MQTT_USER / MQTT_PASS
GATT_MQTT_CLIENT_ID=mqtt-ui-api-gatt
GATT_MQTT_SUB_TOPIC_PATTERN=/MK110/{gatewayMac}/receive
GATT_MQTT_PUB_TOPIC_SUBSCRIBE=/MK110/+/send
GATT_CONNECT_EXPECTED_MSG_IDS=2500,3501
GATT_INQUIRE_DEVICE_INFO_EXPECTED_MSG_IDS=2502,3502
GATT_INQUIRE_STATUS_EXPECTED_MSG_IDS=2504,3504
GATT_SSE_TICKET_TTL_MS=60000
```

> Si modifica la configuración de red del broker, asegúrese de que el sidecar sigue pudiendo ejecutar `vmq-admin` localmente.

### Credenciales por defecto

- Usuario: `admin`
- Contraseña: `20025@BLELoRa`

### Flujo de login

1. Acceda a `https://mqtt-ui.horizonst.com.es`.
2. Inicie sesión con las credenciales definidas en `.env.example` (o sus secretos).
3. La UI obtiene un JWT y lo envía como `Authorization: Bearer <token>` a `mqtt_ui_api`.

### Seguridad

- La UI está protegida por JWT (login en `mqtt_ui_api`).
- No exponga `vernemq_observer` fuera de la red Docker.
- Cambie las credenciales por defecto en producción.

### GATT Lab (`/gatt-lab`)

Nueva pantalla de laboratorio para pruebas BLE/GATT a través de gateways MKGW3 usando MQTT:

- Formulario con `Gateway MAC`, `Beacon MAC` y `password` (MVP BXP-S).
- Acciones MVP:
  - `Connect (BXP-S)` → envía `msg_id: 1500` con `data.mac` + `data.passwd`.
  - `Inquire device info` → envía `msg_id: 1502`.
  - `Inquire status` → envía `msg_id: 1504`.
- Consola en tiempo real con:
  - request JSON enviado,
  - ACK/reply directo (`result_code`/`result_msg` si los envía la gateway),
  - notificaciones `3xxx` recibidas por `pub_topic`.

Flujo MQTT para MKGW3:

- Downlink (cloud → gateway): publicación en `sub_topic` (por defecto `/MK110/<gatewayMac>/receive`).
- Uplink (gateway → cloud): escucha en `pub_topic` (por defecto patrón `/MK110/+/send`).

- Autenticación MQTT: `mqtt_ui_api` reutiliza por defecto `MQTT_USER` / `MQTT_PASS` para conectar a VerneMQ interno (puede sobrescribirse con `GATT_MQTT_USERNAME` / `GATT_MQTT_PASSWORD`).
- `client_id` MQTT de GATT Lab: por defecto `mqtt-ui-api-gatt`. Debe existir en `vmq_auth_acl` con ACL mínimas: publish `/MK110/+/receive` y subscribe `/MK110/+/send` (el script `scripts/migrate-mqtt.sh` lo aplica de forma idempotente).

Correlación de respuestas: `gatewayMac` + `beaconMac` + `msg_id esperado` + timeout (`GATT_TIMEOUT_MS`). Para cada comando se aceptan IDs de ACK/notify configurables (`GATT_*_EXPECTED_MSG_IDS`).

### Servicios involucrados

- `vernemq_observer`
- `mqtt_ui_api`
- `mqtt_ui`

### Endpoints expuestos por `mqtt_ui_api`

- `POST /api/login` → devuelve JWT.
- `GET /api/status` → estado del nodo y listeners (sidecar vmq-admin).
- `GET /api/metrics` → métricas (sidecar vmq-admin).
- `GET /api/diagnostics` → comprobación TLS contra `mqtt.horizonst.com.es:8883` y estado del cluster (sidecar vmq-admin).
- `POST /api/gatt/connect` → publica `msg_id:1500` (connect beacon BXP-S) y espera reply.
- `POST /api/gatt/inquire-device-info` → publica `msg_id:1502` y espera reply.
- `POST /api/gatt/inquire-status` → publica `msg_id:1504` y espera reply.
- `POST /api/gatt/stream-ticket` → emite ticket efímero para SSE (evita JWT en query param).
- `GET /api/gatt/stream` → SSE con requests/replies/notifies (requiere ticket efímero).
- `GET /health` → estado de la API.

La UI consume estos endpoints y nunca expone credenciales MQTT.

### Compatibilidad de rutas (Nginx host)

- `/` → `mqtt_ui` (8090)
- `/api/*` → `mqtt_ui_api` (4010)
- `/mqtt-ui-api/*` → `mqtt_ui_api` (compatibilidad del frontend actual)

## Funcionalidades principales

### Ingesta y procesamiento MQTT

- Suscripción automática a `devices/MK1`, `devices/MK2`, `devices/MK3` mediante un cliente MQTT configurado con las credenciales proporcionadas.
- Monitorización adicional de `devices/RF1` para lecturas RFID procedentes de los lectores Elecnor.
- Decodificadores específicos para cada canal, normalizando campos como `BaTtVol`/`BattVoltage`.
- Validación de gateways y dispositivos registrados antes de persistir lecturas.
- Reglas de consolidación por lugar: lecturas con menos de 30 s se ignoran, entre 30 s y 5 min actualizan el registro anterior y, superados 5 min, se genera uno nuevo.
- Almacenamiento del histórico en `device_records` y actualización del estado en `devices`.

### Portal web

- **Administradores** pueden registrar gateways y dispositivos, consultar mensajes MQTT, revisar históricos completos y gestionar alarmas.
- **Administradores** disponen además de un módulo RFID para asociar IDs de tarjeta con trabajadores (DNI, nombre, apellidos, empresa y código de centro) y revisar el histórico de lecturas.
- **Usuarios** gestionan lugares, categorías, asignación de dispositivos y fotos, así como reclamación de dispositivos por MAC.
- Visualizaciones agrupadas por lugar y herramientas para configurar alarmas basadas en tiempo sin señal.
- El formulario público de contacto envía las solicitudes mediante `POST /api/contact`, almacenando una copia en `notificaciones@horizonst.com.es` y mostrando confirmaciones en la propia página.

### Alarmas

- Configuraciones flexibles por dispositivo, categoría o lugar con umbrales configurables.
- Monitor de alarmas en segundo plano que genera y resuelve alertas automáticamente.
- Gestión de grupos de usuarios que pueden reconocer y cerrar alarmas.

## Arquitectura de despliegue

- **Nginx (host):** sirve la aplicación en HTTPS y publica pgAdmin (`/pgadmin`). Redirige automáticamente las peticiones HTTP (80) a HTTPS (443).
- Incluya el snippet `nginx/snippets/roundcube.conf` dentro del `server` HTTPS (por ejemplo `include snippets/roundcube.conf;`) para servir `https://horizonst.com.es/webmail/` con `proxy_buffering off`, `client_max_body_size 25m` y las cabeceras `X-Forwarded-*`. Este bloque también termina TLS, motivo por el cual Roundcube mantiene `force_https = false` y confía en `X-Forwarded-Proto`/`X-Forwarded-Prefix`. Mantenga publicados los puertos TCP `25`, `465`, `587` y `993` del host para el servicio SMTP/IMAP.
- **Docker Compose (loopback):** la app, PostgreSQL y pgAdmin solo escuchan en `127.0.0.1`. VerneMQ expone el puerto `1887` hacia el exterior sin TLS.
- **Supervisión:** la API expone `GET /health` y los servicios incluyen healthchecks y rotación de logs (`json-file`, 50 MB × 3).

## MQTT Broker (VerneMQ)

- **Acceso externo:** `mqtt://<dominio-o-ip>:1887` (sin TLS). Cree usuarios/contraseñas específicos para clientes finales.
- **Acceso interno (app → VerneMQ):** `mqtt://vernemq:1883` gracias al fichero `backend/.env`.
- **Autenticación y ACL:** VerneMQ valida dispositivos contra `vmq_auth_acl` (bcrypt) y evalúa ACLs JSON con política *deny by default* mediante `vmq_diversity`.
- **Persistencia de mensajes:** por defecto la API guarda los payloads recibidos en `mqtt_messages`.
- **Pruebas rápidas (Windows/Linux):**
  - *MQTTX:* configure un perfil con host `<dominio>` y puerto `1887`, suscríbase a `test/#` y publique en `test/ping`.
  - *Mosquitto CLI:*
    ```bash
    mosquitto_sub -h <dominio> -p 1887 -t test/# -u <usuario> -P <contraseña>
    mosquitto_pub -h <dominio> -p 1887 -t test/ping -m "hello" -u <usuario> -P <contraseña>
    ```
  - **Diagnóstico:** consulte logs con `docker compose logs -f vernemq` y reinicie el broker con `docker compose restart vernemq` si modifica las variables de entorno.

### Arranque de VerneMQ (console mode)

VerneMQ se ejecuta en modo consola para poder ver errores reales de Erlang. En Docker Compose esto requiere TTY y STDIN abiertos incluso en modo `-d`:

```
command:
  - /vernemq/bin/vernemq
  - console
stdin_open: true
tty: true
```

Sin TTY/STDIN el contenedor puede entrar en restart loop silencioso.

### Hostname Erlang (FQDN obligatorio)

VerneMQ usa Erlang distribuido y requiere hostname FQDN. Por eso:

```
hostname: vernemq.local
```

Y en `vernemq/vm.args`:

```
-name VerneMQ@vernemq.local
-setcookie vmq
```

Sin FQDN, `vmq-admin` y el cluster fallan.

### EULA de VerneMQ (bloqueante)

Debe aceptarse la EULA para que VerneMQ arranque:

```
DOCKER_VERNEMQ_ACCEPT_EULA: "yes"
```

Y/o en `vernemq/vernemq.conf`:

```
accept_eula = yes
```

### Listener MQTT (no es automático)

Si no se configura un listener, VerneMQ no expone MQTT. Configuración mínima:

```
listener.tcp.default = 0.0.0.0:1883
listener.tcp.allowed_protocol_versions = 3,4,5
```

Puertos:

- Interno: `1883`
- Externo: `1887`

### Healthcheck (crítico)

El healthcheck correcto es:

```
healthcheck:
  test: ["CMD", "/vernemq/bin/vmq-admin", "cluster", "show"]
  interval: 10s
  timeout: 5s
  retries: 10
```

⚠️ `vmq-admin status` **NO existe** en esta versión y `vmq-admin` **no está en PATH**. El comando que devuelve exit 0 es `/vernemq/bin/vmq-admin cluster show`.

### Verificación post-despliegue

```bash
# Estado del contenedor
docker ps --filter "name=horizonst-vernemq"

# Listener MQTT
docker exec -it horizonst-vernemq-1 /vernemq/bin/vmq-admin listener show

# Estado del cluster
docker exec -it horizonst-vernemq-1 /vernemq/bin/vmq-admin cluster show
```

Resultado esperado:

- Listener `tcp/default` en `0.0.0.0:1883`
- Nodo `VerneMQ@vernemq.local` en `Running true`
- Contenedor `healthy`

### Nota de arquitectura

VerneMQ no se expone directamente a Internet. La exposición exterior se hará vía Nginx (TCP stream) y TLS. El listener TLS (8883) se configurará en un paso posterior.

## Servicio de control de accesos RFID

El contenedor `rfid_access` procesa los eventos publicados por los lectores RFID, consulta una API REST externa para validar el acceso y, según la respuesta, envía órdenes al actuador (luces verde/roja y alarma) mediante nuevos topics MQTT.

- **Suscripción y actuadores:** escucha `devices/RF1` por defecto (`RFID_READER_TOPIC`) y publica en `rfid/{mac}/actuators/green`, `rfid/{mac}/actuators/red` y `rfid/{mac}/actuators/alarm` (formato `json` o `text` según `RFID_COMMAND_PAYLOAD_FORMAT`). La antena 1 se interpreta como entrada y la 2 como salida, propagando esa dirección a las decisiones y al histórico. Si el topic no incluye comodines ni la MAC en el payload, se toma el último segmento del topic (por ejemplo `RF1` en `devices/RF1`) como identificador del lector.
- **Autenticación externa y documentación:** delega la validación en `RFID_AUTH_API_URL` recibiendo `{ dni, cardId, readerMac }`; acepta `accepted: true` o estados `ACCEPTED`/`GRANTED`. Solo en accesos de entrada se comprueba la documentación del usuario; si falta o está pendiente se devuelve `MISSING_DOCUMENTATION` y se deniega el acceso.
- **Directorio MAC↔DNI:** admite inline JSON (`RFID_MAC_DNI_MAP`), fichero (`RFID_MAC_DNI_FILE`) o directorio remoto (`RFID_MAC_DNI_DIRECTORY_URL`) con refresco (`RFID_MAC_DNI_REFRESH_MS`) y estrategia `eager`/`on-demand` (`RFID_MAC_DNI_LOOKUP_STRATEGY`).
- **Salud y despliegue:** `GET /health` responde con "{"status":"ok"}" y la interfaz HTTP se sirve en `HTTP_PORT` (3001 por defecto) y `BASE_PATH` (`/elecnor`).
- **Control GPIO de lectores Keonn:** cuando la API externa devuelve *acceso permitido* se enciende el GPO 1 durante 5 s; con *acceso denegado* se activan los GPO 2 (10 s) y 3 (5 s) de forma concurrente. Las peticiones se envían vía `GET {baseUrl}/devices/{deviceId}/setGPO/{line}/{state}` (modo múltiple) o `GET {baseUrl}/device/setGPO/{line}/{state}` (modo de único dispositivo) y adjuntan la autenticación configurada: Digest MD5 por defecto (`RFID_READER_CONTROLLER_AUTH=digest`) o Basic si se selecciona. Usa `RFID_READER_CONTROLLER_USER`/`RFID_READER_CONTROLLER_PASSWORD` (o rellena usuario/contraseña en la consola de pruebas) para generar la cabecera; si no se requiere autenticación ajusta `RFID_READER_CONTROLLER_AUTH=none`. Configura `RFID_READER_CONTROLLER_BASE_URL`, `RFID_READER_DEVICE_ID` (solo modo múltiple), `RFID_READER_SINGLE_DEVICE_MODE`, `RFID_READER_CONTROLLER_TIMEOUT` y `RFID_READER_CONTROLLER_ENABLED` para activar el control; si falta la URL base, el `device-id` (en modo múltiple) o el flag está en `false`, el módulo queda deshabilitado sin bloquear el resto del flujo. Las pruebas manuales admiten las líneas 1 a 8 además de los escenarios automáticos.
- **Tipos locales para `digest-fetch`:** como no existe el paquete `@types/digest-fetch` en npm, el servicio incluye una declaración minimalista en `rfid-access-service/src/types/digest-fetch.d.ts` y referencia esta carpeta como `typeRoots` en `tsconfig.json`. No añadas `@types/digest-fetch` al `package.json` para evitar fallos de instalación en producción.
- **Dependencias del cliente del lector:** `digest-fetch` necesita `node-fetch` en tiempo de ejecución para que las peticiones con autenticación Digest funcionen; se incluye como dependencia de producción junto con el shim de tipos local en `rfid-access-service/src/types/digest-fetch.d.ts` (no existe `@types/digest-fetch` en npm, así que no lo añadas al `package.json`).
- **Pruebas manuales de GPIO:** los administradores disponen de la pantalla `/elecnor-gpo.html` (link "GPIO" en la barra superior) para lanzar pulsos directos al lector sin pasar por la lógica de accesos. Usa los endpoints protegidos `/api/gpo/status`, `/api/gpo/test/scenario` (escenarios permitido/denegado) y `/api/gpo/test/line` (acciones `on`/`off`/`pulse` por línea, con duración configurable en ms) con selector de líneas 1–8. Si falta la URL base o el `device-id` (cuando el modo múltiple está activo), la pantalla muestra un aviso indicando las variables (`RFID_READER_CONTROLLER_BASE_URL`, `RFID_READER_DEVICE_ID`) o el modo (`RFID_READER_SINGLE_DEVICE_MODE`) que debes ajustar y los endpoints devuelven `GPO_DISABLED` para evitar confusión. Bajo los controles verás la última respuesta JSON combinada del backend y del lector (payloads devueltos por `setGPO`) ocupando todo el ancho del cuerpo para validar rápidamente qué devuelve cada llamada e incluyendo la URL exacta que se envió a `/setGPO` destacada antes del JSON. El panel incluye formularios para URL base, selección de modo de ruta (múltiple o único dispositivo), `deviceId` y usuario/contraseña, además de un selector de tipo de autenticación (Digest/Basic/Sin auth) para replicar exactamente lo que funciona en Postman y evitar 401; dejar usuario y contraseña vacíos borra las credenciales activas.
- **URL base editable para pruebas:** desde la misma pantalla de GPIO puedes introducir otra IP/URL de lector (por ejemplo `http://88.20.2.60`) sin tocar el fichero `.env`. El cambio se aplica de inmediato a los botones de prueba manual y permanece activo hasta que reinicies el servicio o lo vuelvas a modificar.
- **Normalización de la URL del lector:** el servicio recorta rutas anexas y conserva únicamente el host y puerto al guardar la URL base, así evitas formar rutas duplicadas si pegas una dirección completa de ejemplo (`http://88.20.2.60/device/setGPO/6/false`). En modo de dispositivo único seguiremos construyendo internamente `/device/setGPO/{line}/{state}` sobre el host proporcionado.

### Base de datos y API del portal Elecnor

- **Persistencia dedicada:** el servicio crea automáticamente la base de datos `RFID_DB_NAME` (por defecto `rfid_access`) en PostgreSQL usando el usuario definido y el catálogo administrador `RFID_DB_ADMIN_DB`. Genera las tablas `app_users`, `workers` y `cards` si no existen y precarga ejemplos de trabajadores/tarjetas cuando están vacías para facilitar las pruebas iniciales.
- **Autenticación y roles:** al arrancar se asegura un usuario administrador con `RFID_WEB_USERNAME`/`RFID_WEB_PASSWORD` (por defecto `admin/admin`). La API expone `/api/login`, `/api/logout` y `/api/session` con sesiones HTTP, además de CRUD protegidos para usuarios (`/api/auth/users`), trabajadores (`/api/workers`) y tarjetas (`/api/cards`). El microservicio valida que siempre quede al menos un administrador activo.
- **Pruebas contra la API externa:** los endpoints `/api/ecoordina/defaults` y `/api/ecoordina/test` devuelven o lanzan peticiones reales a la API de e-coordina usando los valores configurados (`ECOORDINA_*`), devolviendo un resumen de la solicitud y la respuesta procesada.

### Interfaz web Elecnor

- **Páginas disponibles:** Tarjetas, Accesos (antes Webservice), Seguimiento y Trabajadores están habilitadas para usuarios estándar; los administradores ven también la gestión de cuentas (usuarios) y controles avanzados. La navegación superior muestra u oculta enlaces según el rol de sesión.
- **Flujos y accesibilidad:** los formularios incluyen etiquetas asociadas, validación visual, búsquedas con debounce, chips de estado y toasts de éxito/error. Las acciones destructivas piden confirmación y todas las páginas comparten estilos y espaciados homogéneos.
- **Base path:** el HTML se sirve con `<base href="__BASE_PATH__/">` y scripts auxiliares reescriben enlaces para funcionar bajo el `BASE_PATH` definido en entorno (por defecto `/elecnor`).
- **Autenticación web:** la pantalla `index.html` solicita las credenciales del microservicio y, tras iniciar sesión, persiste la sesión en cookie HTTP-only. El botón “Desconectar” de la barra superior invalida la sesión y redirige al login respetando el `BASE_PATH`.

### Integración RFID Elecnor

- El backend principal también consume el topic `devices/RF1` para las lecturas procedentes de los lectores Elecnor.
- Cada tarjeta puede registrarse desde la pestaña **RFID** del portal (solo administradores), indicando DNI, nombre y apellidos, empresa/CIF y código de centro. Solo se envían a `https://ws.e-coordina.com/1.4` (`action=acceso.permitido_data`) los campos de centro, CIF y DNI, encapsulados dentro del bloque `data={"data":{...}}`; el resto de datos quedan como referencia local.
- Tras cada lectura el sistema consulta la API (`user`/`token` configurables) y registra el resultado en `rfid_access_logs`, mostrando el histórico en la propia interfaz.
- Dependiendo del campo `acceso` (`1` verde / `0` rojo) se publica un comando MQTT que activa el GPIO 6 o 7 del lector; si la API falla, el intento queda almacenado con el error correspondiente y se fuerza el GPIO rojo.
- Ajuste las variables `RFID_ACCESS_*` y `RFID_GPIO_*` en `backend/.env` para definir el topic a vigilar, las credenciales del servicio remoto, tiempos de espera y el formato de los comandos enviados al lector.

## Proxy inverso Nginx externo

La carpeta `nginx/` contiene `horizonst.example.conf` como referencia. El bloque aplica redirección HTTP→HTTPS, cabeceras de seguridad y publica la app (`127.0.0.1:3000`) junto con `/pgadmin/`. Adapte certificados y rutas a su entorno y mantenga la configuración MQTT por TCP/1887 en el host.

## Scripts útiles

- **Compilar backend localmente:**
  ```bash
  cd backend
  npm ci
  npm run typecheck
  npm run build
  npm run start
  ```

- **Ejecución de consultas:** utilice pgAdmin o cualquier cliente PostgreSQL contra `postgres:5432` con las credenciales indicadas.

## Seguridad

- Cambie el secreto JWT (`JWT_SECRET`), los usuarios/contraseñas por defecto de la app, las cuentas MQTT y pgAdmin antes de llegar a producción.
- Mantenga expuestos únicamente los puertos 80/443/1887. El resto de servicios permanecen en `127.0.0.1` y detrás de Docker.
- Añada el endpoint `/health` a sus comprobaciones y monitorice los healthchecks configurados en `docker-compose.yml`.
- Revise periódicamente los logs rotados (`json-file`, 50 MB × 3) y establezca alertas según sus políticas corporativas.

## Licencia

Este proyecto se entrega como referencia técnica para HorizonST. Ajuste y amplíe según las necesidades operativas de su organización.
