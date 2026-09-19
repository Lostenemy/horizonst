# Lecturas observadas de configuración MKGW3

Hardware Manager admite exclusivamente cuatro lecturas de configuración adicionales a la identidad `2002`:

| `msg_id` | Tipo | Esquema exacto de `data` |
| --- | --- | --- |
| `2011` | `led_state` | `net_led`, `sys_led`, `server_led`: enteros 0/1 |
| `2040` | `ble_scan_switch` | `scan_switch`: entero 0/1 |
| `2041` | `filter_relation` | `relation`: entero 0–8 |
| `2057` | `duplicate_rule` | `rule`: entero 0–3 |

Estos cuatro esquemas proceden de observaciones reales sobre una MKGW3 con `firmware_version=V2.0.12` y `function_version=V2.4`. La guía de referencia de 24 páginas identifica `2011`, `2040` y `2041` y muestra sus escrituras y ACK, pero no define formalmente sus respuestas de lectura; tampoco formaliza la respuesta `2057`. Por ello, los esquemas no se generalizan a otros firmwares sin una validación equivalente.

Cada solicitud contiene solo `msg_id` y `device_info.mac`, y se publica en `gw/{mac}/subscribe`. El receptor exige `gw/{mac}/publish`, igualdad entre la MAC del topic y la del payload, gateway central activa, empresa coincidente y objeto `data` exacto. Una respuesta con `result_code` pertenece al flujo de ACK y no se acepta como lectura observada.

`response_observed` significa que una respuesta válida fue observada y persistida dentro del plazo. No equivale a correlación inequívoca: el protocolo no devuelve un identificador único de solicitud. Una respuesta tardía válida puede actualizar el último valor en `hardware_gateway_observed_settings`, pero nunca revive una fila expirada de `hardware_gateway_reads`. Un payload atribuible al topic y a la lectura solicitada que incumpla el esquema se registra como `invalid_response`.

La lectura no modifica el inventario manual de firmware, no habilita opciones de escritura y no sustituye las reglas de capacidades existentes. Las demás lecturas 2XXX —incluidas red, NTP, WiFi, MQTT, listas BLE y filtros no enumerados— permanecen pendientes hasta disponer de respuestas verificadas y un contrato por firmware. No se implementa ninguna lectura agrupada ni ningún 3XXX nuevo.
