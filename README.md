# HorizonST Access Control Platform

HorizonST es una plataforma integral para la monitorización de dispositivos BLE capturados por gateways MQTT. El proyecto incluye:

- **Servidor Node.js/TypeScript** que decodifica tramas de los canales `devices/MK1`, `devices/MK2` y `devices/MK3`, aplica reglas de deduplicación basadas en tiempo y lugar y persiste la información en PostgreSQL.
- **Portal web HTML5 + JavaScript** accesible a través de `www.horizonst.com.es` con funcionalidades diferenciadas para administradores y usuarios finales.
- **Infraestructura Docker** compuesta por la aplicación, PostgreSQL, pgAdmin4 y EMQX. El proxy inverso Nginx se despliega
  **fuera** de Docker y expone la web en HTTPS junto con los paneles de EMQX y pgAdmin.

## Requisitos

- Docker ≥ 24
- Docker Compose ≥ 2.20

## Puesta en marcha

1. **Clonar el repositorio y situarse en la raíz:**
   ```bash
   git clone <repo>
   cd horizonst
   ```

2. **Configurar variables opcionales:**
  - El contenedor de la app consume el fichero `backend/.env`. Incluye la configuración mínima para enlazar con EMQX dentro de la red de Docker y exponer las credenciales del panel para la integración de auditoría:
     ```env
     MQTT_HOST=emqx
     MQTT_PORT=1883
     MQTT_PERSISTENCE_MODE=app
     EMQX_MGMT_HOST=emqx
     EMQX_MGMT_PORT=18083
     EMQX_MGMT_USERNAME=admin
     EMQX_MGMT_PASSWORD=20025@BLELoRa
     EMQX_MGMT_SSL=false
     ```
    El modo `app` hace que la API se suscriba a todos los topics (`#`) y persista los mensajes en `mqtt_messages`. Cambie a `MQTT_PERSISTENCE_MODE=emqx` únicamente si su instancia de EMQX dispone de conectores PostgreSQL (por ejemplo, la edición Enterprise) o ha configurado un bridge compatible manualmente. Si el broker rechaza el conector, la aplicación continuará automáticamente con la persistencia local.
   - Para enrutar los envíos de correo desde la API configure además (los valores por defecto utilizan el buzón `no_reply@horizonst.com.es` para envíos automatizados):
     ```env
     MAIL_HOST=mail
     MAIL_PORT=465
     MAIL_SECURE=true
     MAIL_USER=no_reply@horizonst.com.es
     MAIL_PASSWORD=No_reply#2024
     MAIL_FROM=no_reply@horizonst.com.es
     CONTACT_RECIPIENTS=contacto@horizonst.com.es,soporte@horizonst.com.es
     MAIL_EHLO_DOMAIN=horizonst.com.es
     MAIL_TLS_REJECT_UNAUTHORIZED=false
     ```
     El valor `MAIL_TLS_REJECT_UNAUTHORIZED=false` permite utilizar el certificado autofirmado generado por defecto en el contenedor `mail`. Cambie a `true` cuando cargue certificados emitidos por una CA.

3. **Construir e iniciar todos los servicios de aplicación y datos:**
   ```bash
   docker compose up --build -d
   ```
   Esto levantará:
  - `app`: API y portal web (puerto interno 3000).
  - `rfid_access`: microservicio Node.js que valida lecturas RFID frente a una API externa y gobierna los actuadores MQTT.
   - `postgres`: base de datos PostgreSQL inicializada con `db/schema.sql` y `db/seed.sql`.
   - `pgadmin`: consola de administración disponible en `http://localhost:5050/pgadmin4` (usuario: `admin@horizonst.com.es`, contraseña: `admin`).
   - `emqx`: broker MQTT expuesto en el puerto `1887` del host (sin TLS) y con dashboard interno en `http://127.0.0.1:18083/`.
   - `mail`: servidor SMTP/IMAP basado en docker-mailserver expuesto en los puertos `25`, `465`, `587` y `993` del host.
   - `webmail`: interfaz Roundcube ligada a `http://127.0.0.1:8080/` (utilícela detrás de Nginx en producción mediante `/webmail/`).

