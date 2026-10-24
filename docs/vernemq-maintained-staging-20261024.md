# VerneMQ y recetas permanentes — staging, 24/10/2026

Registro actualizado: 2026-10-24T20:57:53.355264+00:00. Servidor horizonst / 91.98.161.67.
Alcance: solo staging. No se ha conectado ni modificado producción durante esta intervención.

## Resultado aplicado

- Recetas de seguridad procedentes de origin/main 711b95c0e5bda273ecf1f104d976161ffbe63494 integradas selectivamente en el árbol de staging.
- Rama de trabajo: codex/staging-maintained-vernemq-20261024. No se ha hecho commit ni push; no se ha incorporado el historial divergente de producción.
- Los cuatro Dockerfiles de aplicaciones que ya estaban modificados permanecen exactamente iguales a su estado previo.
- Broker y observador migrados de VerneMQ 1.13 / Debian 11 a VerneMQ 2.2.1 / Debian 13 / OTP 27.
- Imagen oficial base fijada: vernemq/vernemq@sha256:d6333975f7c887cfd8943074b084114c033425d61017e1f985e1ef6887610d9f.
- No se ha cambiado la lógica de B5, alarmas, presencia, autenticación de aplicaciones ni base de datos.
- Solo se han detenido/recreado/reiniciado broker y observador. No se ha reiniciado el host, Docker, PostgreSQL, Nginx, correo, VPN ni Aileads.

## Imágenes efectivamente activas

- horizonst-vernemq-1: sha256:055f9b24fcaeb1e5dff8f04a5c1bdbd1f4216f5ec8c24c608dd39f597af2719b, healthy.
- horizonst-vernemq_observer-1: sha256:735ab9bf01e13bf7d09d3625c04a2baf457a941cb6dcf12309f482554b9003b0, healthy.

Etiquetas operativas: horizonst-vernemq:maintained-2.2.1-20261024 y
horizonst-vernemq_observer:maintained-2.2.1-20261024.

## Protección de reconstrucciones

- docker-compose.yml usa vernemq/Dockerfile.maintained y vernemq-observer/Dockerfile.maintained.
- Ambas recetas se construyen directamente desde la imagen oficial fijada. El observador no depende de que exista una imagen local intermedia.
- infrastructure/security/emudhra conserva certificados públicos, checksums y regresiones negativas.
- install-vernemq-trust.sh descubre de forma inequívoca las rutas de OTP, release y certifi; recompila con la misma versión OTP y comprueba sistema, PEM y BEAM.
- Las recetas antiguas de broker y observador también tienen la protección para conservar una alternativa reproducible.
- PostgreSQL añade infraestructura de construcción permanente y conserva su base 15.15 fijada por digest; no se ha reconstruido ni reiniciado el contenedor activo.
- portal y mqtt-ui actualizan ca-certificates y ca-certificates-bundle con mínimo 20261020-r0. Actualizar solo bundle no bastaba: la versión antigua de ca-certificates podía regenerar una lista vulnerable.
- Se ha incorporado el guard publicado de artefactos públicos; su self-test pasa y sigue rechazando claves privadas y archivos ajenos a la lista permitida.
- Los contextos Docker específicos excluyen .env, respaldos y otros archivos ajenos.

Reconstrucción futura de los servicios afectados (no despliega por sí sola):

~~~sh
cd /opt/horizonst
docker compose build vernemq vernemq_observer postgres portal mqtt_ui
~~~

## Almacenamiento y autorización

El cambio de formato de metadatos desde VerneMQ 2.1 impide abrir directamente el almacenamiento 1.13.
Antes del cambio había tres sesiones clean_session=true, ninguna sesión persistente,
contador de entrada/salida en cola cero y dos mensajes retenidos en temas de comandos de gateways.

El usuario autorizó expresamente respaldar y arrancar limpio sin reenviar esos comandos.
Se detuvo el broker antes del respaldo y se archivaron datos, configuración y logs.
No se leyeron ni publicaron los payloads para probar la migración.
Los volúmenes originales se conservan intactos y no se reutilizaron en 2.2.1.

Volúmenes nuevos explícitos:
- horizonst_vernemq_maintained_data_20261024 -> /vernemq/data.
- horizonst_vernemq_maintained_etc_20261024 -> /vernemq/etc.
- horizonst_vernemq_maintained_log_20261024 -> /vernemq/log.

