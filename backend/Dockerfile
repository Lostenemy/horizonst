# ---------- build ----------
FROM node:22.23.4-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db AS build
RUN apk add --no-cache --upgrade "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0" "brotli-libs>=1.2.1-r0"
WORKDIR /usr/src/app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY public ./public
COPY migrations ./migrations
RUN npm run build

# ---------- runtime ----------
FROM node:22.23.4-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db AS runtime
RUN apk add --no-cache --upgrade "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0" "brotli-libs>=1.2.1-r0"
WORKDIR /usr/src/app
ENV NODE_ENV=production

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/public ./public
COPY --from=build /usr/src/app/migrations ./migrations

EXPOSE 3000
CMD ["node", "dist/index.js"]
