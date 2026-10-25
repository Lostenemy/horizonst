FROM node:22.23.4-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db

RUN apk add --no-cache --upgrade "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0" "brotli-libs>=1.2.1-r0"
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 4010

CMD ["npm", "start"]
