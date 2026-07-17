# VerneMQ 1.13 con PostgreSQL en producción

HorizonST autentica y autoriza MQTT exclusivamente mediante `vmq_diversity` y
el script oficial `/vernemq/share/lua/auth/postgres.lua`. Los plugins de
ficheros `vmq_passwd` y `vmq_acl` deben permanecer inactivos.

## Precedencia de configuración

La imagen oficial `vernemq/vernemq:1.13.0` define `start_vernemq` como su
comando predeterminado. Ese script convierte cada variable
`DOCKER_VERNEMQ_*` a una entrada de `/vernemq/etc/vernemq.conf`; los dobles
guiones bajos representan puntos. Por ejemplo,
`DOCKER_VERNEMQ_PLUGINS__VMQ_ACL=off` genera `plugins.vmq_acl=off`.

No se debe sustituir ese comando por `vernemq console`. Hacerlo omite por
completo la traducción de variables. Tampoco se deben montar
`vernemq.conf` o `vm.args` como solo lectura: el arranque oficial necesita
actualizarlos.

La imagen de HorizonST ejecuta `/usr/local/bin/start-horizonst-vernemq`. El
wrapper restaura en cada arranque la configuración base versionada, que no
contiene datos de conexión ni credenciales, y delega después en el
`start_vernemq` oficial. De esta forma la configuración efectiva se genera de
manera reproducible y no conserva valores de un arranque anterior.

## Variables requeridas

El servicio `vernemq` recibe la conexión PostgreSQL a través de estas
variables de Compose:

| Configuración efectiva | Origen en Compose |
| --- | --- |
| `vmq_diversity.postgres.host` | `VMQ_POSTGRES_HOST` (por defecto, `postgres`) |
| `vmq_diversity.postgres.port` | `VMQ_POSTGRES_PORT` (por defecto, `5432`) |
| `vmq_diversity.postgres.database` | `DB_NAME` |
| `vmq_diversity.postgres.user` | `DB_USER` |
| `vmq_diversity.postgres.password` | `DB_PASSWORD` |

`DB_NAME`, `DB_USER` y `DB_PASSWORD` son obligatorias. Deben suministrarse
desde el entorno de despliegue o su gestor de secretos; no se deben añadir al
repositorio. El wrapper rechaza valores vacíos antes de iniciar el broker.

La configuración fija y no secreta conserva:

- `allow_anonymous = off`;
- `plugins.vmq_passwd = off`;
- `plugins.vmq_acl = off`;
- `plugins.vmq_diversity = on`;
- listener TCP interno `0.0.0.0:1883`;
- script PostgreSQL oficial y `password_hash_method = bcrypt`.

El script oficial consulta `vmq_auth_acl` por la clave compuesta
`mountpoint`, `client_id` y `username`, valida el hash bcrypt y carga desde la
misma fila las ACL JSON de publicación y suscripción.

## Construcción y validación

Antes de sustituir el servicio desplegado, construir la imagen de forma
aislada:

```bash
docker compose build vernemq
```

Después del arranque autorizado del despliegue, el healthcheck ejecuta dentro
del contenedor `/usr/local/bin/validate-vernemq-runtime`. También puede
ejecutarse manualmente:

```bash
docker compose exec vernemq /usr/local/bin/validate-vernemq-runtime
docker compose exec vernemq /vernemq/bin/vmq-admin plugin show
```

La validación comprueba que solo `vmq_diversity` participa en autenticación y
ACL, compara la conexión efectiva con el entorno sin mostrar la contraseña y
verifica que la configuración base versionada no contiene una contraseña ni
datos PostgreSQL fijos.

Para inspeccionar la configuración generada sin revelar el secreto:

```bash
docker compose exec vernemq sh -c \
  "sed -E 's#^(vmq_diversity\.postgres\.password[[:space:]]*=).*#\\1 [REDACTED]#' /vernemq/etc/vernemq.conf"
```

La prueba MQTT debe utilizar una identidad ya aprovisionada en
`vmq_auth_acl`, sin copiar su contraseña ni su hash a comandos versionados.
Compruebe una conexión con credenciales válidas y otra con una contraseña
deliberadamente incorrecta. La primera debe recibir CONNACK aceptado y la
segunda `Not authorized`.

## Límite de descriptores

El Compose de producción configura `ulimits.nofile` con límites blando y duro
de `65536` para eliminar el warning de VerneMQ y permitir el número recomendado
de sockets abiertos. Verifíquelo dentro del contenedor con:

```bash
docker compose exec vernemq sh -c 'ulimit -n'
```
