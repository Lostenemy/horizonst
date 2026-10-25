# Tienda: diseño de registro durable de notificaciones

Estado: DISEÑO autorizado por el usuario el 25/10/2026. No implementado.
No incluye migración, datos nuevos, worker de envío, reintentos ni endpoints nuevos en esta entrega.
Su implementación necesita una entrega separada revisable. El cierre queda bloqueado para
despliegue mientras se exija recuperación durable de todos los correos en curso.

## Evidencia y alcance

`src/modules/quotes/quotes.routes.ts` y `src/modules/admin/quotes.routes.ts` lanzan cuatro
notificaciones después de COMMIT mediante promesas desacopladas: propuesta disponible,
aceptación comercial y confirmación de pedido (esta última desde dos recorridos).
`store.quote_status_history` ya registra la transición y su actor en la transacción, pero
`insertQuoteStatusHistory` devuelve actualmente `Promise<void>` y no el ID insertado.
`store.audit_log` no es una cola ni acredita la aceptación SMTP. No debe reinterpretarse como tal.

La implementación actual únicamente incorpora esas cuatro promesas al drenaje del lifecycle,
sin cambiar mensajes, destinatarios, transacciones comerciales ni respuestas HTTP. Eso no
proporciona persistencia después de una caída. SMTP usa límites de inactividad de 15 s, no un
límite absoluto de toda la entrega; el presupuesto de parada puede agotarse.

## Propuesta

Crear en una migración NUEVA una tabla `store.notification_deliveries` independiente de los
estados de propuestas/pedidos. Registrar intención en la misma transacción que la transición
comercial y su historial. No mandar correo antes de COMMIT. No modificar precios ni estados.

Datos mínimos propuestos:

- UUID de entrega y referencia al `quote_status_history.id`, propuesta/pedido y propietario.
- Tipo de notificación y rol de destino (`customer`/`commercial`), con listas cerradas.
- Clave única `(status_history_id, notification_type, recipient_role)`. No usar solo el ID de
  propuesta: impediría avisos legítimos de transiciones posteriores.
- Estado, UUID de intento, lease y fechas PostgreSQL, códigos de resultado seguros y actor de revisión.
- No almacenar contraseña SMTP, tokens, SQL, cuerpo del mensaje o direcciones en logs/auditoría.
  El destinatario se resuelve conforme a las reglas existentes, nunca desde una petición arbitraria.

El historial debe devolver su ID (`INSERT ... RETURNING id`) dentro de la transacción existente.
No reconstruir claves mediante timestamps o una consulta posterior que pueda elegir otro evento.
FKs sin borrados en cascada que destruyan trazabilidad; revisar tipos/constraints reales antes de
crear la migración. No rellenar eventos históricos: su estado de envío no puede inferirse.

## Estados y garantías

| Estado | Evidencia necesaria | Recuperación |
| --- | --- | --- |
| `pending` | Intención comercial confirmada; ningún intento autorizado todavía | Permanece durable, sin envío automático tras reinicio |
| `dispatching` | Claim UUID y lease persistidos ANTES de iniciar transporte | Lease vencido pasa a revisión/`uncertain`, nunca vuelve ciegamente a pending |
| `smtp_accepted` | Respuesta final de aceptación SMTP observada y resultado persistido | Terminal; no implica entrega al buzón ni lectura |
| `uncertain` | Posible envío sin evidencia final durable, caída o resultado perdido | Revisión manual; nunca reenvío automático |
| `failed_before_send` | Evidencia explícita de que no se transmitió un mensaje | Revisión explícita; no deducirlo de un error genérico |
| `cancelled` | Cancelación explícita auditada antes de iniciar el envío | Terminal; conservar historial |

Inicialmente es más seguro clasificar TODO error posterior a `dispatching` como incierto.
El cliente SMTP actual no expone un contrato de fase suficiente para distinguir todos los errores.
No inventar ese contrato a partir del texto de una excepción. Una mejora posterior puede ofrecer
prueba explícita de fallo anterior al envío, cubierta por tests de protocolo.

