FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/web ./web
COPY package*.json ./
EXPOSE 3100
HEALTHCHECK --interval=20s --timeout=3s --retries=5 CMD wget -qO- "http://127.0.0.1:${PORT:-3100}/health" || exit 1
CMD ["node", "dist/index.js"]