4. **(Opcional) Lanzar únicamente el microservicio RFID:**
   Si solo necesita depurar el flujo de validación RFID, puede emplear el `docker-compose.rfid-access.yml` incluido en la raíz
   del proyecto:
   ```bash
   docker compose -f docker-compose.rfid-access.yml up --build -d
   ```
   Este archivo genera un contenedor aislado `rfid_access` dentro de su propia red `rfid_access_net`. Ajuste las variables de
   entorno `MQTT_HOST`, `MQTT_PORT`, `MQTT_USER` y `MQTT_PASS` si desea conectarse a un broker diferente al predeterminado.

5. **Acceder al portal:**
   - Durante el desarrollo puede acceder a `http://127.0.0.1:3000/`. En producción debe hacerlo a través de Nginx por `https://horizonst.com.es/`.
   - Inicie sesión con:
     - Usuario: `admin@horizonst.com.es`
     - Contraseña: `Admin@2024`
   - Cambie la contraseña del administrador tras el primer inicio de sesión.

### Servidor de correo HorizonST

- La configuración de Docker Mailserver vive en `mailserver/`. El fichero `mailserver.env` habilita Fail2Ban y Managesieve y deja desactivados ClamAV/SpamAssassin para reducir consumo. Todos los datos persistentes se guardan en los volúmenes `mail_data`, `mail_state` y `mail_logs`.
- `mailserver/config/postfix-accounts.cf` declara (con hashes `SHA512-CRYPT`) las cuentas `notificaciones@horizonst.com.es`, `admin@horizonst.com.es` y `no_reply@horizonst.com.es`. Regenerar los hashes con `docker compose exec mail setup password hash <usuario>` y compartir las contraseñas reales por un canal seguro; evite dejar texto plano en el repositorio.
- `mailserver/config/postfix-aliases.cf` enruta `contacto@horizonst.com.es` y `soporte@horizonst.com.es` hacia `notificaciones@horizonst.com.es` para centralizar las solicitudes del portal.
- `mailserver/fail2ban/postfix.local` amplía la directiva `ignoreip` de Fail2Ban a la subred Docker (`172.18.0.0/16`) y evita falsos positivos al acceder desde los contenedores internos. El fichero se monta en `/etc/fail2ban/jail.d/postfix.local`.
- `mailserver/roundcube/20-horizonst.php` se inyecta en `/var/roundcube/config/` y fuerza el prefijo `/webmail/`, además de indicar que TLS se termina en Nginx (`force_https = false`) y que Roundcube debe seguir usando IMAP/SMTP internos con certificados autofirmados mientras dure la fase de pruebas.
- Roundcube se expone mediante la imagen oficial `roundcube/roundcubemail:1.6.11-apache`, con sus datos (`/var/roundcube`) persistidos en el volumen `webmail_data`. Tras Nginx se publica en `https://horizonst.com.es/webmail/` mediante el snippet `nginx/snippets/roundcube.conf`, por lo que todo el HTML debe generarse bajo `/webmail/`.
- Para firmar DKIM ejecute una vez `docker compose exec mail setup config dkim` y publique el registro TXT indicado en su DNS (`mailserver/config/opendkim/keys/`).
- Recuerde crear los registros DNS necesarios: `MX` apuntando a `mail.horizonst.com.es`, SPF (`v=spf1 mx ~all`) y, opcionalmente, DMARC (`_dmarc`). Abra en el cortafuegos los puertos TCP `25`, `465`, `587` y `993` hacia el host que ejecuta Docker.

### Procedimiento de actualización (entorno productivo)

Siga siempre los mismos pasos para aplicar cambios y evitar configuraciones divergentes:

