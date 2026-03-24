# Informe técnico integral — Proyecto HorizonST

## 1) Resumen ejecutivo

HorizonST es una plataforma modular orientada a la **monitorización IoT**, el **control de accesos RFID**, la **gestión de cumplimiento en cámaras frigoríficas** y la **operación segura de un broker MQTT empresarial**. La solución se despliega en contenedores Docker y se publica mediante Nginx en HTTPS, separando claramente la capa pública de la capa interna de servicios.

A nivel de portfolio, el proyecto destaca por:

- Arquitectura por microservicios con componentes desacoplados por dominio funcional.
- Integración de datos en tiempo real (MQTT) con persistencia transaccional en PostgreSQL.
- Estrategia de seguridad multicapa: reverse proxy TLS, segmentación por loopback, autenticación por sesión/JWT/token, ACL MQTT por `client_id`, cabeceras HTTP de endurecimiento, y controles de correo (Fail2Ban, DKIM/SPF/DMARC).
- Observabilidad operacional con healthchecks por servicio, sidecar de estado de broker y políticas de logs rotados.

---

## 2) Inventario del proyecto (qué hay y para qué sirve)

### Núcleo funcional

- `backend/`: API principal (Node.js/TypeScript) y panel de administración bajo `/administracion`.
- `frontend/`: frontend fuente del portal administrativo (se empaqueta para backend/public).
- `portal/`: portal web público servido por Nginx interno del contenedor.
- `rfid-access-service/`: microservicio de control de acceso RFID (Elecnor), con API y frontend propio.
- `rfid-demo-dashboard/`: dashboard RFID de inventario demo en tiempo real (Socket.IO + exportables).
- `cold-compliance-service/`: microservicio normativo para cámaras frigoríficas, con reglas de exposición y alertado.
- `mqtt-ui/`: UI de operación para observabilidad de MQTT.
- `mqtt-ui-api/`: API segura para la UI de MQTT y laboratorio GATT.
- `vernemq-observer/`: sidecar que ejecuta `vmq-admin` y expone estado/métricas en JSON para consumo interno.

### Infraestructura y operación

- `db/`: esquema, seed y tabla ACL de VerneMQ (`vmq_auth_acl`).
- `vernemq/`: imagen personalizada para autenticación MQTT con bcrypt vía `vmq_diversity` + PostgreSQL.
- `mailserver/`: correo corporativo (docker-mailserver + Roundcube + políticas antispam/autenticación).
- `nginx/`: configuración de referencia para reverse proxy externo HTTPS.
- `docker-compose.yml`: orquestación integral de todos los servicios.
- `docker-compose.portal.yml`: stack mínimo del portal.
- `docker-compose.rfid-access.yml`: stack aislado para el microservicio RFID.
- `releases/`: snapshot de release productiva (evidencia de trazabilidad de despliegue).

---

## 3) Arquitectura de despliegue (visión de alto nivel)

1. **Entrada pública** por Nginx (host): termina TLS, redirige HTTP→HTTPS y enruta por prefijos (`/administracion`, `/elecnor`, `/pgadmin`, `/webmail`, etc.).
2. **Servicios de negocio** en Docker (`app`, `rfid_access`, `cold_compliance_service`, `rfid_demo_dashboard`).
3. **Mensajería IoT** con VerneMQ (`vernemq`) y autenticación/autorización delegada en PostgreSQL.
4. **Persistencia** en PostgreSQL (`postgres`) con bases dedicadas por microservicio cuando aplica.
5. **Operación y soporte** con `pgadmin`, `mqtt_ui` + `mqtt_ui_api` + `vernemq_observer`.
6. **Comunicaciones de correo** con `mail` + `webmail` (perfil `mail`).

Este diseño favorece separación de responsabilidades, escalabilidad por servicio y trazabilidad de seguridad por perímetro.

---

## 4) Detalle de aplicaciones por contenedor

## 4.1 `portal`

**Función:** sitio público estático (Nginx alpine).

**Aplicación:** presentar la capa pública corporativa/comercial del proyecto en puerto interno 80, publicado en loopback (`127.0.0.1:3080`).

**Valor portfolio:** separa claramente la experiencia pública del panel de operación.

## 4.2 `app` (backend principal)

**Función:** API central HorizonST + panel `/administracion`.

