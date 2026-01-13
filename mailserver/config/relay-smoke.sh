#!/bin/bash
set -euo pipefail

RELAY_HOST=${RELAY_HOST:-}
RELAY_PORT=${RELAY_PORT:-587}
RECIPIENT=${1:-postmaster@horizonst.com.es}

if [[ -z "${RELAY_HOST}" ]]; then
  echo "RELAY_HOST no está definido; configura mailserver.env" >&2
  exit 1
fi

echo "[1/4] Resolviendo ${RELAY_HOST}..."
getent ahosts "${RELAY_HOST}" | head -n 1

if [[ "${RELAY_PORT}" == "465" ]]; then
  echo "[2/4] Probando TLS directo contra ${RELAY_HOST}:${RELAY_PORT}"
  openssl s_client -connect "${RELAY_HOST}:${RELAY_PORT}" -brief -quiet </dev/null
else
  echo "[2/4] Probando STARTTLS contra ${RELAY_HOST}:${RELAY_PORT}"
  openssl s_client -starttls smtp -connect "${RELAY_HOST}:${RELAY_PORT}" -brief -quiet </dev/null
fi

MAIL_FROM=${RELAY_USER:-"notificaciones@horizonst.com.es"}
QUEUE_ID=""

echo "[3/4] Enviando correo de humo a ${RECIPIENT} desde ${MAIL_FROM}"
cat <<MESSAGE | sendmail -t
From: ${MAIL_FROM}
To: ${RECIPIENT}
Subject: Prueba relé docker-mailserver

Correo de prueba enviado a través del relé configurado en docker-mailserver.
MESSAGE

sleep 3

if postqueue -p | grep -q "Mail queue is empty"; then
  echo "[4/4] Cola de Postfix vacía tras el envío (sin defer conocidos)." 
else
  echo "[4/4] Revisa la cola de Postfix; hay mensajes pendientes:" >&2
  postqueue -p >&2
  exit 2
fi

echo "Consulta /var/log/mail/mail.log para confirmar el relayhost utilizado."
