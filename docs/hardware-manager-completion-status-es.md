# Hardware Manager: inventario y límites del protocolo

Estado de esta rama: implementación parcial; **no apta aún para desplegar como Hardware Manager completo**.

## Fuente de verdad y Horneo

Administración (`horizonst`) conserva `gateways` y `devices`, sus nombres, MAC, empresa, estado y ubicación. Horneo conserva overlays operativos unidos por `hardware_gateway_id` y `hardware_device_id`. Los listados de Horneo leen la identidad central mediante la API interna y solo recurren a la copia local si el servicio central no está disponible, según la compatibilidad existente. El nombre de gateway ya llegaba como `hardware_name`, pero la tabla de Horneo enseñaba `description`. El nombre de tag se asignaba a `model`, mezclando nombre editable y modelo. La vista usa ahora `hardware_name` para ambos y conserva el modelo local como dato distinto.

## Clasificación de funciones encontradas en Horneo

| Clase | Función | Decisión |
| --- | --- | --- |
| A: Administración | Alta, baja, nombre, MAC, empresa, estado y ubicación de gateway/tag | Ya tienen autoridad central; retirar formularios manuales de Horneo. |
| A: Administración | RSSI BLE y configuración de doble pulsación B5 | Mostrar controles centrales con confirmación, ACK, historial y auditoría. |
| A: Administración | Escaneo, relación de filtros, duplicados, PHY, intervalo y modo BLE | Controles tipados centrales cuando el manual especifica el payload completo. |
| B: interno | Endpoints antiguos de Horneo `apply-rssi` y `configure-emergency-button` | Mantener temporalmente para compatibilidad; reenvían al Hardware Manager y no publican MQTT. |
| B: interno | Ejecutor B5 de Horneo para alarmas automáticas | Mantener: delega los comandos físicos al Hardware Manager. |
| C: Horneo | Presencia, RSSI operacional, sesiones, cumplimiento, emergencias, alarmas y tiempos de pitido/vibración de reglas | Son lógica de negocio de frío. |
| D: posterior | Código JavaScript de creación/baja y edición técnica de inventario Horneo | Ya no se muestra; retirar junto con los endpoints de compatibilidad solo tras verificar consumidores. |

## MQTT y comandos

Se reutilizan `hardware_gateway_commands`, el publicador central, el listener ACK y `technical_audit_log`. Backend escucha solo `devices/MK4` y `gw/+/publish`; Horneo mantiene topics exactos dinámicos y receive-only. Las lecturas dedicadas `2002`, `2011`, `2040`, `2041` y `2057` usan un diario propio sin confundirse con ACK ni usar `mqtt_messages`. `2002` persiste la identidad reportada; las otras cuatro conservan el último valor observado en una tabla tipada y aislada por empresa. Los comandos BLE incorporados en esta rama son 1040, 1041, 1057, 1060, 1063 y 1066. RSSI 1042 y la secuencia B5 1045/1053/1059/1063 ya estaban implementados. No se ha enviado ningún comando a hardware real.

La migración `007_gateway_model_firmware_connection.sql` añade inventario de modelo, versión y evidencia auditada. Las opciones `1063`, `1066`, `1041.relation=8`, `1060.phy_filter=4` y la secuencia B5 que incluye 1063 quedan bloqueadas si la versión MKGW3 V2 no está registrada. Hay una discrepancia de firmware: la secuencia B5 probada en MKGW3 V2.4 usa `parse_adv_data: 1` en 1059, mientras que la guía de septiembre de 2026 dice que `parse_adv_data` fue eliminado en V2.X y menciona 1065 para parseo dedicado. No se cambia ese payload hasta verificar el comportamiento real. Detalles y límites en `docs/hardware-manager-firmware-b5-async.md`.

La guía canónica actualizada de 24 páginas documenta `2002`, `2201`, filtros, notificaciones y varios comandos de tags. Además de `2002`, esta fase acepta exclusivamente `2011`, `2040`, `2041` y `2057` con los esquemas observados en una MKGW3 V2.0.12/function V2.4. La guía muestra sus escrituras y ACK, pero no formaliza esas respuestas de lectura, por lo que no se generalizan a otros firmwares ni habilitan capacidades. En B5, `1150` aceptado permite el intento físico operativo, pero se registra como `attempted_unverified`: no se afirma conexión BLE ni entrega física confirmada. `3151` no se atribuye al intento y el uso de `2201` queda reservado para una fase validada por separado.

### Límite de correlación de ACK

La guía documenta `msg_id`, MAC de gateway y `result_code`, pero no un identificador único de petición que el firmware replique en el ACK. La exclusión por gateway evita comandos simultáneos, pero no distingue una respuesta tardía de un intento anterior con el mismo `msg_id`. El listener exige que la MAC del topic y `device_info.mac` coincidan si ambas existen. Ante un `timed_out` previo de esa gateway y `msg_id`, el nuevo comando todavía puede publicarse, pero un ACK con `result_code=0` queda como `ack_ambiguous`, distinto del rechazo real `ack_error`. La misma regla se aplica tanto en el servicio que espera el ACK como en la actualización directa del diario; no hay ventana arbitraria que presuma que ya no llegarán respuestas tardías. La ambigüedad queda persistente y requiere investigación operativa, no se limpia automáticamente. Esto puede impedir volver a declarar «confirmada» una acción repetida tras un timeout, aunque la gateway la haya ejecutado.

Esto **no proporciona correlación inequívoca general**: un ACK duplicado de un comando anterior que sí fue confirmado todavía puede confundirse con otro del mismo `msg_id`. Sin nonce/sequence del protocolo o un límite verificable de entrega tardía, no existe forma de eliminar ese caso solo con la lógica cloud. No presentar un `result_code=0` como prueba absoluta de ejecución de una solicitud concreta. Las alarmas automáticas de Horneo mantienen los mismos payloads y el intento físico; si la confirmación es ambigua, la registran como `attempted_unverified` en `alerts.metadata.physicalDispatch`.

## Trabajo aún necesario para completar el objetivo

- Protocolo detallado del fabricante o capturas verificadas de payloads y respuestas por modelo/firmware.
- Resto de consultas 2XXX y notificaciones 3XXX con contrato verificable; permanecen bloqueadas y no se infieren desde las escrituras.
- Estado BLE asíncrono, timeout y correlación de eventos antes de habilitar controles de tags.
- Capacidades por modelo y formularios tipados para red, MQTT, filtros avanzados, tags, firmware y OTA.
- Pruebas de permisos, aislamiento multiempresa, concurrencia y respuestas fuera de orden de los flujos nuevos; pruebas sin hardware real.
