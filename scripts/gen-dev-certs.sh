#!/bin/sh
set -eu

FQDN="${FQDN:-mail.horizonst.com.es}"
SSL_DIR="/work/ssl"
CA_DIR="$SSL_DIR/demoCA"
KEY="$SSL_DIR/${FQDN}-key.pem"
CRT="$SSL_DIR/${FQDN}-cert.pem"
CACERT="$CA_DIR/cacert.pem"
CAKEY="$CA_DIR/cakey.pem"

mkdir -p "$CA_DIR"

# Si ya existen, salir rápido (idempotente)
if [ -s "$KEY" ] && [ -s "$CRT" ] && [ -s "$CACERT" ]; then
  echo "[cert-init] Certs already present. Nothing to do."
  exit 0
fi

echo "[cert-init] Generating DEV self-signed certs for $FQDN ..."

# 1) CA de desarrollo (solo para firmar el cert del servidor)
if [ ! -s "$CACERT" ] || [ ! -s "$CAKEY" ]; then
  openssl req -x509 -newkey rsa:4096 -nodes -days 3650 \
    -subj "/CN=HorizonST Dev CA" \
    -keyout "$CAKEY" \
    -out "$CACERT"
fi

# 2) Clave + CSR del servidor
CSR="$(mktemp)"
openssl req -newkey rsa:4096 -nodes \
  -subj "/CN=${FQDN}" \
  -keyout "$KEY" \
  -out "$CSR"

# 3) Firma con la CA
openssl x509 -req -days 825 \
  -in "$CSR" \
  -CA "$CACERT" \
  -CAkey "$CAKEY" -CAcreateserial \
  -extfile /dev/stdin \
  -out "$CRT" <<EOF2
subjectAltName=DNS:${FQDN},DNS:horizonst.com.es
EOF2

rm -f "$CSR"
chmod 600 "$KEY" "$CAKEY"
echo "[cert-init] DONE."
