# Hardware Manager: configuración MQTT MKGW3 (1030)

## Contrato verificado

La guía MQTT MKGW3 documenta la orden `1030`, publicada en `gw/{mac}/subscribe`, y su ACK `1030` en
`gw/{mac}/publish`. El Backend controla `msg_id`, `device_info.mac` y el topic real; el navegador solo aporta el
objeto `data`. La guía indica que el cambio necesita el reinicio `1000` para aplicarse. La página 2 define el
reinicio físico exactamente como `msg_id=1000` y `data={"reset":0}`; coincide con el contrato observado, sin
discrepancia. Su ACK usa `msg_id=1000`, la misma MAC y los códigos globales de resultado.

El Backend mantiene un único bloqueo asesor durante los dos pasos. Solo después de un ACK `1030` inequívoco con
`result_code=0` publica una vez el `1000`. Un rechazo, timeout o ACK ambiguo de `1030` impide el reinicio. Ninguno
de los dos comandos se reintenta automáticamente.

Los códigos globales documentados son: `0 success`, `1 length error`, `2 type error`, `3 range error` y
`4 no object error`. Para `1030` se exige MAC coincidente entre topic y payload, uno de esos códigos y el mensaje
documentado correspondiente. Un ACK positivo de `1030` acredita únicamente que la gateway aceptó la configuración.
El ACK `1000` acredita únicamente que aceptó el reinicio. Ninguno acredita que haya conectado al broker de destino.

## Preset HorizonST y edición controlada

El formulario parte del contrato observado: `security_type=1`, `mqtt.horizonst.com.es:8883`, MAC central
normalizada como `client_id` y `username`, topics `gw/{mac}/subscribe` y `gw/{mac}/publish`, QoS 0, sesión limpia,
keepalive 60 y LWT 3999. Todos los campos de `data` son editables. La contraseña empieza siempre vacía y se exige
escribir la MAC central exacta antes de enviar.

La guía muestra `security_type=0` y QoS 1, mientras que el contrato HorizonST observado usa `security_type=1` y
QoS 0. Por prudencia se admiten solamente esos valores evidenciados (`0` y `1`); no se atribuye a
`security_type=0` un significado no publicado por el fabricante. La documentación disponible no especifica
longitudes máximas propias del firmware. Se aplican estos límites defensivos:

- host: 253 bytes, DNS/IPv4/IPv6 sin esquema, ruta, espacios ni controles;
- `client_id`, `username` y `passwd`: 256 bytes;
- topics: 1024 bytes; los topics de publicación y LWT no admiten comodines;
- payload LWT: 4096 bytes y contrato JSON 3999 exacto;
- puerto: 1–65535 y keepalive: 0–65535, coherentes con campos MQTT de 16 bits.

Estos límites son controles de HorizonST, no capacidades afirmadas del firmware. Deben revisarse si el fabricante
publica límites más estrictos.

## Secreto, diario y auditoría

`wirePayload` contiene `passwd` solo en memoria durante una publicación. `persistedPayload` sustituye el valor por
`[REDACTED]` antes de escribir `hardware_gateway_commands`. La auditoría registra actor, `request_id`, estado y
destino `host:port`, nunca la contraseña. Las respuestas HTTP y el historial exponen únicamente metadatos no
secretos. El campo de contraseña es `type=password`, no usa almacenamiento web y se vacía al iniciar la petición,
también en errores de validación.

El bloqueo asesor existente serializa la operación completa por gateway. Las claves de idempotencia independientes
`request_id:1030` y `request_id:1000` permanecen limitadas por empresa. Después de un timeout histórico del mismo
`msg_id`, un ACK positivo se conserva como `ack_ambiguous`, nunca como confirmación inequívoca. Los ACK tardíos no
reviven estados terminales. El diario y la UI muestran por separado configuración y reinicio.

## Alta previa de gateways: decisión pendiente

El repositorio acredita que VerneMQ usa `mountpoint=''`, contraseña bcrypt producida por PostgreSQL
`crypt(..., gen_salt('bf'))`, unicidad `(mountpoint, client_id)` y ACL JSON por patrón. Las ACL requeridas no deben
incluir la propiedad `qos`. Sin embargo, no existe un contrato versionado que establezca qué secreto inicial debe
derivarse o asignarse a una gateway nueva. El ejemplo observado muestra una MAC como contraseña, pero el código de
aprovisionamiento actual no acredita que esa sea la política de credenciales de gateways.

Como el alta solicitada solo puede pedir la MAC y no puede inventar ni mostrar una credencial, este cambio no añade
la acción **Dar de alta gateway** ni un flujo que escriba conjuntamente en `gateways` y `vmq_auth_acl`. Hace falta
decidir y documentar una de estas políticas antes de continuar: secreto aleatorio entregado por canal seguro y
configurable localmente, secreto de fábrica acreditado, o derivación explícita autorizada. También falta una fuente
central verificable de estado online por gateway; registrar inventario y ACL no demuestra conectividad ni permite
habilitar `1030` de forma segura para una unidad recién incorporada. El formulario de registro de inventario existente
no aprovisiona credenciales/ACL y no debe confundirse con la futura alta atómica.

## Prueba posterior y recuperación

La validación en staging requiere autorización operativa y una gateway recuperable localmente:

1. Guardar por un canal seguro la configuración vigente, sin copiar contraseñas a tickets o logs.
2. Confirmar acceso físico/local a la gateway antes de enviar `1030`.
3. Enviar una única orden y comprobar el ACK y el historial redactado.
4. Confirmar en el historial el ACK independiente de `1000` o clasificar su ausencia como resultado incierto.
5. Verificar por separado que la gateway abre sesión en el broker nuevo y publica en el topic central esperado.
6. Si no reconecta, restaurar localmente la configuración anterior desde la interfaz/herramienta del fabricante.

No existe rollback remoto garantizado: una gateway desconectada del broker anterior ya no puede recibir una orden
correctiva desde HorizonST. Un timeout es resultado incierto porque la configuración puede haberse aplicado antes
de perder la conexión.