1. `git pull`
2. `docker compose pull && docker compose up -d`
3. `docker compose exec mail setup reload` *(o reinicie el servicio mail si cambia la configuración base)*
4. `docker compose exec webmail apachectl -k graceful`
5. `nginx -t && sudo systemctl reload nginx`

## Estructura del proyecto

```
backend/             # Servidor Node.js + TypeScript
frontend/public/     # Portal HTML5 + JS servido de forma estática
nginx/               # Configuración de referencia para el proxy inverso externo
rfid-access-service/ # Servicio independiente para control de accesos RFID mediante MQTT
db/                  # Definiciones SQL de esquema y datos iniciales
docker-compose.yml
docker-compose.rfid-access.yml
```

El portal web se mantiene en `frontend/public` y se copia a `backend/public` durante el empaquetado para que las páginas estáticas acompañen a la API.

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

- **Nginx (host):** sirve la aplicación en HTTPS y publica los paneles de EMQX (`/emqx`) y pgAdmin (`/pgadmin`). Redirige automáticamente las peticiones HTTP (80) a HTTPS (443).
- Incluya el snippet `nginx/snippets/roundcube.conf` dentro del `server` HTTPS (por ejemplo `include snippets/roundcube.conf;`) para servir `https://horizonst.com.es/webmail/` con `proxy_buffering off`, `client_max_body_size 25m` y las cabeceras `X-Forwarded-*`. Este bloque también termina TLS, motivo por el cual Roundcube mantiene `force_https = false` y confía en `X-Forwarded-Proto`/`X-Forwarded-Prefix`. Mantenga publicados los puertos TCP `25`, `465`, `587` y `993` del host para el servicio SMTP/IMAP.
- **Docker Compose (loopback):** la app, PostgreSQL y pgAdmin solo escuchan en `127.0.0.1`. EMQX expone el puerto `1887` hacia el exterior sin TLS y mantiene el dashboard ligado al loopback (`127.0.0.1:18083`).
- **Supervisión:** la API expone `GET /health` y los servicios incluyen healthchecks y rotación de logs (`json-file`, 50 MB × 3).

## MQTT Broker (EMQX)

- **Acceso externo:** `mqtt://<dominio-o-ip>:1887` (sin TLS). Cree usuarios/contraseñas específicos para clientes finales.
- **Acceso interno (app → EMQX):** `mqtt://emqx:1883` gracias al fichero `backend/.env`.
- **Panel de control:** disponible en `https://horizonst.com.es/emqx/` tras Nginx. No abra el puerto 18083 de manera directa.
- **Persistencia de mensajes:** por defecto la API guarda los payloads recibidos en `mqtt_messages`. Si configura `MQTT_PERSISTENCE_MODE=emqx` y el broker soporta conectores `pgsql`, el servicio intentará delegar la ingesta vía REST en EMQX; en caso contrario mantendrá el modo local sin bloquear el arranque.
- **Pruebas rápidas (Windows):**
  - *MQTTX:* configure un perfil con host `<dominio>` y puerto `1887`, suscríbase a `test/#` y publique en `test/ping`.
  - *Mosquitto CLI:*
    ```powershell
    mosquitto_sub -h <dominio> -p 1887 -t test/# -u <usuario> -P <contraseña>
    mosquitto_pub -h <dominio> -p 1887 -t test/ping -m "hello" -u <usuario> -P <contraseña>
    ```

## Servicio de control de accesos RFID

El contenedor `rfid_access` se encarga de procesar los eventos MQTT publicados por los lectores RFID y de consultar una API REST
externa que confirmará o denegará el acceso. Según la respuesta, el servicio envía órdenes al actuador (luces verde/roja y
alarma) mediante nuevos topics MQTT.

- **Suscripción:** por defecto escucha `rfid/readers/+/scan` (configurable vía `RFID_READER_TOPIC`).
- **Autenticación externa:** realice peticiones `POST` a `RFID_AUTH_API_URL` con los datos `{ dni, cardId, readerMac }`. El
  servicio interpreta como aceptación un `accepted: true` o un `status`/`result` igual a `ACCEPTED`/`GRANTED`.
