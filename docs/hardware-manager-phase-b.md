# Hardware Manager — Fase B: gateways de Horneo

## Estado y límites

La implementación parte de `6cfeead855b5ca097f1d79ad8e656d6daccf14ff`. Es aditiva y no ejecuta migraciones, reconciliación, despliegues ni comandos físicos. El inventario local de Horneo, sus FKs, la ingestión `gw/+/publish`, la presencia, RSSI operativo, B5 y tags permanecen disponibles para rollback y dual-read.

No se introducen `site` o `installation` centrales en esta fase. La ubicación operacional ya está representada en Horneo mediante `gateways.cold_room_id`, `gateways.plant_id`, `cold_rooms` y `plants`. Crear otro modelo ahora duplicaría esa relación. El puente necesario es exclusivamente `cold_compliance.gateways.hardware_gateway_id`.

## Migraciones

### Base central `horizonst`

`backend/migrations/002_hardware_manager_phase_b.sql`:

- crea o reactiva idempotentemente `companies(code='horneo', name='Horneo')` sin UUID fijo;
- añade `gateways.rssi_threshold` con rango `-127..0`;
- crea `service_principals` y `service_principal_tokens`;
- amplía `technical_audit_log` para principal humano, servicio o sistema;
- crea `hardware_gateway_commands`, sus índices de consulta, idempotencia y exclusión de comandos activos concurrentes por gateway.

El UUID de Horneo se obtiene después de aplicar la migración con:

```sql
SELECT id, code, name, active
FROM companies
WHERE code = 'horneo';
```

### Base `cold_compliance`

`cold-compliance-service/migrations/013_hardware_gateway_reference.sql` añade únicamente:

```text
gateways.hardware_gateway_id INTEGER NULL
```

Tiene índice único parcial cuando la referencia no es nula. No existe FK SQL: `cold_compliance` y `horizonst` son bases PostgreSQL distintas. La integridad se comprueba mediante reconciliación y dual-read.

## Reconciliación e importación

El ejecutable compilado es `backend/dist/scripts/reconcileHorneoGateways.js`. Usa las conexiones `DB_*` para `horizonst` y `HORNEO_DB_*` para `cold_compliance`. No imprime contraseñas.

El modo predeterminado es solo informe:

```text
npm run build
npm run reconcile:horneo-gateways
```

Informa:

- gateway local y central;
- MAC inválida o duplicada después de normalizar;
- coincidencia por MAC canónica;
- gateway central sin empresa;
- pertenencia a otra empresa;
- referencia central ausente o contradictoria;
- diferencias de RSSI, formato MAC y nombre/descripción;
- gateways Horneo centrales sin correspondencia local;
- acciones previstas y asociaciones `cold_room_id`/`plant_id` que se preservan.

La normalización es minúscula, sin separadores y con doce dígitos hexadecimales. La misma función se usa para el informe y la aplicación.

Solo después de revisar un informe sin conflictos puede ejecutarse explícitamente:

```text
npm run reconcile:horneo-gateways -- --apply
```

`--apply` crea gateways ausentes, vincula registros centrales inequívocos sin empresa, conserva/reutiliza gateways de Horneo, copia el RSSI local efectivo, normaliza la MAC y rellena `hardware_gateway_id`. Si existe una MAC inválida/duplicada, otra empresa, un enlace ambiguo o un huérfano, se detiene antes de escribir.

No existe transacción distribuida entre bases. Primero se confirma la parte central y después el backfill local. El proceso es idempotente: si falla la segunda confirmación, una repetición reutiliza los gateways centrales creados y completa los enlaces locales.

### Consultas de verificación

Antes y después, en `cold_compliance`:

```sql
SELECT COUNT(*) AS local_total,
       COUNT(hardware_gateway_id) AS linked,
       COUNT(DISTINCT hardware_gateway_id) AS distinct_links
FROM gateways;

SELECT lower(regexp_replace(gateway_mac, '[^0-9a-fA-F]', '', 'g')) AS mac,
       COUNT(*)
FROM gateways
GROUP BY 1
HAVING COUNT(*) > 1;

SELECT id, gateway_mac, cold_room_id, plant_id, rssi_threshold
FROM gateways
WHERE hardware_gateway_id IS NULL;
```

En `horizonst`:

```sql
SELECT COUNT(*) AS horneo_gateways,
       COUNT(*) FILTER (WHERE g.company_id IS NULL) AS without_company
FROM gateways g
JOIN companies c ON c.id = g.company_id
WHERE c.code = 'horneo';

SELECT lower(regexp_replace(g.mac_address, '[^0-9a-fA-F]', '', 'g')) AS mac,
       COUNT(*)
FROM gateways g
GROUP BY 1
HAVING COUNT(*) > 1;
```