**Aplicación:**
- Gestión de autenticación de usuarios y emisión de JWT.
- Gestión de entidades (usuarios, gateways, dispositivos, categorías, lugares, alarmas, mensajes, contacto, RFID).
- Endpoint de salud con estado MQTT degradado/ok.

**Valor portfolio:** núcleo de negocio IoT + RBAC para administración.

## 4.3 `rfid_access`

**Función:** control de accesos RFID con interfaz web propia.

**Aplicación:**
- Validación y gestión de tarjetas/trabajadores/usuarios.
- Sesiones HTTP con roles (`admin`/`user`).
- Simulación de lectura y gestión de eventos/histórico para operación.

**Valor portfolio:** caso real de acceso físico integrado con lógica de negocio.

## 4.4 `rfid_demo_dashboard`

**Función:** demo comercial de inventario RFID en tiempo real.

**Aplicación:**
- Suscripción MQTT a `devices/RF1`.
- Lógica IN/OUT por EPC con anti-rebote.
- Dashboard en vivo y exportables ejecutivos.

**Valor portfolio:** componente orientado a presentación comercial y analítica operativa.

## 4.5 `cold_compliance_service`

**Función:** cumplimiento normativo de personal en cámaras frigoríficas.

**Aplicación:**
- Ingesta MQTT y reglas de exposición (45/15, acumulados, alertas).
- Pipeline de comando-respuesta para actuar sobre tags (LED/buzzer/vibración).
- Auditoría, incidencias e histórico legalmente trazable.

**Valor portfolio:** vertical regulatorio con diseño desacoplado y persistencia robusta.

## 4.6 `mqtt_ui_api`

**Función:** backend de observabilidad MQTT + laboratorio GATT.

**Aplicación:**
- Login administrativo y JWT de sesión.
- Endpoints de estado, métricas y diagnóstico TLS MQTT.
- Comandos GATT a gateways con control de correlación de respuestas.
- Stream SSE con ticket temporal y rate-limit.

**Valor portfolio:** operación segura de IoT en tiempo real con herramientas de diagnóstico.

## 4.7 `mqtt_ui`

**Función:** frontend de observabilidad para `mqtt_ui_api`.

**Aplicación:** interfaz para operadores técnicos (estado cluster, listeners, GATT lab, diagnósticos).

## 4.8 `vernemq_observer`

**Función:** sidecar de observabilidad interna del broker.

**Aplicación:**
- Expone `/status`, `/metrics`, `/listeners`, `/cluster` llamando a `vmq-admin`.
- No requiere exposición directa de puertos de administración de VerneMQ hacia Internet.

## 4.9 `postgres`

**Función:** persistencia principal.

**Aplicación:**
- Almacena datos de negocio del backend.
- Almacena tabla de autenticación/autorización MQTT (`vmq_auth_acl`) para VerneMQ.
- Soporta bases dedicadas de microservicios (`rfid_demo`, `cold_compliance`, etc.) para aislamiento lógico.

## 4.10 `pgadmin`

**Función:** consola de administración DB.

**Aplicación:** soporte a operaciones SQL y diagnóstico de datos en entorno protegido tras loopback/Nginx.

## 4.11 `vernemq`

**Función:** broker MQTT central del ecosistema.

**Aplicación:**
- Broker para gateways/dispositivos/servicios internos.
- Control de acceso con `vmq_diversity` y backend PostgreSQL.
- ACL por tópico en JSON, asociadas a `client_id`.

## 4.12 `mail` (perfil opcional)

**Función:** servidor de correo (SMTP/IMAPS) corporativo.

**Aplicación:**
- Envío y recepción de notificaciones.
- Integración con aliases funcionales (`contacto@`, `soporte@`).
- DKIM/DMARC/SPF para entregabilidad.

## 4.13 `webmail` (perfil opcional)

**Función:** Roundcube para acceso web al correo.

**Aplicación:** interfaz `/webmail/` detrás de Nginx, conectada a IMAPS/SMTP internos.

## 4.14 `cert-init` (perfil `dev`)

**Función:** generación de certificados de desarrollo para correo.

**Aplicación:** simplifica entornos no productivos sin depender de PKI pública.

---

## 5) Seguridad por contenedor (medidas aplicadas)

## 5.1 Seguridad de exposición de red (patrón transversal)

