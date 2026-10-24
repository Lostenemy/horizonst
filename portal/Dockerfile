FROM nginx:1.27-alpine
RUN apk add --no-cache --upgrade 'ca-certificates>=20261020-r0' 'ca-certificates-bundle>=20261020-r0'
COPY public /usr/share/nginx/html
