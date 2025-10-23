# HorizonST Access Control Platform

HorizonST es una plataforma integral para la monitorización de dispositivos BLE capturados por gateways MQTT. El proyecto incluye:

- **Servidor Node.js/TypeScript** que decodifica tramas de los canales `devices/MK1`, `devices/MK2` y `devices/MK3`, aplica reglas de deduplicación basadas en tiempo y lugar y persiste la información en PostgreSQL.
- **Portal web HTML5 + JavaScript** accesible a través de `www.horizonst.com.es` con funcionalidades diferenciadas para administradores y usuarios finales.
- **Infraestructura Docker** compuesta por la aplicación, PostgreSQL, pgAdmin4 y EMQX. El proxy inverso Nginx se despliega fuera de los contenedores y lo administra el equipo de sistemas.

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
   - Por defecto se utiliza el fichero `backend/.env.example`. Si es necesario personalizar credenciales, copie el archivo y ajuste los valores:
     ```bash
     cp backend/.env.example backend/.env
     ```

3. **Construir e iniciar todos los servicios de aplicación y datos:**
   ```bash
   docker compose up --build
   ```
   Esto levantará:
   - `app`: API y portal web (puerto interno 3000).
   - `postgres`: base de datos PostgreSQL inicializada con `db/schema.sql` y `db/seed.sql`.
   - `pgadmin`: consola de administración disponible en `http://localhost:5050/pgadmin4` (usuario: `admin@horizonst.com.es`, contraseña: `admin`).
   - `emqx`: broker MQTT expuesto en el puerto `1887` del host.

4. **Acceder al portal:**
   - Navegar a `http://localhost:3000/` durante el desarrollo (o al dominio configurado tras el proxy Nginx externo) e iniciar sesión con:
     - Usuario: `admin@horizonst.com.es`
     - Contraseña: `Admin@2024`
   - Cambie la contraseña del administrador tras el primer inicio de sesión.

## Estructura del proyecto

```
backend/          # Servidor Node.js + TypeScript
frontend/public/  # Portal HTML5 + JS servido de forma estática
nginx/            # Configuración de referencia para el proxy inverso externo
db/               # Definiciones SQL de esquema y datos iniciales
docker-compose.yml
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

## MQTT Broker (EMQX)

El contenedor de EMQX publica el puerto `1887` directamente en el host. Para conectar clientes externos utilice las variables definidas en `.env`:

```
Host: <dominio o IP del servidor>
Puerto: 1887
Usuario: Horizon@user2024
Contraseña: Chanel_horizon@2024
Cliente: acces_control_server_<aleatorio>
```

Dentro del orquestado Docker, la aplicación se conecta automáticamente a `mqtt://emqx:1883` reutilizando las mismas credenciales.

## Proxy inverso Nginx externo

El equipo de sistemas gestiona el servidor Nginx. La carpeta `nginx/` contiene un fichero `nginx.conf` de ejemplo que puede servir como base para su despliegue. Ajuste las rutas upstream para que:

- El tráfico HTTP (puertos 80/443) se redirija al servicio `app` en el puerto 3000.
- El tráfico MQTT se encamine al broker EMQX en el puerto 1883, exponiéndolo externamente como `mqtt://<host>:1887` si se mantiene la convención actual.
- Se apliquen cabeceras de seguridad, certificados TLS y reglas de cortafuegos acordes a la política corporativa.

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

- Cambie el secreto JWT (`JWT_SECRET`) y las credenciales predeterminadas antes de desplegar en producción.
- Proteja el acceso a pgAdmin y al dashboard de EMQX restringiendo los puertos o actualizando usuarios/contraseñas.

## Licencia

Este proyecto se entrega como referencia técnica para HorizonST. Ajuste y amplíe según las necesidades operativas de su organización.
