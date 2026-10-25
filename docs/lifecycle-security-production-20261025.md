# Promoción lifecycle, registro SMTP y recetas de seguridad
## Entrega
Se integran b12a5f3, 88f191a y 8e471a3, descendientes de main, sin arrastrar el historial divergente del checkout de producción.
Recetas permanentes fijan Node 22.23.4 y mínimos Brotli/certificados; Compose deja 30s a Backend/Horneo/Tienda para su presupuesto interno de cierre de 25s.
Preparar desde el SHA publicado en una release independiente; no sustituir el checkout operativo ni copiar el Compose de staging.

## Acreditado en staging
- Tres servicios saludables, Node 22.23.4 y Brotli 1.2.1-r0; tres paradas con código 0, sin OOM/137 y recuperación.
- Registro cliente, verificación humana del enlace, login, catálogo, carrito, cantidades y cálculos.
- Presupuesto solicitado, revisado, enviado y aceptado; un único pedido ficticio.
- Repetir decisiones cliente/admin devuelve 409 sin duplicar pedido ni notificaciones.
- Diario: una entrada por evento. Aceptación SMTP diferenciada de recepción en buzón.
- Aviso comercial guardado por LMTP; confirmaciones de cliente aceptadas por su servidor.
- PDF cliente/admin descargable con tipo/firma PDF. No se afirma revisión visual.
Las pruebas funcionales se completaron por API real en loopback autenticado. Recorrido completo por navegador y confirmación humana del correo final pendientes.
Evidencias detalladas protegidas en staging, fuera de Git.

## Preparación de producción sin activar
1. Refrescar hostname=horizonst-prod, IDs/StartedAt/imagen/montajes, Git y /health. No leer secretos ni cola física.
2. Respaldar configuración y bases horizonst/cold_compliance con 0700/0600; pg_restore -l y SHA256.
3. Extraer fuentes del SHA publicado. Si SQL histórico solo difiere en CRLF, conservar bytes desplegados y verificar ledger Backend. Ante diferencia semántica, detener.
4. Construir app, cold_compliance_service y horizonst_store; pruebas aisladas sin puertos, configuración real ni datos.
5. Verificar Node, paquete/marcador Brotli, CA y HTTP Brotli benigno. Repetir diez regresiones de routers en la imagen final.
6. Conservar imágenes actuales y retornos con Brotli corregido. Crear override candidato limitado a tres imágenes, contextos de build y stop_grace_period=30s. Compose config --quiet sin activar.
7. No ejecutar migración 017 ni recrear servicios todavía. Registrar SHA, IDs de imágenes, respaldos y plan.

## Activación posterior con ventana aprobada
- Refrescar respaldo y verificar que configuración/servicios no cambiaron.
- Respetar restricciones operativas de Horneo sin consultar/manipular la cola física excluida.
- Ejecutar SOLO node dist/db/migrate-notifications.js en la imagen final con configuración habitual, compose run --rm --no-deps y stdin cerrado. No ejecutar runner general ni migraciones comerciales pendientes.
- Verificar ledger SHA256, columnas, FK RESTRICT, CHECK, unicidad e índice. Sin backfill ni reenvíos.
- Recrear exclusivamente tres servicios verificados: --no-deps --no-build --pull never, sin --remove-orphans.
- Verificar health/readiness Backend/Horneo, MQTT, Tienda /health con DB, mismos volúmenes y servicios ajenos intactos.
- Pruebas autenticadas y correo real en producción requieren cuentas/destinatarios aprobados; no reutilizar automáticamente los de staging.

## Retorno
Conservar 017, historial y resultados inciertos. No restaurar dumps a ciegas ni reenviar.
Volver únicamente a imágenes de retorno seguras y mismos volúmenes.
Tienda anterior carece de diario durable: mantener correo deshabilitado en retorno hasta acordar esa pérdida de garantía.
No volver a Node vulnerable ni a bases antiguas del broker.

## No promocionar automáticamente
- El relay de ejemplo y el bloqueo temporal de Roundcube eran específicos de staging. Producción ya tenía correo directo operativo: comprobarlo, no sobrescribirlo.
- Limpieza Docker y retención del journal son operaciones por servidor.
- No promover buzones, contraseñas, usuarios/pedidos ficticios, env, backups, sesiones o logs.
- La preparación no modifica servicios activos, broker, PostgreSQL, Nginx, correo, SSH, firewall ni cola física.
