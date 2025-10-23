FROM node:20-alpine AS build
WORKDIR /usr/src/app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:20-alpine
WORKDIR /usr/src/app
COPY --from=build /usr/src/app/package.json ./package.json
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/public ./public
COPY .env.example .env
CMD ["node", "dist/index.js"]