Después del cambio: tres sesiones online y cero mensajes retenidos.
Las credenciales y variables operativas explícitas se compararon sin imprimir sus valores.
Se mantuvieron puertos, hostname, red y límites existentes.

## Evidencia de validación

- Cinco recetas heredadas reconstruidas: broker, observador, PostgreSQL, portal y mqtt-ui.
- PostgreSQL reconstruido en pruebas conserva 15.15; no se ha subido de versión el servicio.
- Candidato 2.2.1 probado antes del despliegue en una red Docker interna, sin puertos publicados,
  con PostgreSQL desechable, usuarios ficticios y temas test/migration.
- Siete pruebas MQTT: rechazo de contraseña incorrecta; login PostgreSQL/bcrypt;
  publicación/suscripción QoS1; rechazo de suscripción prohibida; entrega retenida;
  sesión persistente y entrega offline; publicación prohibida no entregada.
- Reinicio del candidato: sesión persistente y retenido sintéticos conservados.
- Observador candidato: RPC administrativo remoto por DNS y health correctos.
- Broker y observador reales saludables tras reiniciarse; Backend reconectó.
- Backend 3000, Horneo 3100 y MQTT UI API 4010 responden status=ok.
- Tres almacenes de cada contenedor 2.2.1 desplegado rechazan 14/14 cadenas comprometidas:
  bundle del sistema, PEM certifi y certificados compilados del módulo BEAM.
- Pruebas TLS en ambos contenedores definitivos: www.python.org aceptado,
  dos variantes comprometidas rechazadas con unknown_ca.
- Compose verificado: demás servicios, PostgreSQL, red y volúmenes históricos conservados.
- Los contenedores, volúmenes y red creados exclusivamente para los tests fueron retirados.
- No se han enviado correos ni comandos a gateways/tags como prueba.

Los fallos preliminares se resolvieron antes de desplegar:
nombre de nodo y listener del fixture; aserción del texto de rechazo MQTT;
configuración administrativa del observador; actualización incompleta del paquete Alpine.

Limitaciones: no se ha probado una acción física B5/SOS ni una nueva lectura de una gateway real.
La prueba sintética no acredita esos flujos. No se ha probado un reinicio completo del servidor.
No se ha acreditado el estado de suscripción comercial de VerneMQ; la instalación conservó
la aceptación existente y esta prueba no sustituye la comprobación de licencia antes de producción.

## Respaldos y reversión acotada

Directorio protegido: /opt/horizonst/backups/vernemq-maintained-staging-5vDWSpkr.
Archivos:
- recipes-before.tar y preexisting.patch: estado anterior de recetas y cambios previos.
- config-cutover.tar: configuración y fuentes en el momento del cambio.
- vernemq-data.tar, vernemq-etc.tar, vernemq-log.tar: respaldo con broker detenido.
- backup-sha256.txt: huellas de los cuatro archivos de corte.
- broker-containers-before.json y stopped-original.json: identidad y montajes originales.
- compose-before-cutover.yml, rollback-compose.yml y rollback-broker.sh.
- Logs de builds y pruebas MQTT/TLS, y services-final.txt.

El script de retorno restaura solo Compose y los dos servicios MQTT a sus imágenes anteriores
ya conservadas. Usa almacenamiento de retorno nuevo para NO reproducir los dos comandos históricos;
no vuelve a montar a ciegas los metadatos archivados ni toca PostgreSQL ni otros servicios.

~~~sh
sudo bash /opt/horizonst/backups/vernemq-maintained-staging-5vDWSpkr/rollback-broker.sh
~~~

Después del retorno hay que verificar health de ambos contenedores y reconexión del Backend.
El retorno no importa el estado que pudiera haberse generado en el broker nuevo.
Los volúmenes históricos y los respaldos no deben eliminarse ni restaurarse sobre los nuevos.

## Fuentes oficiales

- Imagen mantenida Debian trixie: https://github.com/vernemq/docker-vernemq/blob/master/Dockerfile
- Incompatibilidad de formato: https://github.com/vernemq/vernemq/releases/tag/2.1.0
- Licencia de binarios e imagen: https://vernemq.com/downloads/index.html
- Recetas publicadas: https://github.com/Lostenemy/horizonst/commit/711b95c0e5bda273ecf1f104d976161ffbe63494
