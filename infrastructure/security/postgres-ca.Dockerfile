FROM postgres:15-alpine@sha256:3d0f7584ed7d04e27fa050d6683a74746608faf21f202be78460d679cc56461f AS ca-patched
RUN apk add --no-cache --upgrade 'ca-certificates-bundle>=20261020-r0'

FROM ca-patched AS trust-test
RUN apk add --no-cache openssl
COPY infrastructure/security/emudhra/ /tmp/horizonst-security/
RUN cd /tmp/horizonst-security \
 && sha256sum -c SHA256SUMS \
 && sh verify-bundle.sh /etc/ssl/certs/ca-certificates.crt \
 && sha256sum /etc/ssl/certs/ca-certificates.crt > /tmp/trust-validated.sha256

FROM ca-patched
COPY --from=trust-test /tmp/trust-validated.sha256 /usr/local/share/horizonst-trust-validated.sha256
RUN sha256sum -c /usr/local/share/horizonst-trust-validated.sha256
