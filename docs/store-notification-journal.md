# Registro durable SMTP de Tienda

## Alcance y decisión

Continuación de `b12a5f36cfb4998cdde6168a22e0c0fd6ec627cc`, rama
`codex/graceful-shutdown-postgres`. El usuario confirmó el 25/10/2026 el modelo mínimo
de referencias del diseño: **sin copia del mensaje original y sin reenvío automático**.
No se pueden reconstruir exactamente correos anteriores después de editar datos.
No hay endpoint de reenvío ni un worker que mande pendientes al arrancar.

Se cubren las cuatro notificaciones post-COMMIT: propuesta disponible desde administración,
aceptación comercial desde cliente y confirmación de pedido desde ambos recorridos.
No se cambian autenticación, reset, contacto, prerreservas, precios ni estados comerciales.
La cola física de producción está expresamente fuera del alcance; no se accedió a ella.

## Correspondencia con el diseño

- `017_notification_deliveries.sql`: tabla aditiva, sin backfill, con referencias RESTRICT al
  historial, pedido y revisor. La propuesta y propietario se obtienen del historial, no se duplican.
- La intención y el ID del historial se insertan con la misma conexión y transacción comercial.
  Si falla la intención se revierte la transición; ningún SMTP se inicia antes de COMMIT.
- Clave única por evento, tipo y rol; pedido validado como perteneciente a la propuesta.
- Claim atómico mediante `FOR UPDATE SKIP LOCKED`, UUID y lease de 25 s. Ningún envío sin
  resultado de claim confirmado. Resultado final condicionado por UUID, estado y lease vigente.
- Hasta cuatro intentos simultáneos **por proceso**. Con varias réplicas, cada una tiene su límite,
  pero el claim PostgreSQL sigue excluyendo envíos duplicados de la misma intención.
- Al detener la admisión, desactivar correo, superar concurrencia o caer antes de reclamar,
  la intención permanece `pending` para revisión. No es una cola con entrega eventual garantizada.
- Transporte con límite absoluto de 15 s, conexión/consulta de diario con límite de 2 s cada una.
  Una conexión adquirida tarde o bloqueada se destruye, sin reproducir SQL. Presupuesto nominal
  máximo claim + SMTP + resultado: 19 s; drenaje útil de 20 s (24 s menos reserva DB de 4 s),
  watchdog 25 s, sin ampliar Docker. El margen requiere un event loop capaz de ejecutar timers.
- El lifecycle sigue las tareas y para el recuperador single-flight. No se espera QUIT para
  acreditar una aceptación final 250; un cierre posterior no invalida esa evidencia.
- Recuperador cada 5 s, máximo 100 filas por iteración: SOLO reclasifica leases expirados;
  jamás transmite. Una caída de PostgreSQL aplaza la recuperación; la siguiente iteración vuelve
  a adquirir conexión. No se modifica `pending` ni se resucitan estados terminales.

## Estados y significado

| Estado | Interpretación |
| --- | --- |
| `pending` | Intención confirmada; envío no iniciado. Puede requerir intervención por parada, capacidad o correo deshabilitado. |
| `dispatching` | Claim durable, resultado aún no durable. No es evidencia de entrega. |
| `smtp_accepted` | Se observó el 250 final tras DATA y se persistió. **No acredita buzón ni lectura**. |
| `rejected_temporary` | Respuesta negativa explícita 4xx, incluido tras DATA. No se reintenta. |
| `rejected_permanent` | Respuesta negativa explícita 5xx. No se reintenta. |
| `failed_before_send` | El cliente no llegó a transmitir el contenido DATA. No equivale a rechazo SMTP. |
| `uncertain` | DATA pudo llegar, faltó respuesta final o persistencia, o venció un lease tras interrupción. Nunca reenviar automáticamente. |
| `cancelled` | Un administrador canceló una intención todavía pending; acción auditada. |

