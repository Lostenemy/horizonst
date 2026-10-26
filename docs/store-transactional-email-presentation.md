# Presentación de correos transaccionales — 26/10/2026

Rama local `codex/store-transactional-email-presentation`, desde
`8e471a3c607deba6eb003a6b27e76bd884eb7f79`. Sin push ni despliegue.

## Diagnóstico: hechos e hipótesis

Confirmado en `modules/shared/mail.ts`: presupuesto disponible, confirmación de pedido y
aceptación comercial generaban un div HTML mínimo, incluso con menos información que su
alternativa de texto. No reutilizaban la estructura corporativa de verificación. Esto explica
la ausencia de cabecera, botón y pie en la plantilla; no acredita qué MIME recibió producción.

La plantilla histórica de verificación contiene literalmente **Verificar mi cuenta**, sin
espacios internos ni caracteres invisibles en esa etiqueta. Con identidad y URL ficticias,
su HTML era una línea de **1.380 bytes**, enviada como `Content-Transfer-Encoding: 8bit`.
Se ha comprobado ese riesgo de líneas de transporte largas, no el origen exacto de «cue nta».
La captura no distingue una modificación en tránsito de una representación del cliente.
Sin el MIME original no se atribuye de forma concluyente a Roundcube, SMTP ni otra capa.
No se solicitó ni reutilizó el enlace/token mostrado en la captura, ni se incorporó esa captura.

## Cambio acotado

- Plantilla común `email-template.ts`: tablas de presentación fluidas, ancho máximo 600 px,
  cabecera azul oscuro, fondo claro, contenido blanco, botón turquesa, pie corporativo.
  Arial/fallback del sistema; estilos inline, sin CSS, fuentes o imágenes externas.
- Cuatro constructores usan la plantilla: verificación, presupuesto, confirmación de pedido
  y aceptación comercial. Se conserva todo el texto plano anterior; HTML incorpora ahora
  referencias, importe ya calculado y propósito completo del mensaje, sin nuevos cálculos.
- Presupuesto enlaza a `${STORE_PUBLIC_BASE_URL}/quotes`, ruta existente bajo ProtectedRoute
  y roles customer/distributor en `web/src/App.tsx`. No hay enlace de aceptación directa.
  Pedidos usan `/orders` y el aviso comercial `/admin/orders/{id}`, también existentes.
- Verificación recibe la URL ya construida por autenticación, sin cambiar token o caducidad.
  Todos los datos variables y atributos se escapan; se admiten solamente URLs HTTP/HTTPS.
- Texto exacto del botón y estilos `white-space:nowrap`, `word-break:normal`, sin guiones.
- El serializador común transmite las partes text/plain y text/html UTF-8 en **base64 con
  líneas de hasta 76 caracteres**. Evita depender de cómo un intermediario trate HTML largo
  en 8bit. Es una modificación de codificación para todos los correos del cliente SMTP, no
  de sus textos, destinatarios o efectos. Los adjuntos siguen con sus bytes/codificación previos.
- No se cambian estados SMTP, claims, timeout, respuestas 250, recuperación o transacciones.

## Paso por el registro durable

Verificación de cuenta usa `auth.routes.ts` → `sendEmailVerificationEmail` → SMTP; NO está
en el diario comercial. No se amplía su ámbito, persistencia de tokens ni política de reenvío.

Los otros tres mensajes se construyen después del COMMIT mediante `journal.dispatch` y
`deliverNotificationMail`. La intención sigue dentro de la transacción comercial. Se mantienen
`smtp_accepted` frente a `uncertain`, exclusión concurrente, rollback protegido y ausencia de
reintento automático. No se modifican, reclasifican ni reenvían filas históricas. El cambio
solo afecta a la presentación/codificación de mensajes que se generen posteriormente.

## Evidencias y pruebas ejecutadas

- Node 22.23.4 Windows: typecheck, backend build y frontend build correctos.
- Suite Store: **46 módulos aprobados, 0 fallidos, 0 omitidos**; lifecycle **24/24**.
- Contratos de aislamiento/lifecycle/diario: **7/7**. Sintaxis de los helpers correcta.
- Transporte SMTP TCP solo loopback, credenciales y destinatarios ficticios: ocho mensajes
  completos capturados —cuatro tipos × producción/staging—. Se decodifican las partes MIME
  y se comparan exactamente con HTML y texto, referencias, importes y enlaces esperados.
- Caso adicional de UTF-8/emoji, nombre largo, URL ficticia >1.800 caracteres y PDF ficticio:
  sin corrupción al decodificar, líneas MIME acotadas y adjunto idéntico byte a byte.
