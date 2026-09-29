# Contacto de la web comercial

## Alcance

`/contacto` pertenece a la web comercial en `horizonst.es`, `www.horizonst.es`,
`horizonst.com.es` y `www.horizonst.com.es`. Inicio, Contacto y privacidad usan
rutas relativas: nunca saltan de staging a producción. Se mantiene la lista
cerrada de dominios y la tienda en sus dos dominios existentes. Se retira solo
el botón «Consultar mi instalación» y se conservan los otros accesos, ahora al
formulario. No se alteran campaña, precios, condiciones ni autenticación.

## Envío y protección

`POST /api/contact` acepta exclusivamente `fullName` (2–200 caracteres),
`email` (válido, máximo 320), `message` (10–2000), `privacyAccepted: true`
y el honeypot opcional `website`, que debe estar vacío. JSON máximo 12 KiB.
Nombre y correo rechazan CR/LF/NUL; el mensaje permite saltos de línea y
rechaza NUL. El HTML se escapa. El servidor fija el destinatario en
`comercial@horizonst.es`; `STORE_MAIL_COMMERCIAL_TO` no lo cambia. El visitante
no controla From, destinatario, asunto ni cabeceras. Su email validado y
normalizado es únicamente Reply-To; From es el configurado en el servidor.

Se reutilizan el transporte SMTP y los contadores atómicos de
`store.auth_rate_limits`: 5 peticiones/origen, 3/email y 3/origen+email por hora,
compartidas entre réplicas, con `Retry-After` y fallo cerrado si PostgreSQL no
está disponible. Las repeticiones también consumen presupuesto. Se conserva
la confianza exacta en el proxy existente y el uso de `req.ip`. No se cambia
el presupuesto de autenticación. No hay tabla de leads nueva ni migración.

Para evitar duplicados, una reserva atómica HMAC del nombre/email/mensaje
normalizados dura 15 minutos en la misma tabla. Solo se almacenan una clave
opaca, caducidad y estados numéricos; nunca el mensaje, email o IP en claro.
Estados del namespace de contacto: 1 pendiente/incierto, 2 aceptado por SMTP,
3 fallo. El secreto HMAC es el `STORE_JWT_SECRET` existente y debe ser idéntico
en las réplicas. Una solicitud simultánea recibe 409; una repetición ya
aceptada obtiene éxito sin volver a enviar. Un fallo SMTP o de registro del
resultado no se presenta como éxito y no se reenvía automáticamente.

Limitaciones: aceptar DATA por SMTP no garantiza entrega final en el buzón.
Si se pierde la respuesta SMTP o falla PostgreSQL después de enviar, el estado
puede quedar incierto: se conserva la reserva y la UI conserva los campos,
indicando que no se confirmó el envío. La protección no garantiza exactamente
un correo para siempre: cambiar el contenido o repetir después de 15 minutos
puede generar otro envío dentro de los límites. No hay reintentos en segundo
plano ni almacenamiento durable del contenido para recuperarlo. Los errores
del endpoint son genéricos y no imprimen payload, datos personales ni detalles
SMTP. La conexión SMTP tiene un límite de 15 segundos y las respuestas usan
el límite existente; no se sustituye la configuración TLS del servidor.

## Variables y habilitación (procedimiento; no ejecutado)

No se han leído secretos ni comprobado la configuración real de staging o
producción. Si faltan credenciales autorizadas o la infraestructura siguiente,
el envío queda bloqueado; no se deben inventar valores ni mostrar éxito.

Variables existentes necesarias:

