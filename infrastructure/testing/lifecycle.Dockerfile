# Disposable validation only. Production Dockerfiles and their runtime versions are not changed.
FROM node:22.23.4-alpine AS backend-build
WORKDIR /app
COPY backend/package*.json backend/tsconfig.json ./
RUN npm ci
COPY backend/src ./src
RUN npm run build

FROM node:22.23.4-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/dist ./dist
COPY backend/public ./public
COPY backend/migrations ./migrations
CMD ["node", "dist/index.js"]

FROM node:22.23.4-alpine AS horneo-build
WORKDIR /app
COPY cold-compliance-service/package*.json cold-compliance-service/tsconfig.json ./
RUN npm ci
COPY cold-compliance-service/src ./src
RUN npm run build

FROM node:22.23.4-alpine AS horneo
WORKDIR /app
ENV NODE_ENV=production
COPY cold-compliance-service/package*.json ./
RUN npm ci --omit=dev
COPY --from=horneo-build /app/dist ./dist
COPY cold-compliance-service/migrations ./migrations
COPY cold-compliance-service/web ./web
CMD ["node", "dist/index.js"]

FROM node:22.23.4-alpine AS store-build
WORKDIR /app
COPY horizonst-store/package*.json ./
COPY horizonst-store/web/package*.json ./web/
RUN npm ci && npm ci --prefix web
COPY horizonst-store/tsconfig*.json ./
COPY horizonst-store/src ./src
COPY horizonst-store/web/src ./web/src
COPY horizonst-store/web/public ./web/public
COPY horizonst-store/web/index.html horizonst-store/web/tsconfig.json horizonst-store/web/vite.config.ts ./web/
COPY horizonst-store/scripts ./scripts
COPY horizonst-store/resources ./resources
RUN npm run build

FROM node:22.23.4-alpine AS store
WORKDIR /app
ENV NODE_ENV=production PORT=4020
COPY horizonst-store/package*.json ./
RUN npm ci --omit=dev
COPY --from=store-build /app/dist ./dist
COPY --from=store-build /app/web/dist ./web/dist
COPY horizonst-store/migrations ./migrations
COPY horizonst-store/resources ./resources
CMD ["node", "dist/server.js"]

FROM eclipse-mosquitto:2 AS broker
COPY infrastructure/testing/lifecycle-mosquitto.conf /mosquitto/config/mosquitto.conf