- Casi todos los servicios de aplicación y soporte se publican en `127.0.0.1` en host, reduciendo superficie pública directa.
- La exposición pública se centraliza en Nginx (80/443) y, según necesidad, MQTT en `1887`.
- Se usa red Docker bridge dedicada (`horizonst`) para comunicación este-oeste.

**Impacto:** minimiza ataque directo a puertos internos y fuerza paso por reverse proxy/control de perímetro.

## 5.2 `portal`

- Imagen Nginx mínima (`nginx:alpine`).
- Servicio en loopback host.
- Sin estado sensible persistente.

## 5.3 `app`

- Hash de contraseñas con PBKDF2 + salt único por usuario y comparación segura `timingSafeEqual`.
- JWT para autenticación API.
- Middleware de autorización por rol (ADMIN/USER).
- `trust proxy` habilitado para convivencia con Nginx.
- Healthcheck HTTP para detección temprana de degradación.

## 5.4 `rfid_access`

- Sesiones HTTP con `httpOnly` y `sameSite=lax`.
- Separación de permisos (`ensureAuthenticated` / `ensureAdmin`).
- Protección de continuidad operativa: no permite dejar el sistema sin administrador activo.
- Logs de intentos fallidos de login.

## 5.5 `rfid_demo_dashboard`

- Aislamiento por base de datos dedicada (`rfid_demo`).
- Migraciones automáticas encapsuladas en el servicio.
- No colisiona con tablas del core.

## 5.6 `cold_compliance_service`

- Autenticación por token aleatorio en tabla de sesiones con expiración (12h).
- Hashing de contraseñas en PostgreSQL con `crypt(..., gen_salt('bf'))` (bcrypt).
- Flujo de recuperación de contraseña con tokens de un solo uso y expiración corta.
- Base de datos dedicada para evitar contaminación de esquema del core.

## 5.7 `mqtt_ui_api`

- `helmet()` para hardening HTTP.
- CORS restringido por variable de entorno.
- JWT para endpoints protegidos.
- Rate limiting para comandos GATT sensibles.
- Tickets efímeros para SSE (caducidad y validación por usuario).
- Validaciones estrictas de gateway/mac/msg_id antes de ejecutar comandos MQTT.

## 5.8 `vernemq_observer`

- Solo expone JSON técnico de `vmq-admin` para red interna Docker.
- Evita otorgar acceso operacional bruto al broker desde Internet.

## 5.9 `postgres`

- Persistencia en volumen dedicado.
- Inicialización controlada de esquema y seeds por archivos montados en solo lectura.
- Uso de `vmq_auth_acl` con índices y unicidad (`mountpoint, client_id`) para integridad de identidades MQTT.

## 5.10 `vernemq`

- `ALLOW_ANONYMOUS=off` (sin clientes anónimos).
- Plugins legacy (`vmq_passwd`, `vmq_acl`) desactivados para concentrar autenticación en `vmq_diversity` + PostgreSQL.
- Hash method `bcrypt`.
- ACL por topic (publish/subscribe) por identidad de cliente.
- Healthcheck de cluster con `vmq-admin`.

## 5.11 `mail`

- TLS en SMTPS (465) y STARTTLS obligatorio en Submission (587).
- Fail2Ban habilitable y configuración específica para evitar falsos positivos internos Docker.
- Cuentas en fichero con hash SHA512-CRYPT.
- DKIM/DMARC/SPF documentados para autenticidad de correo.
- Volúmenes separados para datos, estado, logs y configuración.

## 5.12 `webmail`

- Publicación por loopback y consumo detrás de Nginx.
- Configuración de prefijo `/webmail/` y headers `X-Forwarded-*` para operación segura tras proxy.

## 5.13 `pgadmin`

- Credenciales por variables de entorno.
- No expuesto públicamente de forma directa en arquitectura recomendada (loopback + Nginx).

## 5.14 `cert-init`

- Uso acotado al perfil de desarrollo.
- Reduce improvisación manual de certificados en entornos no productivos.

---

## 6) Seguridad del servidor (host) y perímetro

## 6.1 Reverse proxy y TLS

- Redirección obligatoria HTTP→HTTPS.
- Certificados TLS de dominio en Nginx.
- Cabeceras de seguridad activas:
  - `Strict-Transport-Security`
  - `X-Content-Type-Options`
  - `Referrer-Policy`
  - `X-Frame-Options`