Los conteos reales no se incluyen en el código: deben obtenerse primero mediante el modo informe en staging y revisarse antes de `--apply`.

## Identidad de servicio Horneo

La identidad es independiente de usuarios y JWT:

```text
type = service
code = horneo
company_id = UUID persistido de Horneo
scopes = [hardware.read]
```

Un superadministrador crea el principal mediante `POST /api/service-principals`. La respuesta contiene un token opaco `hst_svc_...` una sola vez. La base almacena únicamente SHA-256, un hint no secreto y metadatos. `POST /api/service-principals/:id/rotate` revoca los tokens activos y entrega uno nuevo; `POST /api/service-principals/:id/revoke` desactiva principal y tokens. La expiración es opcional.

El token real se guarda en el gestor de secretos como `HARDWARE_MANAGER_SERVICE_TOKEN`; nunca en Git. La autenticación deriva `company_id` y scopes del registro persistido, aplica rate limit por principal, actualiza `last_used_at` y conserva `X-Request-Id` en la auditoría.

## API interna company-scoped

El contrato versionado es:

```text
GET /api/internal/v1/hardware/gateways
GET /api/internal/v1/hardware/gateways/:id
GET /api/internal/v1/hardware/gateways/by-mac/:mac
```

Todas las consultas contienen `g.company_id = principal.company_id`. Una búsqueda de otra empresa devuelve el mismo `404` que un recurso inexistente. No se acepta `company_id` del consumidor.

Horneo incorpora `GET /gateways/:id/hardware-resolution` como observación dual-read. Resuelve primero por `hardware_gateway_id`, después por MAC canónica, compara MAC/RSSI y registra divergencias. Si Hardware Manager está deshabilitado o temporalmente no disponible, informa `local_disabled` o `local_fallback` y no altera presencia ni configuración local.

## Nuevas altas

La columna central `company_id` continúa nullable para no romper inventario legacy. Sin embargo, `POST /api/gateways` exige una empresa activa en todas las nuevas altas. La restricción SQL `NOT NULL` queda pospuesta hasta demostrar que no existen gateways legacy sin empresa.

## Command journal, B5 y RSSI

Hardware Manager expone para usuarios técnicos autorizados:

```text
POST /api/gateways/:id/configure-emergency-button
POST /api/gateways/:id/apply-rssi
GET  /api/gateways/:id/commands
```

Cada comando se persiste antes de publicar. Un advisory lock y un índice único parcial serializan la ejecución por gateway. Los estados distinguen `pending`, `published`, `ack_success`, `ack_error`, `timed_out` y `publish_error`. Publicar nunca equivale a éxito.

Al arrancar y de forma periódica, el journal convierte en `timed_out` los comandos activos cuyo plazo ya venció. La misma recuperación se ejecuta antes de una secuencia nueva, evitando que un reinicio deje bloqueado el gateway.

Se conserva exactamente:

- publish `gw/{gatewayMac}/subscribe`;
- ACK/telemetría `gw/{gatewayMac}/publish`;
- B5 `1045`, `1053`, `1059`, `1063` y sus payloads validados;
- RSSI `1042`;
- éxito solo con `result_code = 0`;
- correlación por gateway y `msg_id` original o respuesta MOKO esperada;
- los cuatro ACK correctos para declarar B5 configurado.

Horneo conserva temporalmente sus endpoints y listener ACK. El corte exclusivo se pospone: durante Fase B, los nuevos flujos administrativos deben usar Hardware Manager, pero no se elimina la ruta local hasta validar staging y completar fases posteriores.

No se modifica el parser de emergencia (`3070`, `bxp-button`, `frame_type=1`, `alarm_status=1`), dedupe `tagUid + triggerCount`, ventana de 60 segundos ni `dispatchPhysicalAlarm=false`.

## Rollback operacional

1. Desactivar `HARDWARE_MANAGER_ENABLED` en Horneo.
2. Volver a la imagen anterior de ambos servicios.
3. Mantener tablas y columnas nuevas; son aditivas y `hardware_gateway_id` es nullable.
4. No revertir con `DROP`, no borrar mappings y no editar migraciones aplicadas.
5. Comprobar inventario local, presencia, sesiones, RSSI, alarmas y MQTT.
6. Resolver el informe de reconciliación antes de reintentar.

## Pendiente para fases posteriores

- migración de tags/dispositivos y `hardware_device_id` (Fase C);
- ingestión MQTT global company-scoped y retirada del wildcard en Horneo (Fase D);
- retirada del inventario/CRUD técnico local y de su ejecutor ACK (Fase E);
- validación física controlada con MKGW3/B5 real y observación prolongada (Fase F).