Los rechazos se clasifican con el código numérico del protocolo, no por texto de excepciones.
No se guardan cuerpo, destinatario, contraseña, respuesta libre SMTP, token ni huella del secreto.
Los logs del diario contienen únicamente un código fijo de revisión necesaria. Los errores de
transporte no salen de ese recorrido. Un Message-ID aleatorio no ofrece exactamente-una-vez.
No existe transacción distribuida SMTP/PostgreSQL: si SMTP aceptó y el resultado SQL se pierde,
la fila puede quedar `dispatching` y pasar a `uncertain`, aunque realmente se haya enviado.

## Revisión operativa y permisos

Con el Bearer habitual de Tienda:

- `GET /api/quotes/:id/notifications`: propietario customer/distributor o admin. Recurso ajeno 404.
  Campos cerrados: IDs, tipo/rol, estado/códigos numéricos y fechas; sin destinatario ni contenido.
- `POST /api/admin/notifications/:id/cancel`: admin, solo `pending`, sin contenido libre.
- `POST /api/admin/notifications/:id/review`, JSON
  `{"decision":"acknowledge_no_resend"}`: admin, resultado terminal todavía sin revisión.
  Registra revisor y auditoría en transacción sin cambiar la conclusión SMTP ni mandar nada.
  Repetición o estado no revisable devuelve 409.

No se añade pantalla ni botón de reenvío. Operaciones puede usar esos endpoints autenticados.
Para decidir un NUEVO aviso humano hay que revisar primero los registros SMTP y el estado
comercial actual por un procedimiento separado autorizado. No presentar una nueva redacción
como copia del mensaje original, ni limpiar filas para volver a disparar la transición.

## Migración, staging y retorno (no ejecutados en servicios compartidos)

1. Revisar diff y respaldo/versiones con operaciones. Construir imagen segura de aplicación final;
   **reconstruir sobre ella la corrección Brotli nativa de Backend pendiente**, no reutilizar el
   candidato con aplicación anterior. No se modifican runtime ni Dockerfiles de producción aquí.
2. Sin iniciar el nuevo código de Tienda, aplicar por operaciones SOLO el runner específico:
   `node dist/db/migrate-notifications.js` dentro de su imagen final con su configuración habitual.
   No imprimir entorno/secretos. No usar `migrate.js` para este despliegue si 011–015 están pendientes.
   El runner específico usa ledger SHA-256 `store.notification_migrations`, bloqueo transaccional,
   chequeo de columnas y no marca migraciones comerciales como aplicadas. Debe existir 001–010.
   El runner general también podrá aplicar 017 durante una reconciliación comercial autorizada.
3. Verificar tabla, FKs RESTRICT, constraints, índice y checksum. No hay backfill ni borrado.
4. Iniciar una instancia de Tienda en staging en ventana autorizada. Verificar health original;
   el health conserva su contrato DB, **no certifica SMTP ni la migración del diario**.
   Sin tabla, las transiciones notificables fallan y se revierten antes de mandar correo.
5. En staging, únicamente con cuentas/destinatarios de pruebas aprobados: comprobar intención,
   aceptación o incertidumbre reales, revisión, dos señales y recuperación DB. No usar clientes
   reales para ensayos ni interpretar aceptación SMTP como recepción en buzón.
6. Revisar `pending`, `dispatching` vencidos y `uncertain` mediante endpoints; no limpiar ni relanzar.
   La validación con proveedor SMTP real, destinatarios reales y despliegue requieren autorización.

Retorno: detener admisión y nuevos claims, drenar, conservar tabla/ledger/historial y revisar
resultados inciertos. Restaurar únicamente imagen segura aprobada. El código anterior NO registra
las nuevas notificaciones: no ejecutar simultáneamente versiones nueva/vieja ni pretender que el
rollback siga ofreciendo durabilidad SMTP. Mantener correo deshabilitado en la imagen anterior
si no se ha aprobado expresamente esa pérdida de garantía. No borrar 017 ni revertir FKs para
volver a código antiguo. No tocar colas físicas. No volver a un runtime vulnerable.

## Reproducción aislada

Desde raíz, Node **22.23.4**, Docker Linux de desarrollo (nunca Docker de producción):

