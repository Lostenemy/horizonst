# Plan progresivo de reestructuración de Docker Compose

## Alcance y condición crítica

Este documento prepara una migración futura del `docker-compose.yml` raíz hacia una estructura por capas en `infrastructure/docker`, sin ejecutar todavía esa migración.

Condiciones que deben mantenerse durante esta fase de planificación:

- No modificar `docker-compose.yml` todavía.
- No mover archivos todavía.
- No cambiar nombres de servicios, redes, volúmenes ni puertos.
- No cambiar rutas de `build.context`, `env_file`, volúmenes bind ni ficheros de configuración mientras el despliegue actual siga operando desde la raíz.
- No alterar el despliegue actual de `horizonst.com.es` ni el comportamiento operativo existente.
- La futura producción objetivo para `horizonst.es` debe validarse en paralelo antes de sustituir el Compose actual.

## Estado actual observado

El Compose actual concentra en un único fichero los servicios de aplicación, persistencia, broker MQTT, observabilidad/admin, demo RFID y correo. También declara una única red `horizonst` y todos los volúmenes persistentes.

Servicios actuales detectados:

| Servicio | Rol actual | Dependencias relevantes | Puertos publicados actuales |
| --- | --- | --- | --- |
| `portal` | Portal web estático/front público | Ninguna declarada | `127.0.0.1:3080:80` |
| `app` | API principal backend | `postgres`, `vernemq` | `127.0.0.1:${APP_PORT:-3000}:${APP_PORT:-3000}` |
| `rfid_access` | Servicio RFID de acceso con web interna | `vernemq`, `postgres` | `127.0.0.1:${HTTP_PORT:-3001}:${HTTP_PORT:-3001}` |
| `rfid_demo_dashboard` | Dashboard demo RFID | `postgres`, `vernemq` | `127.0.0.1:3200:3200` |
| `cold_compliance_service` | Servicio de cumplimiento/cadena de frío, control de tags y correo transaccional | `postgres`, `vernemq` | `127.0.0.1:${COLD_COMPLIANCE_PORT:-3100}:${COLD_COMPLIANCE_PORT:-3100}` |
| `mqtt_ui_api` | API de UI MQTT, observabilidad VerneMQ y laboratorio GATT | `vernemq`, `vernemq_observer` | `127.0.0.1:4010:4010` |
| `mqtt_ui` | UI web de administración/observabilidad MQTT | `mqtt_ui_api` | `127.0.0.1:8090:80` |
| `vernemq_observer` | API observadora de VerneMQ | `vernemq` | Sin puerto publicado |
| `postgres` | Base de datos PostgreSQL y seeds iniciales | Ninguna declarada | `127.0.0.1:5432:5432` |
| `pgadmin` | Administración PostgreSQL | `postgres` | `127.0.0.1:5050:80` |
| `vernemq` | Broker MQTT con autenticación PostgreSQL | `postgres` por configuración, no por `depends_on` | `127.0.0.1:1887:1883` |
| `cert-init` | Inicialización de certificados de desarrollo para mailserver | Perfil `dev` | Sin puerto publicado |
| `mail` | Servidor SMTP/IMAP con docker-mailserver | Perfil `mail` | `25:25`, `465:465`, `587:587`, `993:993` |
| `webmail` | Roundcube para webmail | Perfil `mail`, `mail` | `127.0.0.1:8080:80` |

Recursos globales actuales:

- Red: `horizonst` con driver `bridge`.
- Volúmenes persistentes: `postgres_data`, `mail_data`, `mail_state`, `mail_dovecot`, `mail_spool`, `mail_postfix_conf`, `mail_dovecot_conf`, `mail_logs`, `dkim_conf`, `webmail_data`, `vernemq_data`, `vernemq_log`.

## Estructura futura propuesta

Ruta objetivo futura:

