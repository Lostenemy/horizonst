ARG APPLICATION_IMAGE
FROM ${APPLICATION_IMAGE}
ARG APPLICATION_USER=0
USER 0
RUN set -eu; \
 . /etc/os-release; \
 case "$VERSION_CODENAME" in \
  bookworm) minimum=1.0.9-2+deb12u1 ;; \
  trixie) minimum=1.1.0-2+deb13u1 ;; \
  *) echo "Unsupported distribution; no speculative upgrade" >&2; exit 1 ;; \
 esac; \
 sha256sum /etc/ssl/certs/ca-certificates.crt >/tmp/brotli-ca-before.sha256; \
 apt-get update; \
 apt-get install -y --no-install-recommends --only-upgrade libbrotli1; \
 installed=$(dpkg-query -W -f='${Version}' libbrotli1); \
 dpkg --compare-versions "$installed" ge "$minimum"; \
 sha256sum -c /tmp/brotli-ca-before.sha256; \
 rm /tmp/brotli-ca-before.sha256; \
 rm -rf /var/lib/apt/lists/*
USER ${APPLICATION_USER}