- Datos con `<img>`, `<script>`, comillas y ampersand: escapados, no ejecutables en HTML.
  Configuración de entorno y destinatario de prueba restaurados en finally.
- PostgreSQL 15.19 + SMTP ficticio, Docker Linux 29.8.2: regresiones completas del diario,
  **57 grupos aprobados** (51 grupos SMTP/DB anteriores, 3 grupos de mocks con 30 casos y
  3 grupos con 6 cortes reales PG). Sin fallos u omisiones en esos perfiles.
- Seis paradas del runtime con código 0, máximo **18,507 s**; seis recuperaciones sin reenvío;
  sin OOM/137. Limpieza de los 25 recursos propios confirmada, sin puertos Docker publicados.
- No se reejecutan Backend/Horneo, ajenos al cambio; no se presentan sus resultados previos
  como comprobaciones nuevas. No se cambian paquetes, lockfiles, migraciones ni Dockerfiles.

## Vistas previas revisadas

HTML extraído del MIME, no una maqueta diferente. Chrome 156 en Windows; escritorio
1280×1000 y viewport móvil 375×900. Inspección visual de cabecera, tipografía, espaciados,
texto, botón y pie en las ocho capturas. Medición adicional de los ocho documentos a
320/375/1280 px: **24/24**, sin desbordamiento y texto de botón en una sola línea. En
verificación también se midió la palabra «cuenta» como un único rectángulo.

| Mensaje | Escritorio | Móvil |
| --- | --- | --- |
| Verificación | [PNG](store-email-previews/desktop-verification.png) | [PNG](store-email-previews/mobile-verification.png) |
| Presupuesto | [PNG](store-email-previews/desktop-quote.png) | [PNG](store-email-previews/mobile-quote.png) |
| Pedido | [PNG](store-email-previews/desktop-order.png) | [PNG](store-email-previews/mobile-order.png) |
| Aceptación comercial | [PNG](store-email-previews/desktop-commercial.png) | [PNG](store-email-previews/mobile-commercial.png) |

Los PNG muestran datos ficticios y un marcador de token explícitamente no válido. No se
ha pulsado ningún enlace de acción. Playwright bloqueó file: y se utilizó un visor de solo
lectura en 127.0.0.1, con lista cerrada de archivos ficticios. La sesión de navegador queda
abierta, conforme a la instrucción del usuario. El viewport móvil NO es un cliente de correo.

**Pendiente:** renderizado/recepción en Roundcube real, Gmail, Outlook, Apple Mail u otros
clientes; CSS puede sufrir modificaciones o degradaciones particulares. Ninguna captura
de navegador acredita compatibilidad universal ni entrega al buzón. Tampoco demuestra la
causa exacta del correo histórico. Validar en staging solo con autorización y destinatarios
de prueba, sin reenviar históricos. La protección Brotli de la imagen final sigue con operaciones.

## Reproducción y archivo

Desde raíz con Node 22.23.4 y dependencias existentes:

```sh
node infrastructure/testing/store-lifecycle-suites.cjs --email-previews
node --test infrastructure/testing/isolation.test.cjs infrastructure/testing/lifecycle-contracts.test.cjs
node infrastructure/testing/email-preview-server.cjs "<evidence impreso por el harness>/previews"
node infrastructure/testing/smtp-journal-docker.mjs --run-disposable-docker
git diff --check
```

El primer comando usa una copia temporal sin .env, transporte local y entorno explícito.
Produce ocho `.eml`, `.html`, `.txt` y un índice de vistas. El visor imprime un puerto aleatorio
solo loopback; no conecta a servicios externos. El último harness requiere Docker Linux de
desarrollo, nunca Docker de producción; crea y limpia exclusivamente sus propios fixtures.

Evidencia final de Store: `horizonst-store-lifecycle-evidence-Kq2Pvh`; diario/Linux:
`horizonst-smtp-journal-JzQi5i`. Archivo persistente nuevo, sin sustituir los anteriores:
`C:/Users/User/Documents/horizonst/email-presentation-evidence-e07516eed9af4eb2bea5ef9332774c2a`.
109 archivos con MIME, HTML, texto, capturas, logs y mediciones; manifiesto SHA-256:
`87f6aab8c64dfbadf8b7addfb73b4052ff60032e4edbd09ac292cab7ac7d959f`.

Sin push, merge, despliegue, bases/servidores compartidos, correo real, MQTT, hardware o
colas físicas. Sin credenciales reales ni lectura de .env reales. No hay cambios de negocio.
