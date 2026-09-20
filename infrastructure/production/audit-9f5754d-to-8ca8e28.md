# Auditoría operativa 9f5754d → 8ca8e28

Se revisó el grafo completo de 47 commits y el diff real. Excluyendo los 2.946 ficheros `node_modules` retirados, son 279 ficheros, 16.627 inserciones y 21.756 eliminaciones. `6252966` (B5 manual) ya es antecesor de `8ca8e28`; no debe fusionarse de nuevo.

## Impacto por superficie

| Superficie | Cambio e impacto de producción | Control previo |
| --- | --- | --- |
| Backend/HM | Inventario multiempresa, service principals, comandos/ACK, firmware/capacidades y lecturas 2002/2011/2040/2041/2057/2201 | aplicar 001–011, reconciliar inventario, ACL y token antes de activar Horneo |
| MQTT | topics oficiales exactos; QoS 128 o concesión parcial dejan MQTT no saludable; crudo solo MK4 | `MQTT_REQUIRED=true`, ACL mínima y sesión distinta de Horneo |
| B5 | payloads 1045/1053/1059/1063, ACK ambiguo y resultado durable `attempted_unverified`; 2201 no autoriza acciones | simulaciones y prueba operativa de lectura; ninguna alarma física sin autorización |
| Horneo | identidad central, caché por MAC, topics exactos por empresa, retirada del ejecutor MQTT genérico | migraciones 012–021 con reconciliación entre 016 y 017; activar HM al final |
| Presencia | retención por lotes, `sync_queue` deshabilitada, IDs centrales obligatorios en overlays | conteos antes/después y prueba de sesiones/timeout |
| Informes | elimina `LIMIT 2000`, lectura completa/chunked | prueba de conteo >2.000 ya incluida; vigilar memoria/PDF en producción |
| Seguridad | rate limit PostgreSQL/fail-closed, revocación, trusted proxy exacto, recuperación de contraseña | IP del bridge exacta y prueba anti-spoofing tras recrear cada servicio |
| Store | lockfile saneado, dependencias actualizadas, auth rate limit en 016 aislada | ejecutar solo `migrate:security`; no ejecutar runner 011–015 |
| RFID/Elecnor | elimina servicio/código/config/documentación heredados | no aparece entre los cuatro servicios activos actuales; no borrar tablas, datos o volúmenes |
| Node modules | deja de versionar 2.946 ficheros y los ignora | `npm ci` dentro de cada build; no reutilizar árboles locales |
| Nginx/web | cabeceras proxy completas y plantillas corregidas | no tocar vhosts activos; HM solo loopback/túnel inicialmente |
| Mantenimiento | retención de `mqtt_messages`, heartbeats y `sync_queue` por lotes | revisar métricas y conteos; ninguna purga manual durante el corte |

## Semántica que no debe degradarse

- `2002` y las demás lecturas son respuestas observadas, no ACK inequívocos.
- `2201` es una fotografía no correlacionada y no habilita acciones B5.
- Un ACK positivo tras timeout puede ser `ambiguous`; Horneo conserva el intento automático como `attempted_unverified`, no como éxito físico.
- Un rechazo explícito sigue siendo error y no autoriza acciones.
- La alarma manual conserva `dispatchPhysicalAlarm:false`; la automática conserva el único intento operativo ya decidido.
- Las opciones MKGW3 V2 dependen de modelo/firmware con evidencia; versión desconocida permanece bloqueada.
- Backend escucha `devices/MK4` y `gw/+/publish`. Horneo usa solo `gw/{mac}/publish` de gateways activas de su empresa. Los client IDs nunca coinciden.

## Riesgos y decisiones humanas

1. No se dispone en Git del Compose activo externo. Debe aprobarse un diff en el servidor antes de sustituirlo.
2. El inventario de producción no se ha exportado. Si cualquier MAC local no casa unívocamente con el inventario central, el despliegue de Horneo queda bloqueado; no se asignan IDs por suposición.
3. Backend 005 aborta ante duplicados `(mountpoint, client_id)`. La existencia del índice en instalaciones nuevas no demuestra el estado del volumen actual.
4. Store tiene historial parcialmente divergente: 011–015 no deben marcarse falsamente ni ejecutarse dentro de este cambio.
5. No existe dominio aprobado para HM. El primer corte termina con acceso local `127.0.0.1:3000`.
6. El rollback de D.2 no consiste en `HARDWARE_MANAGER_ENABLED=false`: requiere restaurar el artefacto D.1, su ejecutor y ACL MQTT anteriores.
