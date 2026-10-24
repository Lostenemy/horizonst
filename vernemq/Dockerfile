FROM vernemq/vernemq:1.13.0@sha256:0810947d3c7cafd85b9a662e9dbdbaa6077d14cc9dc3da8d40c2d71466392307

USER root

# Bullseye is archived: expiry waiver is scoped to its signed historic indexes.
# Package signatures and TLS verification are not disabled.
RUN printf '%s\n' \
    'deb [check-valid-until=no] http://archive.debian.org/debian bullseye main' \
    'deb [check-valid-until=no] http://archive.debian.org/debian-security bullseye-security main' \
    > /etc/apt/sources.list \
  && apt-get update && apt-get install -y --no-install-recommends \
    lua5.3 \
    liblua5.3-dev \
    luarocks \
    build-essential \
    libssl-dev \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY infrastructure/security/emudhra/ /tmp/horizonst-security/
RUN cd /tmp/horizonst-security \
  && sha256sum -c SHA256SUMS \
  && sh install-vernemq-trust.sh \
  && rm -rf /tmp/horizonst-security

RUN mkdir -p /vernemq/.luarocks \
  && chown -R vernemq:vernemq /vernemq/.luarocks

USER vernemq

RUN luarocks --tree=/vernemq/.luarocks install bcrypt \
  && eval "$(luarocks --tree=/vernemq/.luarocks path)" \
  && lua -e "require('bcrypt')"

USER root

RUN mkdir -p /vernemq/share/lua \
  && find /vernemq/.luarocks -type f \( -name "bcrypt.lua" -o -name "bcrypt.so" -o -name "*bcrypt*.so" \) -print \
  && (find /vernemq/.luarocks -type f -name "bcrypt.lua" -exec cp -v {} /vernemq/share/lua/bcrypt.lua \; || true) \
  && (find /vernemq/.luarocks -type f \( -name "bcrypt.so" -o -name "*bcrypt*.so" \) -exec cp -v {} /vernemq/share/lua/ \; || true) \
  && ls -la /vernemq/share/lua

COPY --chown=vernemq:vernemq vernemq/vernemq.conf /opt/horizonst/vernemq.conf
COPY --chown=vernemq:vernemq vernemq/start-vernemq.sh /usr/local/bin/start-horizonst-vernemq
COPY --chown=vernemq:vernemq vernemq/validate-runtime.sh /usr/local/bin/validate-vernemq-runtime

RUN chmod 0755 /usr/local/bin/start-horizonst-vernemq /usr/local/bin/validate-vernemq-runtime

USER vernemq

CMD ["/usr/local/bin/start-horizonst-vernemq"]