Usar claim transaccional `FOR UPDATE SKIP LOCKED` y condición por UUID para cada resultado.
Concurrencia limitada y leases finitos. Una reclamación antigua no puede finalizar un intento nuevo.
Si no puede persistirse el claim, NO iniciar SMTP. Si el resultado SMTP no puede persistirse,
no afirmar éxito ni volver a enviar: conservar `dispatching`, que se convertirá en `uncertain`.

Un `Message-ID` estable puede facilitar revisión, pero NO garantiza deduplicación del servidor SMTP.
No existe atomicidad PostgreSQL+SMTP: no prometer entrega exactamente una vez. El objetivo es
intención durable, detección de incertidumbre y ausencia de reenvíos automáticos peligrosos.

## Revisión y permisos

La vista/operación de revisión debe aplicar los permisos actuales de Tienda y ámbito de propietario.
Un cliente no puede consultar ni reenviar avisos de otro. No reutilizar permisos de Hardware Manager.
Registrar actor, razón permitida y estado anterior/nuevo, sin destinatarios ni cuerpos en auditoría.

Para cualquier nuevo intento humano exigir revisión del estado comercial y de los registros SMTP
disponibles, confirmación explícita y UUID de intento nuevo enlazado al anterior. No convertir
`uncertain` en `smtp_accepted` por agotamiento de tiempo. No permitir que recargar una página reenvíe.

Decisión antes de implementar: este diseño mínimo conserva referencias, no una copia del cuerpo.
Si negocio necesita recuperar EXACTAMENTE el mensaje original tras editar la propuesta o los
datos del cliente, se necesitará un snapshot inmutable con política de privacidad, retención y
protección acordadas. No reconstruir un supuesto mensaje original con datos actuales.
Con referencias solamente, el reenvío humano debe presentar el mensaje actual como un NUEVO
intento explícito; nunca presentarlo como reproducción idéntica del anterior.

## Parada y reinicio

1. Detener nuevas reclamaciones y admisión; drenar intentos en curso dentro del plazo acordado.
2. Persistir resultados conocidos antes de cerrar PostgreSQL.
3. Si acaba el presupuesto, no marcar enviado ni completado. La fila debe permanecer durable.
4. Al arrancar, recuperar leases a estados de revisión, sin enviar correo automáticamente.
5. Una transacción comercial revertida no deja intención; una confirmada deja exactamente una
   intención por clave de evento, aunque el proceso caiga antes de iniciar SMTP.

El registro no debe alterar disponibilidad de las rutas de consulta ni usar una compañía ficticia.
La indisponibilidad de PostgreSQL no autoriza enviar sin claim ni activar una cola solo en memoria.

## Pruebas de aceptación propuestas

- PostgreSQL 15 desechable: atomicidad comercial/historial/intención y rollback de cada fase.
- Dos reclamantes; exclusión, expiración, UUID obsoleto y estados terminales inmutables.
- SMTP simulado: éxito, fallo antes del envío demostrado, desconexión durante DATA, aceptación
  250 seguida de caída de PostgreSQL, COMMIT con resultado perdido y QUIT fallido.
- Reinicio antes del envío, durante el envío y después de aceptación antes del apunte durable.
- Ningún caso incierto reenvía automáticamente; revisión y cancelación requieren permisos.
- Parada por SIGTERM/SIGINT, pool saturado y transporte bloqueado: menos de 30 s con margen,
  intención preservada, sin registros ficticios de éxito ni duplicados.
- No hay fugas de secretos, destinatarios o contenido en HTTP de terceros, logs o auditoría.
- Todas las pruebas comerciales existentes conservan contratos y respuestas.

## Despliegue y retorno futuros

Revisar primero el diseño y la decisión de snapshot. Después, en otra entrega: migración aditiva,
pruebas aisladas, aplicación de migración en staging por operaciones y activación de código que
exija el registro antes de enviar. No usar `IF NOT EXISTS` para aceptar un esquema incompatible.
Antes de rollback detener reclamaciones, revisar filas inciertas y preservar la tabla/historial.
Volver a código antiguo que ignora la cola mientras siguen activos nuevos consumidores puede
duplicar avisos: no hacerlo sin un procedimiento de corte aprobado. No borrar filas ni leases.
