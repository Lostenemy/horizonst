#!/bin/sh
set -eu

CN="${CERT_CN:-mail.horizonst.com.es}"
SSL_DIR="${SSL_DIR:-/tmp/docker-mailserver/ssl}"
CA_DIR="${SSL_DIR}/demoCA"
KEY="${SSL_DIR}/${CN}-key.pem"
CRT="${SSL_DIR}/${CN}-cert.pem"
CACERT="${CA_DIR}/cacert.pem"

echo "[cert-init] Generating DEV self-signed certs for ${CN} ..."

mkdir -p "${CA_DIR}"

# Generar cert y key si faltan o están vacíos
if [ ! -s "${KEY}" ] || [ ! -s "${CRT}" ]; then
  openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
    -subj "/CN=${CN}" \
    -keyout "${KEY}" \
    -out    "${CRT}"
fi

# Asegurar cacert.pem
if [ ! -s "${CACERT}" ]; then
  cp "${CRT}" "${CACERT}"
fi

chmod 600 "${KEY}" "${CACERT}"

echo "[cert-init] Done. Files present in ${SSL_DIR}:"
ls -l "${SSL_DIR}" || true