| Variable | Uso |
| --- | --- |
| `STORE_MAIL_ENABLED` | Activar explícitamente el transporte, por defecto desactivado. |
| `STORE_MAIL_HOST`, `STORE_MAIL_PORT` | Servidor SMTP aprobado y su puerto. |
| `STORE_MAIL_SECURE` | TLS implícito según el servidor; no presume STARTTLS. |
| `STORE_MAIL_USER`, `STORE_MAIL_PASSWORD` | Identidad autorizada, mediante el mecanismo de secretos existente; nunca en logs/documentación/commits. |
| `STORE_MAIL_FROM` | Remitente autorizado por ese servidor SMTP. |
| `STORE_MAIL_EHLO_DOMAIN` | Dominio EHLO aprobado. |
| `STORE_MAIL_TLS_REJECT_UNAUTHORIZED` | Mantener validación del certificado activada. |
| `STORE_JWT_SECRET` | Secreto existente, robusto y común a las réplicas; no modificarlo para habilitar este formulario. |
| `DATABASE_URL` o `DB_*` | Conexión existente a Store; no crear otra base ni reutilizar credenciales de pruebas. |
| `TRUSTED_PROXY_IP` | Proxy exacto de cada entorno para presupuestos por origen. No ampliar confianza. |

1. Revisar que el entorno tiene `store.auth_rate_limits` (infraestructura de
   seguridad 016 ya existente). Si falta, seguir la vía de migración de
   seguridad documentada, sin ejecutar automáticamente migraciones comerciales.
2. En staging, usar primero SMTP simulado/capturador aislado autorizado, sin
   destinatarios externos, y una base desechable con esa infraestructura.
   Inyectar credenciales ficticias mediante el mecanismo de configuración del
   entorno. No copiar valores de producción ni modificar Nginx/CORS.
3. Comprobar formulario en escritorio/móvil y teclado; verificar en la captura
   el destinatario fijo, From configurado y Reply-To. Simular rechazo SMTP,
   envío pendiente, doble clic, límites y fallo PostgreSQL. No registrar cuerpos.
4. Tras aprobar esas pruebas, operaciones debe verificar de forma privada
   credenciales, remitente, TLS y recepción del buzón comercial. Solo con
   autorización expresa puede hacerse un correo real de comprobación, sin
   datos de clientes. La prueba automática nunca envía correo real.
5. Aplicar el mismo procedimiento de revisión en producción, con sus propios
   secretos. Este cambio no autoriza despliegue ni modificaciones de servicios.
   Con correo desactivado o fallo, el endpoint devuelve 503 y conserva la UI
   los datos; no hay una ruta alternativa mailto que oculte ese fallo.

## Validaciones reproducibles

Desde `horizonst-store`: `npm run typecheck`, `npm run build`, `npm test`.
La suite incluye `test/public-contact.test.ts` (HTTP real en loopback, SMTP y
PostgreSQL simulados) y el contrato SMTP con socket simulado, además de las
pruebas existentes de autenticación, campaña y dominios. No usa DB compartidas.

Para navegador, construir la web, servir exclusivamente en loopback la preview
Vite en 4173 y abrir una sesión Playwright CLI en `about:blank`. Ejecutar con
`run-code --filename=horizonst-store/scripts/public-contact.browser.js`.
El harness intercepta todas las URLs antes de navegar, sirve los seis hostnames
virtuales desde loopback y simula cada respuesta API/correo. No accede a esos
dominios reales. Revisa cuatro hostnames comerciales a 390 y 1440 px, errores,
límites, teclado, estados accesibles, concurrencia y conservación de tiendas.
Cerrar solo la sesión y la preview adquiridas para la prueba.

### Resultado local de esta entrega

- Typecheck Backend y frontend y build completo de Store: correctos.
- Suite completa: 42 módulos de pruebas finalizados sin fallo. El módulo nuevo
  añade 13 comprobaciones HTTP/correo/antiabuso aprobadas, 0 fallidas, 0 omitidas;
  el contrato SMTP comprueba From, Reply-To, destinatario y rechazo de inyección.
- Navegador: 8 recorridos (4 hosts × escritorio/móvil), 24 envíos simulados,
  0 errores JavaScript; dos dominios de tienda conservados. También se verifica
  correo inválido, foco del primer error, tabulación, consentimiento con Espacio
  y envío con Enter. Revisión visual de ambas anchuras realizada.
- Sintaxis del harness y `git diff --check`: correctos. No se añadieron
  dependencias ni se modificaron lockfiles o migraciones.
- SMTP y PostgreSQL simulados: queda pendiente la comprobación autorizada de
  configuración y entrega real de cada entorno. No se desplegó ni se envió correo.
