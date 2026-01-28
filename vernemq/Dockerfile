FROM vernemq/vernemq:1.13.0

USER root

RUN apk add --no-cache \
    lua5.3 \
    lua5.3-dev \
    luarocks \
    gcc \
    make \
    musl-dev \
    openssl-dev

RUN luarocks install bcrypt \
  && lua -e "require('bcrypt')"

USER vernemq
