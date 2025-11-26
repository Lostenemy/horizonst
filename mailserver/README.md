# Mailserver operativo (Postfix/Dovecot)

Esta carpeta deja listo el contenedor de correo para envío/recepción con TLS y persistencia completa.

## Puertos expuestos
- 25/TCP SMTP (entrante opcional)
- 465/TCP SMTPS (TLS desde el arranque)
- 587/TCP Submission con STARTTLS obligatorio
- 993/TCP IMAPS

## Volúmenes y persistencia
- `mail_data:/var/mail` (Maildir)
- `mail_state:/var/mail-state` (estado interno de docker-mailserver)
- `mail_dovecot:/var/lib/dovecot` (índices/estado)
- `mail_spool:/var/spool/postfix` (cola de Postfix)
- `mail_postfix_conf:/etc/postfix` y `mail_dovecot_conf:/etc/dovecot` (config efectiva)
- `dkim_conf:/etc/opendkim` (claves y config DKIM)
- `mail_logs:/var/log/mail` (logs del MTA/IMAP)
- `./mailserver/config:/tmp/docker-mailserver` (overrides, cuentas/aliases)
- `./mailserver/config/ssl:/tmp/docker-mailserver/ssl` (certificados `*-cert.pem` y `*-key.pem`)

## TLS
- Certificados manuales montados en `/tmp/docker-mailserver/ssl/` (se generan en dev con `cert-init`).
- Postfix usa `TLS_LEVEL=modern`, `smtpd_tls_auth_only=yes` y `submission_tls_security_level=encrypt`.
- Dovecot sirve IMAPS con TLS obligatorio.

### Relé saliente requerido
- El puerto 25 saliente está bloqueado, así que docker-mailserver enviará vía relé autenticado.
- Configura en `mailserver.env`:
  - `RELAY_HOST` y `RELAY_PORT` (587 recomendado, STARTTLS; 465 para SMTPS).
  - `RELAY_USER` y `RELAY_PASSWORD` (credenciales del proveedor).
  - `ENABLE_SUBMISSION=true`, `ENABLE_SMTPS=true`, `TLS_LEVEL=modern`, `ENABLE_OPENDKIM=1`, `ENABLE_OPENDMARC=1`, `ENABLE_POLICYD_SPF=1` ya están fijados.
  - No es necesario editar `main.cf`; docker-mailserver genera `relayhost` y `smtp_sasl_password_maps` automáticamente.
  - Usa el bundle de CA del sistema para validar el relé (montaje extra no requerido salvo CA privada).

## Provisioning de cuentas y aliases
- Formato `postfix-accounts.cf`: `user@domain|hash_sha512`. Se incluyen:
  - `notificaciones@horizonst.com.es`
  - `admin@horizonst.com.es`
  - `no_reply@horizonst.com.es`
- El hash actual corresponde a la contraseña `HoriMail#2024`; cambia la contraseña con `docker compose exec mail setup email update user@domain newpass` y actualiza el hash en el fichero para que el arranque sea idempotente.
- Aliases en `postfix-aliases.cf` (p.ej. `contacto@` y `soporte@` → `notificaciones@`).

## DKIM/DMARC
- DKIM activado (`ENABLE_OPENDKIM=1`). Selector por defecto: `mail`.
- Genera clave y TXT: `docker compose run --rm mail setup config dkim` y luego `docker compose exec mail cat /etc/opendkim/keys/horizonst.com.es/mail.txt`.
- Publica el TXT devuelto en DNS (`mail._domainkey.horizonst.com.es`). Guarda el fichero en el volumen `dkim_conf` para persistencia.

## Healthchecks y humo manual
- El servicio define un healthcheck Docker: `nc -z localhost 587 && nc -z localhost 993`.
- Comprobaciones rápidas:
  - `docker compose exec mail postconf -n` y `doveconf -n` (sin errores).
  - `openssl s_client -starttls smtp -connect localhost:587 -quiet` debe mostrar banner y permitir `EHLO`.
  - `openssl s_client -connect localhost:465 -quiet` debe negociar TLS.
  - `nc -z localhost 993` confirma IMAPS.
  - Enviar prueba a `postmaster@horizonst.com.es` y a un dominio externo; revisar logs en `/var/log/mail/`.
  - Verificar el relé: `docker compose exec mail /tmp/docker-mailserver/relay-smoke.sh external@example.com`.

## Smoke test del relé (script)
- Script en `/tmp/docker-mailserver/relay-smoke.sh` (montado desde `mailserver/config`).
- Ejecuta:
  - Resolución DNS de `RELAY_HOST`.
  - Negociación TLS con `openssl s_client` (STARTTLS si puerto 587, TLS directo si 465).
  - Envío de un correo simple vía Postfix al destinatario indicado (por defecto `postmaster@horizonst.com.es`).
- Ejemplo: `docker compose exec mail /tmp/docker-mailserver/relay-smoke.sh prueba@gmail.com`.
- Revisa `/var/log/mail/mail.log` para confirmar que no hay `deferred`.

## Checklist DNS/Reputación
- SPF (horizonst.com.es): incluir el dominio del relé y los registros `a`/`mx` según el proveedor (ej.: `v=spf1 a mx include:<relay-domain> -all`).
- DKIM: publicar la clave en `mail._domainkey.horizonst.com.es` generada con `setup config dkim`.
- DMARC recomendado: `v=DMARC1; p=quarantine; rua=mailto:dmarc@horizonst.com.es; ruf=mailto:dmarc@horizonst.com.es; fo=1` (ajusta política según necesidad).
- PTR/rDNS: si se usa relé, prevalece el rDNS del relé; si se abre 25 directamente, pedir que apunte a `mail.horizonst.com.es`.

## Notas
- Si la red bloquea el puerto 25 saliente, las entregas directas se aplazarán; documenta en logs y considera relé externo. Los clientes seguirán enviando por 587/465.
- Logs rotan vía driver `json-file` (50MB × 3). Ajusta `LOG_LEVEL` en `mailserver.env` si necesitas más detalle.