```text
infrastructure/docker/
  compose.base.yml
  compose.prod.yml
  compose.stage.yml
  compose.mail.yml
  compose.admin.yml
  compose.demo.yml
```

La separación debe hacerse por responsabilidad, no por cambios de nombres. Cada capa debe conservar los nombres actuales de servicios, red, volúmenes y puertos para minimizar cambios operativos.

### `compose.base.yml`

Debe contener la base compartida que representa el núcleo mínimo común entre producción y stage.

Servicios propuestos:

- `postgres`
- `vernemq`
- `portal`
- `app`
- `rfid_access`
- `cold_compliance_service`

Recursos globales propuestos:

- Red `horizonst`.
- Volúmenes comunes necesarios para los servicios base:
  - `postgres_data`
  - `vernemq_data`
  - `vernemq_log`

Motivo:

- Estos servicios sostienen la aplicación principal, la base de datos, el broker MQTT y los servicios funcionales que parecen necesarios para el despliegue core.
- `cold_compliance_service` debe permanecer en base si forma parte del producto principal de `horizonst.es`; si en la práctica solo se usa para Horneo o un vertical específico, puede pasar a una capa futura específica, pero no conviene introducir esa separación en la primera migración.

Precauciones:

- Si el fichero se mueve a `infrastructure/docker`, las rutas relativas cambiarán. Para no romper builds ni binds, en la fase inicial se recomienda usar `docker compose --project-directory <repo-root> -f infrastructure/docker/compose.base.yml ...` o mantener temporalmente rutas relativas al repo root mediante una estrategia validada antes del cambio.
- No se deben eliminar los `env_file` por servicio en la primera extracción; primero hay que inventariar qué variables se leen desde `backend/.env`, `rfid-access-service/.env`, `cold-compliance-service/.env` y otros ficheros locales.

### `compose.prod.yml`

Debe contener solo ajustes de producción encima de `compose.base.yml`.

Servicios afectados propuestos:

- `portal`
- `app`
- `rfid_access`
- `cold_compliance_service`
- `postgres`
- `vernemq`

Contenido recomendado:

- Valores de entorno de producción que hoy tienen defaults orientados al dominio `horizonst.com.es` y que en producción objetivo deberán apuntar a `horizonst.es` cuando corresponda.
- Políticas de reinicio y logging si se decide endurecerlas para producción, manteniendo inicialmente las actuales para evitar deriva.
- Overrides estrictamente necesarios para dominios públicos, CORS, URL base, diagnóstico MQTT y correo transaccional.

No debería contener:

- `pgadmin`, `mqtt_ui`, `mqtt_ui_api` ni `vernemq_observer` salvo que se decida exponer administración en producción de forma explícita y protegida.
- `rfid_demo_dashboard` salvo que exista una demo pública/operativa aprobada.
- `mail` y `webmail`, que deben vivir en `compose.mail.yml`.

Comando objetivo futuro, cuando se valide la migración:

```bash
docker compose --project-directory . \
  -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.prod.yml \
  --env-file .env.prod up -d
```

### `compose.stage.yml`

Debe contener overrides para un entorno de staging/preproducción.

Servicios afectados propuestos:

- Los mismos servicios core de `compose.base.yml`.
- Opcionalmente `mqtt_ui_api`, `mqtt_ui`, `vernemq_observer` y `pgadmin` durante pruebas, preferiblemente cargándolos mediante `compose.admin.yml` para no mezclar stage con administración.

Contenido recomendado:

- Dominios stage, por ejemplo `stage.horizonst.es` o el dominio interno que se decida.
- Puertos host alternativos si stage se ejecuta en el mismo servidor que producción. Si stage corre en otro host, mantener los mismos puertos para conservar compatibilidad.
- Secrets y credenciales diferenciadas de producción.
- Ajustes de correo transaccional para evitar envíos reales accidentales, por ejemplo `COLD_MAIL_ENABLED=false` o SMTP de sandbox, si la operativa lo permite.

