# Bootstrap limpio de producción

Esta carpeta contiene documentación y plantillas seguras para preparar un servidor nuevo de producción `horizonst.es` sin arrastrar datos históricos de `horizonst.com.es`.

## Contenido

- `horizonst-clean-init.md`: pasos para crear la base principal `horizonst`, aplicar esquema, seed seguro de admin e importar ACL MQTT.
- `horizonst-admin-seed-template.sql`: plantilla SQL parametrizada para crear/rotar el admin principal sin tocar `db/seed.sql`.
- `cold-compliance-clean-init.md`: pasos para crear `cold_compliance`, aplicar migraciones e importar únicamente usuarios técnicos/aplicación aprobados.
- `mqtt-acl-import-template.sql`: plantilla de import desde CSV externo de `vmq_auth_acl`.
- `app-users-import-template.sql`: plantilla de import desde CSV externo de usuarios técnicos/aplicación de `cold_compliance.app_users`.
- `mail-accounts-horizonst-es.example`: plantilla sin secretos para buzones y alias de correo.

## Reglas

- No guardar en Git CSV reales, dumps, contraseñas, hashes sensibles nuevos ni claves privadas.
- Generar los ficheros privados en `/root/horizonst-clean-bootstrap/private` o una ruta equivalente fuera del repositorio.
- No aplicar seeds de demo en producción.
- No importar `auth_sessions`, `password_reset_tokens`, logs, eventos, alarmas, sesiones, correos antiguos ni datos de negocio.
