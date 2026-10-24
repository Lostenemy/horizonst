# Reconstrucción con confianza eMudhra corregida

## Alcance
Recetas permanentes para producción,sin cambios de lógica,datos o alarmas.
VerneMQ conserva1.13.0/OTP25 con backport de confianza certifi2.18.0;no es migración a distribución mantenida.
PostgreSQL conserva15.18. Bases fijadas por digest.

## Construcción y protección
- vernemq/Dockerfile retira las raíces afectadas de sistema y recompila la lista certifi antes de descargas LuaRocks.
- Sistema,PEM y lista Erlang compilada deben rechazar14 cadenas públicas durante cada build.
- infrastructure/security/postgres-ca.Dockerfile exige bundle>=20261020-r0. Comprueba14 rechazos en etapa separada y verifica hash del bundle final,sin añadir OpenSSL CLI al runtime.
- Dockerfile.dockerignore limita cada contexto a fuentes necesarias y pruebas públicas,excluyendo el resto del checkout.
- SHA256SUMS valida datos/fuentes vendorizados. Tar certifi2.18.0 SHA256 a8b61115e393a2298b20451a36beffdabe08e61bc16cc1926d7991f6721103bf.
- Fixtures con fecha fija2026-10-24T12:00UTC evitan falsos rechazos por expiración. La verificación TLS de aplicaciones mantiene fecha actual.
- Bullseye está fuera de LTS. Solo su build usa archive.debian.org e índices históricos firmados con check-valid-until=no. Firmas y TLS no se deshabilitan;repositorios del host no cambian. Migrar a base mantenida requiere validación separada.

## Validación
Builds completos --no-cache con etiquetas build-validation-20261024 distintas de las activas.
Broker:42/42 rechazos en tres almacenes;cliente Erlang acepta HTTPS legítimo y rechaza dos cadenas comprometidas.
PostgreSQL:14/14 rechazos y hash final contrastado con etapa de pruebas.
Config funcional preservada;solo difieren tres etiquetas informativas com.docker.compose.* entre build directo del broker y el anterior con Compose.
Siete contenedores de producción intactos,sin reinicios/recreaciones durante esta integración;los parches ya estaban activos.
No equivale a probar todas las operaciones de negocio de una imagen reconstruida.

## Reproducción sin despliegue
~~~sh
docker build --no-cache --pull=false -f vernemq/Dockerfile -t horizonst-production-vernemq:build-validation .
docker build --no-cache --pull=false -f infrastructure/security/postgres-ca.Dockerfile -t horizonst-production-postgres:build-validation .
~~~
Compose operativo y plantilla mantenida incluyen build PostgreSQL. No se ejecutó compose up ni se retagaron imágenes activas.

## Reversión acotada
Recuperar solo archivos de esta entrega desde el commit padre tras revisar cambios posteriores.
En /opt/horizonst-production/docker-compose.production.yml retirar solo el bloque build añadido a postgres si procede;conservar imágenes,volúmenes y resto del servicio.
Las imágenes corregidas activas siguen siendo válidas. No restaurar confianza vulnerable ni datos.