```sh
node --test infrastructure/testing/isolation.test.cjs infrastructure/testing/lifecycle-contracts.test.cjs
node infrastructure/testing/run-suites.cjs
node infrastructure/testing/store-lifecycle-suites.cjs
node infrastructure/testing/smtp-journal-docker.mjs --run-disposable-docker
```

El último comando construye el target Store de `lifecycle.Dockerfile`, crea red `--internal`,
PostgreSQL 15 y servidor SMTP ficticio propios, sin puertos, volúmenes compartidos ni `.env`.
Aplica 001–010 y 017 solo allí, conserva 011–016 sin aplicar. Repite protocolo/DB tres veces y
parada del runtime Node PID1 tres veces con DB disponible y tres veces caída; prueba reinicio
y recuperación durable sin segundo envío. El fixture incluye fallo simulado de respuesta SQL
después de escritura real, además de cortes SMTP/DB reales desechables. No es una captura real
de pérdida de ACK TCP de COMMIT en todas las fases posibles: esa incertidumbre se conserva.

La limpieza actúa solo sobre IDs adquiridos; `rm -f` de fixtures no acredita el cierre. El cierre
se mide antes, debe salir 0 en menos de 28 s, sin OOM ni 137. Imágenes/caché propias permanecen.
Las evidencias, incluidas ejecuciones fallidas, se guardan en un directorio temporal único.

## Registro de avance

- Estado inicial comprobado: b12a5f3, versionados limpios; no versionados conservados.
- Modelo mínimo confirmado; implementación, rutas y pruebas añadidas.
- Las dos rutas notificables capturan también el fallo de adquisición PostgreSQL anterior a
  BEGIN y responden 503: no hay rechazo de promesa fuera del manejador de Express 4 ni replay.
- Primera ejecución aislada: 14 casos pasaron; falló lectura JSON del harness por mezclar
  stdout y stderr. Evidencia conservada en `horizonst-smtp-journal-4Zijoj`.
- Revisión final validada: SMTP absoluto 15 s; Backend 300 aprobadas/6 opt-in omitidas, Horneo
  207/4 opt-in omitidas, Store 44 módulos y 24 pruebas lifecycle aprobados, contratos 7/7.
  Typecheck y builds correctos. Omitidas: integraciones PostgreSQL previas ajenas a SMTP, no
  activadas en la suite offline. No se afirma haberlas repetido con PostgreSQL aquí.
- Docker final `horizonst-smtp-journal-0l5m4U`: **51/51 grupos de protocolo/DB**, 3 rondas;
  seis recuperaciones sin reenvío y **6/6 paradas**, todas código 0, sin OOM/137. Máximo 19,169 s.
  Tiempos por ronda: DB disponible 14,868/14,546/14,809 s; DB caída 18,697/18,844/19,169 s.
  Node 22.23.4, PostgreSQL 15.19, Docker 29.8.2 Linux local. Recursos propios eliminados: 25/25.
- Resumen estructurado y lista exacta de los 20 archivos: `store-notification-validation-results.json`.
  Archivo externo nuevo: `C:/Users/User/Documents/horizonst/smtp-validation-evidence-2ef57e58fe0c446b928f7fd2d9f65fd6`,
  219 logs/JSON y manifiesto `SHA256SUMS.csv`, SHA-256
  `b8bd38bc4b6023b3fdd9c9c9e6235fbc1c0b80f0c75ed5b0a59baa20585d7885`.
  Conserva ejecuciones intermedias y el fallo inicial; no se mezclan sus imágenes con la revisión final.
- Evidencia anterior intacta: `shutdown-validation-results.json` y archivo externo
  `shutdown-validation-evidence-3C46AQ`; no sustituida por los resultados nuevos.

Estado de entrega: implementación y validación aislada terminadas, preparadas para revisión.
**Pendiente staging y reconstrucción Brotli por operaciones; no autorización ni declaración de
desplegabilidad global.** No se probó recepción en buzones reales, no se accedió a colas físicas
de producción y no se realizaron push, merge ni despliegue. El árbol previo se conserva.