No debería contener:

- Cambios de nombres de servicios, red o volúmenes.
- Demo RFID salvo que se cargue con `compose.demo.yml`.
- Mailserver completo salvo que se esté probando correo explícitamente con `compose.mail.yml`.

Comando objetivo futuro:

```bash
docker compose --project-directory . \
  -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.stage.yml \
  --env-file .env.stage up -d
```

### `compose.mail.yml`

Debe aislar la pila de correo para poder activarla solo cuando se necesite.

Servicios propuestos:

- `cert-init`
- `mail`
- `webmail`

Volúmenes propuestos:

- `mail_data`
- `mail_state`
- `mail_dovecot`
- `mail_spool`
- `mail_postfix_conf`
- `mail_dovecot_conf`
- `mail_logs`
- `dkim_conf`
- `webmail_data`

Motivo:

- El correo publica puertos sensibles y globales (`25`, `465`, `587`, `993`) que pueden colisionar con otros servicios del host.
- Docker Mailserver tiene variables, certificados, volúmenes y requisitos operativos propios.
- Separar correo reduce el riesgo de levantarlo accidentalmente durante pruebas de aplicación.

Precauciones:

- Mantener los perfiles actuales `dev` y `mail` durante la primera migración para no cambiar cómo se activa el correo.
- Mantener el alias de red `mail.horizonst.com.es` hasta que exista un plan DNS/certificados para `horizonst.es`.
- Revisar certificados de `/etc/letsencrypt` antes de cambiar `MAIL_FQDN`, `MAIL_SSL_CERT_PATH` o `MAIL_SSL_KEY_PATH`.

Comando objetivo futuro:

```bash
docker compose --project-directory . \
  -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.prod.yml \
  -f infrastructure/docker/compose.mail.yml \
  --env-file .env.prod --profile mail up -d
```

### `compose.admin.yml`

Debe agrupar herramientas administrativas y de observabilidad que no son parte del runtime público mínimo.

Servicios propuestos:

- `pgadmin`
- `vernemq_observer`
- `mqtt_ui_api`
- `mqtt_ui`

Motivo:

- `pgadmin` y la UI MQTT son herramientas sensibles y deben poder deshabilitarse en producción pública.
- `mqtt_ui_api` incluye endpoints de diagnóstico y laboratorio GATT; conviene activarlo solo con controles de acceso y CORS adecuados.
- `vernemq_observer` alimenta a `mqtt_ui_api`; debe ir en la misma capa administrativa salvo que otro servicio core lo requiera.

Precauciones:

- No cambiar puertos: mantener `127.0.0.1:5050:80`, `127.0.0.1:4010:4010` y `127.0.0.1:8090:80` durante la migración.
- Mantener acceso bind a `127.0.0.1` y delegar exposición pública, si existe, en el reverse proxy externo.
- Separar variables de credenciales administrativas por entorno (`PGADMIN_*`, `MQTT_UI_*`) y no reutilizar passwords de producción en stage.

Comando objetivo futuro:

```bash
docker compose --project-directory . \
  -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.prod.yml \
  -f infrastructure/docker/compose.admin.yml \
  --env-file .env.prod up -d
```

### `compose.demo.yml`

Debe aislar componentes de demo, laboratorio o validación no estrictamente necesarios para producción.

Servicios propuestos:

- `rfid_demo_dashboard`

Motivo:

- El dashboard demo depende de `postgres` y `vernemq`, pero no debería obligar a levantar una demo en producción core.
- Separarlo permite activar demos en stage, ferias, pruebas internas o entornos de cliente sin contaminar el runtime principal.

Precauciones:

- Mantener el puerto `127.0.0.1:3200:3200` inicialmente.
- Revisar si su `env_file` contiene secretos reales antes de promoverlo a stage o producción.
- Documentar si depende de datos seed o migraciones específicas de `rfid-demo-dashboard`.

