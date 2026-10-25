FROM node:22.23.4-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db AS deps
RUN apk add --no-cache --upgrade "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0" "brotli-libs>=1.2.1-r0"
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22.23.4-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db AS build
RUN apk add --no-cache --upgrade "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0" "brotli-libs>=1.2.1-r0"
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.23.4-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db
RUN apk add --no-cache --upgrade "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0" "brotli-libs>=1.2.1-r0"
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/web ./web
EXPOSE 3100
HEALTHCHECK --interval=20s --timeout=3s --retries=5 CMD wget -qO- "http://127.0.0.1:${PORT:-3100}/health" || exit 1
CMD ["node", "dist/index.js"]
