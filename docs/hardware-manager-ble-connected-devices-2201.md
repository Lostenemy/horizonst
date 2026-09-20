# Hardware Manager — fotografía BLE conectada 2201

## Contrato verificado

La fuente del contrato es `guia-referencia-mqtt-mkgw3 (1).pdf`, sección «Consultar Lista de Dispositivos BLE Conectados» (página 17). La petición se publica en `gw/{gatewayMac}/subscribe` sin objeto `data`:

```json
{"msg_id":2201,"device_info":{"mac":"2805a55efb68"}}
```

La respuesta se recibe exclusivamente en `gw/{gatewayMac}/publish` y contiene exactamente `data.ble_conn_list`. Cada elemento contiene únicamente `mac` y `type`. `type` se conserva como el entero bruto comunicado por el firmware: no es un enum del backend y no se le atribuye modelo, familia ni capacidad.

Una respuesta con `result_code` es un ACK y no una fotografía 2201. El parser también rechaza tópico o MAC contradictorios, claves adicionales o ausentes, tipos no enteros, MAC no válidas y MAC duplicadas.

## Semántica observada

La lectura utiliza el diario `hardware_gateway_reads` con `read_type=ble_connected_devices`. `response_observed` significa únicamente que una respuesta válida se recibió y persistió dentro del presupuesto temporal. El protocolo no incluye identificador de petición, por lo que no existe correlación inequívoca.

Una respuesta tardía válida puede actualizar la última fotografía, pero nunca revive una lectura expirada. Una respuesta atribuible al intento y estructuralmente inválida termina como `invalid_response`. La lectura conserva el mismo bloqueo asesor, límite absoluto y liberación de conexión que las demás lecturas observadas.

El 20 de septiembre de 2026 se observó en hardware real una lista vacía válida con MKGW3 firmware V2.0.12 / función V2.4. Por ello `ble_conn_list: []` se persiste como una cabecera con `device_count=0` y cero elementos, no como ausencia de datos.

## Persistencia y aislamiento

La migración `011_gateway_ble_connected_devices.sql` crea:

- `hardware_gateway_ble_snapshots`: una cabecera de última fotografía por gateway, con empresa, fecha y número de elementos;
- `hardware_gateway_ble_snapshot_items`: elementos ordenados por `position`, MAC normalizada y código `firmware_type` entero.

Ambas tablas usan referencias compuestas gateway/empresa. La sustitución de cabecera y elementos es transaccional. La unicidad `(gateway_id, device_mac)` hace que una respuesta con MAC duplicada sea inválida en vez de perder información silenciosamente.

## API y operación

- `POST /api/gateways/:gatewayId/read-ble-connected-devices`: solo técnico de hardware y dentro de su empresa.
- `GET /api/gateways/:gatewayId/ble-connected-devices`: lectura dentro del ámbito de empresa; devuelve `null` si aún no existe fotografía.

El panel muestra la fecha, el orden, la MAC y el código `type`, o indica explícitamente que la fotografía es vacía. Todo el renderizado usa nodos DOM y `textContent`.

Esta fotografía no confirma una conexión B5, no completa el `1150`, no concede leases, no dispara acciones, no provoca reintentos y no modifica alarmas. Los tópicos oficiales siguen siendo exactamente `devices/MK4` y `gw/+/publish`; solo MK4 conserva persistencia MQTT cruda.