Comando objetivo futuro:

```bash
docker compose --project-directory . \
  -f infrastructure/docker/compose.base.yml \
  -f infrastructure/docker/compose.stage.yml \
  -f infrastructure/docker/compose.demo.yml \
  --env-file .env.stage up -d
```

## Variables candidatas para `.env.prod.example` y `.env.stage.example`

No se deben mover variables todavía; primero se deben crear ejemplos y validar equivalencia con `docker compose config`.

### Variables comunes a ambos ejemplos

Estas variables deben existir en los dos ejemplos, con valores dummy seguros y diferenciados por entorno:

#### Base de datos

- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `COLD_COMPLIANCE_DB_NAME`
- `RFID_DB_HOST`
- `RFID_DB_PORT`
- `RFID_DB_USER`
- `RFID_DB_PASSWORD`
- `RFID_DB_NAME`
- `RFID_DB_ADMIN_DB`
- `RFID_DB_SSL`

#### MQTT compartido

- `MQTT_USER`
- `MQTT_PASS`
- `MQTT_CLIENT_ID`
- `MQTT_REQUIRED`
- `MQTT_RECONNECT_PERIOD`
- `MQTT_RECONNECT_MAX_PERIOD`
- `MQTT_SEED_CLIENT_ID`
- `MQTT_USERNAME`
- `MQTT_PASSWORD_HASH`
- `MQTT_PUBLISH_ACL_JSON`
- `MQTT_SUBSCRIBE_ACL_JSON`

#### Puertos internos/publicados actuales

- `APP_PORT`
- `HTTP_PORT`
- `COLD_COMPLIANCE_PORT`

Aunque algunos puertos tienen default en Compose, incluirlos en los ejemplos ayuda a detectar colisiones entre prod y stage.

#### RFID access

- `BASE_PATH`
- `RFID_WEB_ENABLED`
- `RFID_WEB_SESSION_SECRET`
- `RFID_WEB_USERNAME`
- `RFID_WEB_PASSWORD`
- `RFID_WEB_HISTORY_SIZE`

#### Cold compliance, tags y presencia

- `COLD_MQTT_URL`
- `COLD_MQTT_CLIENT_ID`
- `COLD_MQTT_SUB_TOPICS`
- `COLD_MQTT_COMMAND_TOPIC_TEMPLATE`
- `TAG_CONTROL_ENABLED`
- `TAG_CONTROL_DEFAULT_TIMEOUT_MS`
- `TAG_CONTROL_MAX_RETRIES`
- `TAG_CONTROL_MSG_ID_START`
- `TAG_CONTROL_REQUIRE_REPLY`
- `TAG_CONTROL_DEDUP_WINDOW_MS`
- `TAG_CONTROL_GATEWAY_STRATEGY`
- `REENTRY_REMINDER_INTERVAL_MS`
- `PRESENCE_SWEEP_INTERVAL_MS`
- `PRESENCE_EXIT_TIMEOUT_MS`

#### Correo transaccional usado por `cold_compliance_service`

- `COLD_MAIL_ENABLED`
- `COLD_MAIL_HOST`
- `COLD_MAIL_PORT`
- `COLD_MAIL_SECURE`
- `COLD_MAIL_USER`
- `COLD_MAIL_PASSWORD`
- `COLD_MAIL_FROM`
- `COLD_MAIL_EHLO_DOMAIN`
- `COLD_MAIL_TLS_REJECT_UNAUTHORIZED`
- `COLD_APP_BASE_URL`

#### Administración y observabilidad

