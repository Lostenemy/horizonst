FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS deps
RUN apk add --no-cache --upgrade "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0" "brotli-libs>=1.2.1-r0"
WORKDIR /app
COPY package*.json ./
COPY web/package*.json ./web/
RUN npm ci
RUN npm ci --prefix web

FROM deps AS build
COPY tsconfig*.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
COPY resources ./resources
RUN npm run build

FROM deps AS test
COPY tsconfig*.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
COPY resources ./resources
COPY test ./test
COPY migrations ./migrations
RUN npm test

FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runtime
RUN apk add --no-cache --upgrade "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0" "brotli-libs>=1.2.1-r0"
WORKDIR /app
ENV NODE_ENV=production PORT=4020
RUN apk add --no-cache wget
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY migrations ./migrations
COPY resources ./resources
EXPOSE 4020
HEALTHCHECK --interval=20s --timeout=4s --retries=5 CMD wget -qO- http://127.0.0.1:4020/health || exit 1
CMD ["node","dist/server.js"]
