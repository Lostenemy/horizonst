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
     MQTT_PERSISTENCE_MODE=emqx
     EMQX_MGMT_HOST=emqx
     EMQX_MGMT_PORT=18083
     EMQX_MGMT_USERNAME=admin
     EMQX_MGMT_PASSWORD=public
     EMQX_MGMT_SSL=false
     ```
     Si necesita anular valores, edite este archivo antes de levantar los servicios.

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
- Decodificadores específicos para cada canal, normalizando campos como `BaTtVol`/`BattVoltage`.
- Validación de gateways y dispositivos registrados antes de persistir lecturas.
- Reglas de consolidación por lugar: lecturas con menos de 30 s se ignoran, entre 30 s y 5 min actualizan el registro anterior y, superados 5 min, se genera uno nuevo.
- Almacenamiento del histórico en `device_records` y actualización del estado en `devices`.

### Portal web

- **Administradores** pueden registrar gateways y dispositivos, consultar mensajes MQTT, revisar históricos completos y gestionar alarmas.
- **Usuarios** gestionan lugares, categorías, asignación de dispositivos y fotos, así como reclamación de dispositivos por MAC.
- Visualizaciones agrupadas por lugar y herramientas para configurar alarmas basadas en tiempo sin señal.

### Alarmas

- Configuraciones flexibles por dispositivo, categoría o lugar con umbrales configurables.
- Monitor de alarmas en segundo plano que genera y resuelve alertas automáticamente.
- Gestión de grupos de usuarios que pueden reconocer y cerrar alarmas.

## Arquitectura de despliegue

- **Nginx (host):** sirve la aplicación en HTTPS y publica los paneles de EMQX (`/emqx`) y pgAdmin (`/pgadmin`). Redirige automáticamente las peticiones HTTP (80) a HTTPS (443).
- **Docker Compose (loopback):** la app, PostgreSQL y pgAdmin solo escuchan en `127.0.0.1`. EMQX expone el puerto `1887` hacia el exterior sin TLS y mantiene el dashboard ligado al loopback (`127.0.0.1:18083`).
- **Supervisión:** la API expone `GET /health` y los servicios incluyen healthchecks y rotación de logs (`json-file`, 50 MB × 3).

## MQTT Broker (EMQX)

- **Acceso externo:** `mqtt://<dominio-o-ip>:1887` (sin TLS). Cree usuarios/contraseñas específicos para clientes finales.
- **Acceso interno (app → EMQX):** `mqtt://emqx:1883` gracias al fichero `backend/.env`.
- **Panel de control:** disponible en `https://horizonst.com.es/emqx/` tras Nginx. No abra el puerto 18083 de manera directa.
- **Persistencia nativa de mensajes:** durante el arranque la API crea (vía REST) un conector y una regla de EMQX que envían el contenido de **todos** los topics a PostgreSQL (`mqtt_messages`). El histórico queda disponible en la ruta autenticada `GET /api/messages` y en la tabla para auditoría o análisis forense.
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