- `PGADMIN_DEFAULT_EMAIL`
- `PGADMIN_DEFAULT_PASSWORD`
- `MQTT_UI_CORS_ORIGIN`
- `MQTT_UI_ADMIN_USER`
- `MQTT_UI_ADMIN_PASSWORD`
- `MQTT_UI_JWT_SECRET`
- `VMQ_OBSERVER_BASE_URL`
- `VMQ_OBSERVER_STATUS_PATH`
- `VMQ_OBSERVER_METRICS_PATH`
- `VMQ_OBSERVER_LISTENERS_PATH`
- `VMQ_OBSERVER_CLUSTER_PATH`
- `VMQ_OBSERVER_TIMEOUT_MS`
- `MQTT_DIAG_HOST`
- `MQTT_DIAG_PORT`
- `MQTT_DIAG_TIMEOUT_MS`

#### GATT Lab / MQTT UI API

- `GATT_DEFAULT_PASS`
- `GATT_TIMEOUT_MS`
- `GATT_RATE_LIMIT_WINDOW_MS`
- `GATT_RATE_LIMIT_MAX`
- `GATT_MIN_RSSI`
- `GATT_MQTT_HOST`
- `GATT_MQTT_PORT`
- `GATT_MQTT_TLS`
- `GATT_MQTT_REJECT_UNAUTHORIZED`
- `GATT_MQTT_USERNAME`
- `GATT_MQTT_PASSWORD`
- `GATT_MQTT_CLIENT_ID`
- `GATT_MQTT_COMMAND_TOPIC_TEMPLATE`
- `GATT_MQTT_RESPONSE_TOPIC_TEMPLATE`
- `GATT_MQTT_PUB_TOPIC_SUBSCRIBE`
- `GATT_CONNECT_EXPECTED_MSG_IDS`
- `GATT_INQUIRE_DEVICE_INFO_EXPECTED_MSG_IDS`
- `GATT_INQUIRE_STATUS_EXPECTED_MSG_IDS`
- `GATT_SSE_TICKET_TTL_MS`

#### Mailserver completo

Estas variables pertenecen al ejemplo del entorno que vaya a usar `compose.mail.yml`; si stage no levanta mailserver real, deben documentarse con valores desactivados o de sandbox.

- `MAIL_FQDN`
- `MAIL_SSL_TYPE`
- `MAIL_SSL_CERT_PATH`
- `MAIL_SSL_KEY_PATH`
- `ENABLE_POSTGREY`
- `ENABLE_SPAMASSASSIN`
- `ENABLE_CLAMAV`
- `ENABLE_FAIL2BAN`
- `ENABLE_MANAGESIEVE`
- `ENABLE_POP3`
- `ENABLE_SASLAUTHD`
- `ENABLE_UPDATE_CHECK`
- `ONE_DIR`
- `DMS_DEBUG`
- `LOG_LEVEL`
- `ENABLE_SUBMISSION`
- `ENABLE_SMTPS`
- `SMTP_ONLY`
- `PERMIT_DOCKER`
- `POSTMASTER_ADDRESS`
- `REPORT_RECIPIENT`
- `REPORT_INTERVAL`
- `LOGWATCH_INTERVAL`
- `TLS_LEVEL`
- `SSL_TYPE`
- `ENABLE_OPENDKIM`
- `ENABLE_OPENDMARC`
- `ENABLE_POLICYD_SPF`
- `RELAY_HOST`
- `RELAY_PORT`
- `RELAY_USER`
- `RELAY_PASSWORD`
- `DEFAULT_RELAY_HOST`
- `ACCOUNT_PROVISIONER`

### Diferencias recomendadas para `.env.prod.example`

- Usar dominios definitivos de producción: `horizonst.es`, `mail.horizonst.es`, `mqtt.horizonst.es` y las URLs públicas reales que se aprueben.
- `COLD_APP_BASE_URL` debe apuntar a la URL pública real del servicio de frío si se mantiene como producto de producción.
- `MQTT_DIAG_HOST` debe apuntar al host MQTT real de producción.
- Secrets y contraseñas deben aparecer como placeholders inequívocos, por ejemplo `change-me-prod-*`, nunca valores reales.
- `COLD_MAIL_ENABLED` debe reflejar la decisión operativa real: `true` solo si el SMTP de producción ya está validado.
- Certificados de mail deben apuntar a rutas reales de Let's Encrypt solo cuando el FQDN nuevo ya exista y esté emitido.

