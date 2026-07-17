FROM vernemq/vernemq:1.13.0

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    lua5.3 \
    liblua5.3-dev \
    luarocks \
    build-essential \
    libssl-dev \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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
