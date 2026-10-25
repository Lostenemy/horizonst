ARG APPLICATION_IMAGE
FROM ${APPLICATION_IMAGE}
ARG APPLICATION_USER=0
ARG BROTLI_MINIMUM
USER 0
RUN set -eu; \
 test -n "$BROTLI_MINIMUM"; \
 sha256sum /etc/ssl/certs/ca-certificates.crt >/tmp/brotli-ca-before.sha256; \
 apk add --no-cache --upgrade "brotli-libs>=$BROTLI_MINIMUM"; \
 sha256sum -c /tmp/brotli-ca-before.sha256; \
 rm /tmp/brotli-ca-before.sha256
USER ${APPLICATION_USER}
