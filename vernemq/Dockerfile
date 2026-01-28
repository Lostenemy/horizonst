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

RUN luarocks install bcrypt \
  && lua -e "require('bcrypt')"

USER vernemq
