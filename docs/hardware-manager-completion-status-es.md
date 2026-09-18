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

Se reutilizan `hardware_gateway_commands`, el publicador central, el listener ACK y `technical_audit_log`. Se mantienen exclusivamente `gw/{gatewayMac}/publish` y `gw/{gatewayMac}/subscribe`; Horneo sigue receive-only. Los comandos BLE incorporados en esta rama son 1040, 1041, 1057, 1060, 1063 y 1066. RSSI 1042 y la secuencia B5 1045/1053/1059/1063 ya estaban implementados. La vista muestra también los tags cuyo último gateway observado es el seleccionado; eso **no** implica conexión BLE activa. No se ha enviado ningún comando a hardware real.

Hay una discrepancia de firmware: la secuencia B5 probada en MKGW3 V2.4 usa `parse_adv_data: 1` en 1059, mientras que la guía de septiembre de 2026 dice que `parse_adv_data` fue eliminado en V2.X y menciona 1065 para parseo dedicado. No se cambia la secuencia B5 hasta verificar el firmware real.

La guía de siete páginas enumera muchas operaciones de red, MQTT, tags y OTA sin especificar todos los campos JSON, límites o respuestas. Se revisaron también `Gateway MKGW3.pdf`, `Etiqueta personal B5.pdf` y sus fichas técnicas en la carpeta de documentación facilitada; describen hardware e instalación, pero no incluyen payloads `msg_id`. En especial faltan estructuras completas para BXP-C, BXP-D, BXP-T y BXP-S; 1109/1111/1120/1122; 1156/1160/1162/1164/1171/1174/1176; 1205 y varias lecturas 2XXX/3XXX. No habilitar escrituras ni automatizaciones de estos comandos por inferencia. Las conexiones BLE 1150 → 3151 y equivalentes requieren estado asíncrono antes de exponer acciones manuales de tags; el ACK de aceptación no equivale a conexión.

### Límite de correlación de ACK

La guía documenta `msg_id`, MAC de gateway y `result_code`, pero no un identificador único de petición que el firmware replique en el ACK. La exclusión por gateway evita comandos simultáneos, pero no distingue una respuesta tardía de un intento anterior con el mismo `msg_id`. El listener exige que la MAC del topic y `device_info.mac` coincidan si ambas existen. Ante un `timed_out` previo de esa gateway y `msg_id`, el nuevo comando todavía puede publicarse, pero un ACK con `result_code=0` queda como `ack_ambiguous`, distinto del rechazo real `ack_error`. La misma regla se aplica tanto en el servicio que espera el ACK como en la actualización directa del diario; no hay ventana arbitraria que presuma que ya no llegarán respuestas tardías. La ambigüedad queda persistente y requiere investigación operativa, no se limpia automáticamente. Esto puede impedir volver a declarar «confirmada» una acción repetida tras un timeout, aunque la gateway la haya ejecutado.

Esto **no proporciona correlación inequívoca general**: un ACK duplicado de un comando anterior que sí fue confirmado todavía puede confundirse con otro del mismo `msg_id`. Sin nonce/sequence del protocolo o un límite verificable de entrega tardía, no existe forma de eliminar ese caso solo con la lógica cloud. No presentar un `result_code=0` como prueba absoluta de ejecución de una solicitud concreta. Las alarmas automáticas de Horneo mantienen los mismos payloads y el intento físico; si la confirmación es ambigua, la registran como `attempted_unverified` en `alerts.metadata.physicalDispatch`.

## Trabajo aún necesario para completar el objetivo

- Protocolo detallado del fabricante o capturas verificadas de payloads y respuestas por modelo/firmware.
- Consultas 2XXX y notificaciones 3XXX persistidas y presentadas sin exponer secretos.
- Estado BLE asíncrono, timeout y correlación de eventos antes de habilitar controles de tags.
- Capacidades por modelo y formularios tipados para red, MQTT, filtros avanzados, tags, firmware y OTA.
- Pruebas de permisos, aislamiento multiempresa, concurrencia y respuestas fuera de orden de los flujos nuevos; pruebas sin hardware real.
