FROM node:20-alpine AS build
WORKDIR /usr/src/app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY public ./public
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/public ./public

EXPOSE 3000
CMD ["node", "dist/index.js"]