- Ruteo por prefijos para separar aplicaciones (`/administracion`, `/elecnor`, `/pgadmin`, `/webmail`).

## 6.2 Segmentación y minimización de superficie

- Exposición pública recomendada: 80/443 y MQTT según política.
- Servicios críticos de soporte (DB, APIs internas, paneles) vinculados a loopback.

## 6.3 Supervisión operativa

- Healthchecks en la mayoría de contenedores.
- Rotación de logs por driver `json-file` para evitar crecimiento no controlado.
- Endpoint `/health` en servicios backend para automatizar monitoreo.

## 6.4 Seguridad de credenciales y secretos

- Uso de `.env`/variables para no hardcodear secretos en código.
- Recomendación explícita de cambiar credenciales por defecto tras primer despliegue.
- Enfoque de identidades técnicas separadas por servicio para MQTT.

## 6.5 Correo y reputación de dominio

- Pipeline de seguridad de correo: TLS + DKIM + SPF + DMARC + Fail2Ban.
- Preparado para relé autenticado cuando el puerto 25 saliente esté restringido.

---

## 7) Fortalezas técnicas para portfolio

1. **Arquitectura modular real**: múltiples dominios (IoT core, RFID acceso, cumplimiento normativo, observabilidad, mail) en servicios aislados.
2. **Diseño event-driven**: MQTT como backbone de telemetría y comando con persistencia consistente.
3. **Seguridad pragmática de producción**: protección por capas desde red a aplicación.
4. **Operación y mantenibilidad**: healthchecks, logs rotados, sidecar de observabilidad, release empaquetada.
5. **Escalabilidad organizativa**: cada módulo puede evolucionar con su DB y ciclo de despliegue.

---

## 8) Riesgos detectados y mejoras recomendadas (para madurez enterprise)

### Riesgos observados

- Existen ejemplos/valores por defecto en `.env.example` (usuarios, passwords, secretos) que podrían reutilizarse por error en entornos sensibles.
- En algunos componentes Node no se fija usuario no-root en runtime del contenedor (recomendable endurecer).
- Hay parámetros de TLS permisivos en escenarios de pruebas (por ejemplo, validación de certificados desactivada para ciertos flujos internos).
- VerneMQ publicado en 1887 sin TLS en el estado descrito de referencia (debería migrar a 8883/TLS para clientes externos).

### Mejoras prioritarias sugeridas

1. Forzar rotación inicial obligatoria de secretos y bloquear arranque con credenciales por defecto.
2. Ejecutar todos los runtimes como usuario no privilegiado y aplicar `read_only`, `cap_drop`, `no-new-privileges` cuando sea viable.
3. Migrar conectividad MQTT externa a TLS mutuo (mTLS) o, como mínimo, TLS servidor + credenciales por cliente.
4. Activar CSP estricta en Nginx tras validar assets frontend.
5. Integrar SAST/DAST + escaneo de imágenes en CI/CD.
6. Centralizar observabilidad (logs, métricas, alertas) en stack dedicado (Loki/Prometheus/Grafana o equivalente).

---

## 9) Narrativa recomendada para portfolio

> HorizonST es una plataforma de control y trazabilidad IoT industrial orientada a operación segura en tiempo real. El proyecto integra múltiples microservicios especializados (acceso RFID, cumplimiento en frío, observabilidad MQTT y correo corporativo), orquestados con Docker y protegidos por una arquitectura de seguridad multicapa: TLS en perímetro, hardening HTTP, autenticación por sesión/JWT/token, ACL MQTT por identidad y controles antiabuso en servicios críticos. El resultado es una solución escalable, auditables y lista para evolución enterprise.

---

## 10) Checklist breve de evidencias (útil para anexos del portfolio)

- Capturas de `/administracion`, `/elecnor`, dashboard RFID demo, UI MQTT.
- Extracto de `docker-compose.yml` mostrando segmentación por loopback.
- Extracto Nginx con cabeceras de seguridad y HTTPS.
- Ejemplo de `vmq_auth_acl` con ACL por topic.
- Evidencia de healthchecks en servicios principales.
- Evidencia de configuración mail segura (TLS, DKIM, Fail2Ban).

