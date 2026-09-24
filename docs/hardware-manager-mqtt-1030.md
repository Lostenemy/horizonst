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
`request_id:1030` y `request_id:1000` quedan limitadas por empresa tras asignar y por gateway antes de asignar. Después de un timeout histórico del mismo
`msg_id`, un ACK positivo se conserva como `ack_ambiguous`, nunca como confirmación inequívoca. Los ACK tardíos no
reviven estados terminales. El diario y la UI muestran por separado configuración y reinicio.

## Alta previa de gateways

El repositorio acredita que VerneMQ usa `mountpoint=''`, contraseña bcrypt producida por PostgreSQL
`crypt(..., gen_salt('bf'))`, unicidad `(mountpoint, client_id)` y ACL JSON por patrón. Las ACL requeridas no deben
incluir la propiedad `qos`. La decisión de producto para esta entrega establece `client_id`, `username` y contraseña
inicial iguales a la MAC central normalizada. La contraseña se almacena únicamente como bcrypt mediante
`crypt(mac, gen_salt('bf', 10))`, que coincide con `PASSWORD_HASH_METHOD=bcrypt` de VerneMQ; nunca se persiste ni se
registra en claro.

Esta convención hace que la contraseña inicial sea **predecible y no robusta**. El alta no debe presentarse como una
protección criptográfica fuerte ni aplicarse retroactivamente a cuentas existentes. La acción **Dar de alta gateway**
solo acepta la MAC de un `ADMIN` o `hardware_superadmin`; crea una gateway sin compañía en una transacción junto con el
inventario, la identidad bcrypt, las ACL exactas y la auditoría redactada. Un bloqueo asesor transaccional por MAC,
las constraints y las comprobaciones previas impiden altas concurrentes, reasignaciones y sobrescritura de cuentas.

El resultado distingue «preparada en el broker», «sin compañía» y «conexión no verificada». No existe una tabla central fiable de
sesiones online y no se inventa una. Una gateway nueva que todavía no pueda recibir órdenes en el broker actual debe
configurarse primero localmente con la herramienta/interfaz del fabricante: endpoint del broker vigente, MAC
normalizada como `client_id` y `username`, credencial inicial acordada y los topics exactos
`gw/{mac}/publish`/`gw/{mac}/subscribe`. Solo después de comprobar por separado que publica en el topic central debe
enviarse `1030`; la conexión al broker de destino se vuelve a verificar tras el reinicio `1000`.

## Gateways sin compañía y asignación posterior

La migración `012_unassigned_gateway_commands.sql` hace nullable exclusivamente el `company_id` del diario de
comandos. Una constraint permite ese valor nulo solo para `mqtt_connection_1030` y `gateway_restart_1000` con
actor usuario. Un índice único parcial conserva la idempotencia de estos comandos antes de asignar. No modifica
filas históricas ni introduce una empresa ficticia. Las demás lecturas, configuraciones BLE y comandos físicos
siguen exigiendo compañía.

Solo un administrador global puede dar de alta, configurar por `1030` y asignar una gateway aún sin compañía.
El mismo bloqueo por gateway serializa la asignación y la secuencia `1030`→ACK→`1000`. La asignación comprueba
que la empresa está activa, que la gateway todavía no pertenece a ninguna compañía y que no tiene referencias
heredadas incompatibles. Registra el cambio en auditoría y no altera la cuenta VerneMQ. Los comandos anteriores
conservan `company_id=NULL`; solo el administrador global ve ese historial previo. Los usuarios con alcance por
empresa ven la gateway únicamente después de la asignación y no reciben el historial global previo.

La pantalla **Compañías** permite crear, consultar, editar, desactivar y reactivar. La baja es lógica y conserva
referencias. Al desactivar una compañía, sus usuarios con alcance limitado dejan de ver y operar sus gateways;
debe coordinarse antes con operaciones. Las compañías inactivas no se ofrecen para asignar nuevas gateways.

Orden de despliegue: aplicar primero la migración 012 en una ventana controlada; desplegar después Backend y el
panel; verificar el alta sin compañía, el diario 1030/1000 y la asignación con una gateway simulada o de prueba
autorizada. No enviar comandos a hardware durante la comprobación de migración. Para volver al artefacto anterior,
desactivar primero el alta y la configuración de gateways sin compañía; el código anterior no podrá procesar esos
casos. Conservar la migración y los diarios durante ese rollback operativo. La reversión del `NOT NULL` solo es
segura tras revisar y resolver todas las filas con `company_id=NULL`; no borrar ni reasignar historial de forma
automática.

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