### Diferencias recomendadas para `.env.stage.example`

- Usar dominios de stage, por ejemplo `stage.horizonst.es`, `mail.stage.horizonst.es` o nombres internos equivalentes.
- Usar credenciales distintas de producción.
- Considerar puertos host alternativos si stage coexiste en la misma máquina que prod.
- Considerar `COLD_MAIL_ENABLED=false` o SMTP sandbox para evitar envíos reales.
- `MQTT_REQUIRED` puede mantenerse `false` durante pruebas de arranque, pero antes de promover a prod conviene validar el modo real esperado.
- Reducir riesgos de observabilidad expuesta: `MQTT_UI_CORS_ORIGIN` debe apuntar solo al origen stage aprobado.

## Riesgos de romper compatibilidad

1. **Cambio de rutas relativas al mover Compose.** `build.context`, `dockerfile`, `env_file` y bind mounts como `./db/schema.sql`, `./vernemq/vernemq.conf` o `./mailserver/config` se resuelven respecto al fichero Compose o al project directory según el caso. Mover el fichero sin validar puede romper builds y montajes.
2. **Cambio de project name de Compose.** Ejecutar desde otra carpeta puede cambiar el nombre de proyecto y crear contenedores, redes o volúmenes con otro prefijo. Esto puede duplicar infraestructura o dejar de usar volúmenes existentes.
3. **Volúmenes persistentes.** Aunque los nombres lógicos no cambien, un project name distinto puede producir nombres físicos diferentes para volúmenes no externos, afectando `postgres_data`, `vernemq_data` y volúmenes de correo.
4. **Orden y combinación de ficheros.** En Compose por capas, el último fichero sobrescribe/combina claves. Un override mal ordenado puede sustituir listas como `ports`, `environment` o `volumes` de forma inesperada.
5. **Perfiles existentes.** `cert-init`, `mail` y `webmail` ya usan perfiles. Separarlos sin conservar perfiles puede levantar correo por accidente o impedir su activación actual.
6. **Puertos host.** Los puertos actuales están atados mayoritariamente a `127.0.0.1`, pero correo usa puertos públicos. Un stage en el mismo host colisionaría si mantiene puertos idénticos.
7. **Dominios y certificados.** Cambiar de `horizonst.com.es` a `horizonst.es` implica DNS, certificados, aliases de red, `MAIL_FQDN`, rutas de Let's Encrypt y URLs base. Hacerlo junto con la reestructuración aumentaría el riesgo.
8. **Secrets y `.env` dispersos.** Hay variables en `.env` raíz y `env_file` por servicio. Consolidarlas de golpe puede cambiar precedencia o dejar variables sin definir.
9. **Healthchecks dependientes de variables.** Algunos healthchecks usan defaults o variables de puerto. Una variable stage/prod mal definida puede marcar servicios como unhealthy aunque el proceso esté vivo.
10. **Autenticación MQTT en PostgreSQL.** `vernemq` autentica contra PostgreSQL y seeds SQL. Cambios de `DB_NAME`, usuario o timing de arranque pueden impedir conexiones MQTT.
11. **Reverse proxy externo no representado.** Los puertos `127.0.0.1` sugieren exposición a través de proxy del host. La migración debe revisar nginx/systemd externo antes de cambiar puertos o dominios.
12. **Variables duplicadas o ambiguas.** En el ejemplo actual existen claves duplicadas como `ENABLE_SUBMISSION` y `ENABLE_SMTPS`; antes de crear nuevos ejemplos hay que normalizar sin alterar el despliegue existente.

## Fases de migración propuestas

### Fase 0 — Congelar e inventariar