- **Control de actuadores:** publica comandos en `rfid/{mac}/actuators/green`, `rfid/{mac}/actuators/red` y
  `rfid/{mac}/actuators/alarm`. El formato puede ser `json` o `text` (`RFID_COMMAND_PAYLOAD_FORMAT`).
- **Mapeo MAC ↔ DNI:** configure `RFID_MAC_DNI_MAP` con un JSON o lista `mac=dni`, y opcionalmente complemente con un fichero (`RFID_MAC_DNI_FILE`) o un directorio remoto (`RFID_MAC_DNI_DIRECTORY_URL`) que se recarga periódicamente (`RFID_MAC_DNI_REFRESH_MS`). El modo `RFID_MAC_DNI_LOOKUP_STRATEGY` permite precargar los datos o consultarlos bajo demanda.
- **Interfaz de pruebas:** activando `RFID_WEB_ENABLED=1` se expone un panel protegido por usuario y contraseña (`RFID_WEB_USERNAME`/`RFID_WEB_PASSWORD`) en `http://127.0.0.1:${HTTP_PORT:-3001}${BASE_PATH:-/}`. Desde allí se pueden simular lecturas introduciendo el ID de tarjeta y la MAC del lector, revisar el histórico reciente y consultar los mensajes publicados a los actuadores para cada decisión. El endpoint `GET /health` facilita comprobar el estado del servicio desde el balanceador o los healthchecks de Docker.
- **Variables adicionales:** revise `rfid-access-service/.env.example` para conocer todos los ajustes disponibles
  (timeouts, credenciales MQTT, etc.).

### Integración RFID Elecnor

- El backend principal también consume el topic `devices/RF1` para las lecturas procedentes de los lectores Elecnor.
- Cada tarjeta puede registrarse desde la pestaña **RFID** del portal (solo administradores), indicando DNI, nombre y apellidos, empresa/CIF y código de centro. Solo se envían a `https://ws.e-coordina.com/1.4` (`action=acceso_permitido_data`) los campos de centro, CIF y DNI; el resto de datos quedan como referencia local.
- Tras cada lectura el sistema consulta la API (`user`/`token` configurables) y registra el resultado en `rfid_access_logs`, mostrando el histórico en la propia interfaz.
- Dependiendo del campo `acceso` (`1` verde / `0` rojo) se publica un comando MQTT que activa el GPIO 6 o 7 del lector; si la API falla, el intento queda almacenado con el error correspondiente y se fuerza el GPIO rojo.
- Ajuste las variables `RFID_ACCESS_*` y `RFID_GPIO_*` en `backend/.env` para definir el topic a vigilar, las credenciales del servicio remoto, tiempos de espera y el formato de los comandos enviados al lector.

## Proxy inverso Nginx externo

La carpeta `nginx/` contiene `horizonst.example.conf` como referencia. El bloque aplica redirección HTTP→HTTPS, cabeceras de seguridad y publica la app (`127.0.0.1:3000`) junto con `/emqx/` y `/pgadmin/`. Adapte certificados y rutas a su entorno y mantenga la configuración MQTT por TCP/1887 en el host.

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

- Cambie el secreto JWT (`JWT_SECRET`), los usuarios/contraseñas por defecto de la app, EMQX (panel y cuentas MQTT) y pgAdmin antes de llegar a producción.
- Mantenga expuestos únicamente los puertos 80/443/1887. El resto de servicios permanecen en `127.0.0.1` y detrás de Docker.
- Añada el endpoint `/health` a sus comprobaciones y monitorice los healthchecks configurados en `docker-compose.yml`.
- Revise periódicamente los logs rotados (`json-file`, 50 MB × 3) y establezca alertas según sus políticas corporativas.

## Licencia

Este proyecto se entrega como referencia técnica para HorizonST. Ajuste y amplíe según las necesidades operativas de su organización.
