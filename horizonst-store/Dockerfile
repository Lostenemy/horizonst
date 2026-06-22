FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig*.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4020
RUN apk add --no-cache wget
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY migrations ./migrations
EXPOSE 4020
HEALTHCHECK --interval=20s --timeout=4s --retries=5 CMD wget -qO- http://127.0.0.1:4020/health || exit 1
CMD ["node","dist/server.js"]