- Mantener `docker-compose.yml` como única fuente operativa.
- Guardar la salida actual de `docker compose config` como baseline no secreto para comparar estructura.
- Inventariar variables usadas por Compose, scripts de despliegue, nginx externo y cada `env_file` por servicio.
- Documentar comandos exactos que se usan hoy en `horizonst.com.es` para deploy, restart, logs, backup y restore.

Criterio de salida:

- Existe un inventario revisado y no se han cambiado servicios en producción.

### Fase 1 — Crear ejemplos de entorno sin usarlos en producción

- Crear `.env.prod.example` y `.env.stage.example` con placeholders seguros.
- No sustituir `.env` ni los `.env` de servicios todavía.
- Validar que todos los placeholders necesarios están documentados.

Criterio de salida:

- Los ejemplos cubren todas las variables requeridas sin exponer secretos reales.

### Fase 2 — Crear capas Compose en paralelo

- Crear `infrastructure/docker/compose.*.yml` copiando la configuración actual por capas.
- No eliminar ni modificar el `docker-compose.yml` raíz.
- Mantener nombres de servicios, redes, volúmenes y puertos.
- Usar `docker compose --project-directory . -f ... config` para comparar con el baseline.

Criterio de salida:

- La combinación `base + prod` genera una configuración equivalente para el core.
- La combinación `base + prod + mail` reproduce la pila de correo con perfiles.
- La combinación `base + stage + admin + demo` levanta en un entorno no productivo.

### Fase 3 — Ensayo en stage

- Desplegar solo en un host o namespace de stage.
- Validar arranque, healthchecks, migraciones, persistencia, MQTT, RFID, correo transaccional desactivado/sandbox y reverse proxy.
- Ejecutar pruebas de rollback: detener stack nuevo y volver al Compose raíz sin tocar datos productivos.

Criterio de salida:

- Stage funciona con las capas nuevas y hay checklist de rollback probado.

### Fase 4 — Producción en modo shadow/controlado

- Preparar `.env.prod` real fuera de Git.
- Validar `docker compose config` en producción sin ejecutar `up`.
- Si es posible, probar `pull/build` sin recrear servicios críticos.
- Programar ventana de mantenimiento.

Criterio de salida:

- Configuración productiva generada coincide con la intención y no cambia nombres/puertos/volúmenes.

### Fase 5 — Cutover controlado

- Ejecutar la pila por capas con el mismo project name usado actualmente.
- Verificar que Compose reutiliza contenedores/volúmenes esperados y no crea duplicados.
- Validar healthchecks, endpoints HTTP, MQTT, base de datos, correo y logs.
- Mantener `docker-compose.yml` raíz como fallback durante una ventana acordada.

Criterio de salida:

- Producción funciona con Compose por capas y rollback sigue disponible.

### Fase 6 — Limpieza posterior

- Actualizar documentación operativa y scripts de deploy.
- Marcar `docker-compose.yml` raíz como legacy o reemplazarlo por instrucciones cuando ya no se use.
- Solo entonces considerar mover archivos auxiliares, normalizar rutas y retirar compatibilidad antigua.

Criterio de salida:

- El equipo opera con `infrastructure/docker` y no depende del Compose raíz salvo para histórico.

## Checklist antes de tocar producción

- [ ] Backup reciente y probado de PostgreSQL.
- [ ] Backup o snapshot de volúmenes `postgres_data`, `vernemq_data`, `vernemq_log` y volúmenes de correo si se usa mailserver.
- [ ] Confirmación del project name actual de Docker Compose.
- [ ] Comparación de `docker compose config` entre Compose raíz y Compose por capas.
- [ ] Confirmación de que no cambian nombres de servicios, red, volúmenes ni puertos.
- [ ] Confirmación DNS/certificados antes de usar `horizonst.es`.
- [ ] Validación de reverse proxy externo.
- [ ] Plan de rollback con comandos concretos.
