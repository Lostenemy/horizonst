#!/bin/sh
set -euo pipefail

MAIL_HOST="${MAIL_HOST:-mail.horizonst.com.es}"

openssl s_client -connect 127.0.0.1:993 -servername "$MAIL_HOST" </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates

openssl s_client -connect 127.0.0.1:465 -servername "$MAIL_HOST" </dev/null 2>/dev/null \
  | grep -E "Verify return code|subject|issuer" || true

docker compose logs --tail=100 mail | (! grep -q "TLS Setup .* does not exist")
