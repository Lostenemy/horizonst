#!/bin/sh
set -euo pipefail

CN="${CERT_CN:-mail.horizonst.com.es}"
SSL_DIR="${SSL_DIR:-/tmp/docker-mailserver/ssl}"
CERT="${SSL_DIR}/${CN}-cert.pem"
KEY="${SSL_DIR}/${CN}-key.pem"
CA_DIR="${SSL_DIR}/demoCA"
CACERT="${CA_DIR}/cacert.pem"

apk add --no-cache openssl >/dev/null 2>&1 || true

mkdir -p "$SSL_DIR" "$CA_DIR"

if [ -s "$KEY" ] && [ -s "$CERT" ] && [ -s "$CACERT" ]; then
  echo "[cert-init] Certificates already present. Skipping generation."
  exit 0
fi

echo "[cert-init] Generating self-signed certificate for ${CN} ..."

openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -subj "/CN=${CN}" \
  -keyout "$KEY" \
  -out "$CERT"

if [ ! -s "$CACERT" ]; then
  cp "$CERT" "$CACERT"
fi

chmod 600 "$KEY" "$CERT" "$CACERT"

echo "[cert-init] Ready:"
ls -l "$SSL_DIR" || true
