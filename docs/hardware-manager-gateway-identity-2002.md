# Lectura 2002, inventario MKGW3 y persistencia MQTT selectiva

La guía canónica actualizada de 24 páginas define las lecturas `2XXX` como consultas sin objeto `data`. Para identidad, Hardware Manager publica exclusivamente `{"msg_id":2002,"device_info":{"mac":"MAC_GATEWAY"}}` en `gw/{mac}/subscribe`. La respuesta real verificada llega por `gw/{mac}/publish`, no contiene `result_code` y reporta nombre, modelo, fabricante, MAC BLE/Ethernet y versiones hardware, software, firmware, función y SL BLE.

La respuesta real confirmada en el entorno identifica una `MKGW3-9239`, modelo `MKGW3`, fabricante `MOKO TECHNOLOGY LTD.`, MAC BLE `10B41DB99239`, MAC Ethernet `2805A55EFB6B` y versiones `V1.0` (hardware), `V4.4.4` (software), `V2.0.12` (firmware), `V2.4` (función) y `V1.0.6` (SL BLE). Estos valores se documentan como evidencia de esa observación concreta; no se usan como defaults ni se asignan a otras gateways.

El parser dedicado exige topic exacto, `msg_id=2002`, coincidencia de MAC entre topic y `device_info`, las diez propiedades esperadas, MAC válidas, tipos string y longitudes acotadas. No comparte el parser ni los estados de ACK. Una respuesta válida actualiza solo una gateway activa con la misma MAC central. Los datos reportados se guardan en columnas `reported_*`, separados del modelo/firmware manual y su evidencia externa. Las capacidades V2 se habilitan con un informe 2002 válido que declare MKGW3 y firmware V2, o con el registro manual auditado existente.

`hardware_gateway_reads` registra solicitud, publicación, timeout/error y respuesta observada. `response_observed` significa que el servicio observó una respuesta válida durante la lectura; el protocolo no incluye un identificador de solicitud y, por tanto, no prueba correlación inequívoca. Una respuesta válida fuera de orden puede refrescar el inventario, pero no resuelve una solicitud que aún no estaba publicada. El bloqueo asesor por gateway impide operaciones locales simultáneas con comandos o lecturas.

## Topics y almacenamiento

El Backend se suscribe únicamente a:

- `devices/MK4`
- `gw/+/publish`

Se retiran `devices/MK1`, `devices/MK2`, `devices/MK3` y `devices/MK3/+/send`. MK3 utiliza los topics canónicos `gw/{mac}/publish` y `gw/{mac}/subscribe`. En `MQTT_PERSISTENCE_MODE=app`, `devices/MK4` conserva su decodificación y persistencia cruda. Ningún mensaje `gw/.../publish`, incluido el frecuente `3070`, se inserta de forma cruda en `mqtt_messages`. Los ACK continúan en `hardware_gateway_commands`; las lecturas `2002`, en `hardware_gateway_reads` y `gateways.reported_*`; la auditoría, en `technical_audit_log`.

## Alcance de validación

Las pruebas usan MQTT y gateways simulados. Las pruebas MQTT directas realizadas previamente validan el payload y el hardware del fabricante, no demuestran por sí mismas el flujo desplegado de Hardware Manager. No se contactó hardware real, no se aplicaron migraciones y no se cambió ningún payload B5, RSSI, alarma o control BLE.
