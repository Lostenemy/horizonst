# Resolución de auditoría UI/UX y comunicación

Fecha: 28 de septiembre de 2026. Rama: `codex/store-auditoria-ux`.
Base actualizada: `origin/main`, `9e1bc89fbb9b46ffe255d19cc3f904c89353cfaa`.

La web pública y Store se generan desde `horizonst-store/web` en el repositorio HorizonST, diferenciadas por hostname. `frontends/horizonst.es` contiene el informe, no otra aplicación versionada. El informe original `frontends/horizonst.es/informe-auditoria.md` no se ha modificado.

## Matriz H01–H16 / UX-001–UX-016

Las rutas de esta tabla son relativas a `horizonst-store`. «Resuelto» describe la corrección local comprobada, no una validación de producción ni un aumento de conversión medido.

| Hallazgo | Estado | Archivos principales | Evidencia y validación |
| --- | --- | --- | --- |
| H01 / UX-001 | Resuelto | `src/modules/prereservation/prereservation.service.ts`, `src/modules/shared/mail.ts`, `web/src/pages/PublicLanding.tsx`, `PublicPrereservation.tsx` | Backend vigente hasta `2027-01-01T22:59:59.999Z`: el siguiente milisegundo es 2 de enero, 00:00 Madrid. Tests de frontera y HTTP 410; tres CTA activas y tres alternativas comerciales tras caducar. Fecha compartida en correo. La web consulta al servidor y refresca cada 30 s; acceso y confirmación se validan en servidor, no por reloj cliente. Precios y 5 % intactos. |
| H02 / UX-002 | Parcial | `PublicLanding.tsx`, `PublicPrereservation.tsx`, `Catalog.tsx`, `Cart.tsx`, `admin/AdminQuotes.tsx` | IVA junto al importe, hardware de pago único y web anual, acreditado por `annual_price_cents` y las rutas comerciales existentes. Totales/calculadoras intactos. Carrito ficticio con ambas identidades. No se presupone renovación automática, soporte incluido ni servicios de implantación. Falta confirmar estas condiciones. |
| H03 / UX-003 | Resuelto | `PublicLanding.tsx`, `web/src/styles.css` | CTA al formulario real; formulario antes de la imagen en móvil. A 390×844, título y email visibles bajo cabecera fija. Captura y prueba ejecutable. |
| H04 / UX-004 | Resuelto | `web/src/styles.css` | Enlace normal/visitado subrayado `#d8fbff`; foco visible. Contraste calculado sobre los dos extremos del fondo: 11,19:1 y 13,61:1. Captura inspeccionada; no se elimina el foco existente. |
| H05 / UX-005 | Resuelto | `components/Layout.tsx`, `Dashboard.tsx`, `admin/AdminQuotes.tsx`, `lib/presentation.ts` | `/quotes` está reservado por `RoleRoute` a cliente/distribuidor; el enlace genérico de admin llevaba a una redirección, no a sus presupuestos. Admin ahora usa `/admin/quotes`, «Gestionar presupuestos». Otros roles usan «Mis presupuestos». Permisos intactos, navegación por tres fixtures y HTTP de aislamiento con middleware real. |
| H06 / UX-006 | Resuelto | `Register.tsx` | Labels visibles asociados a controles, teléfono opcional, ayuda persistente mínimo 10 caracteres coincidente con Zod, autocomplete. Etiquetas y tabulación probadas sin enviar registro. |
| H07 / UX-007 | Parcial | `PublicLanding.tsx` | Explicación comprensible del dispositivo personal, puntos de comunicación, avisos a responsables y consulta privada; requisitos de cobertura, alimentación, conectividad y organización. No se prometen tiempos de respuesta ni cobertura garantizada. Falta una ficha autorizada de requisitos y alcance de instalación para aportar especificaciones más concretas. |
| H08 / UX-008 | Resuelto | `PublicLanding.tsx` | Reutiliza `comercial@horizonst.es` en hero, decisión de planes y cierre FAQ. La guía permanece; ningún formulario comercial nuevo ni envío real. |
| H09 / UX-009 | Resuelto | `PublicLanding.tsx`, `components/Layout.tsx` | «Tienda B2B» y explicación separada del panel operativo de la instalación. Se conserva el destino comercial existente; no se inventa ni publica acceso privado. |
| H10 / UX-010 | Parcial | `PublicLanding.tsx`, `Catalog.tsx` | Capacidades totales mostradas directamente desde `max_tags`/`max_gateways`; eliminada la presentación como incremento derivado y compra previa no acreditada. Precios y límites API sin cambios. Falta confirmar el contrato Enterprise y si requiere Professional. No se presenta una dependencia supuesta. |
| H11 / UX-011 | Parcial | `lib/presentation.ts`, `Quotes.tsx`, `DistributorProfile.tsx`, páginas administrativas de presupuestos/pedidos/distribuidores/auditoría/prerreservas | Diccionario compartido para estados, roles y eventos conocidos; los `value` y contratos siguen en inglés. Código técnico secundario en auditoría; códigos desconocidos no se inventan. Traducciones probadas. Falta ratificación comercial del significado de los estados y vocabulario de futuros eventos. |
| H12 / UX-012 | Resuelto | `components/Layout.tsx`, `admin/AdminShell.tsx`, `web/src/styles.css` | Menús compactos con sección/título visibles, `aria-expanded`, `aria-controls`, enlaces existentes y salida conservados. Teclado de menú y elección, 390/768/1024/1280/1440 sin overflow en rutas comprobadas. |
| H13 / UX-013 | Resuelto | `Dashboard.tsx`, `admin/AdminDashboard.tsx` | Cliente/distribuidor reciben próximos pasos y sus últimas solicitudes mediante `/api/quotes` ya aislada. Admin enlaza pendientes. Alcance de KPI confirmado en `src/modules/admin/dashboard.routes.ts`: histórico sin fechas, estados abierto/aceptado; `total_cents` incluye impuestos/descuento y no es cobro. Borrador con nombre legible en vez de ID. No se afirma listar toda la actividad en el resumen reciente. |
| H14 / UX-014 | Parcial | `PublicLanding.tsx` | Se conservan superficie y trabajadores del texto preexistente y se distingue implantación de resultados/garantías. No se añaden métricas, testimonios ni capturas privadas. Falta autorización y evidencia de un resultado concreto del cliente, incluida ratificación de las cifras anteriores. |
| H15 / UX-015 | Resuelto | `admin/AdminQuotes.tsx`, `admin/useAdminLoad.ts` | Filtros etiquetados y enumerados, mensaje contextual, botón de limpieza que borra también el filtro de URL. Prueba con lista vacía y recuperación. Generación de petición impide que una respuesta antigua sustituya los resultados nuevos; regresión de navegador con respuesta demorada. |
| H16 / UX-016 | Resuelto | `App.tsx`, `lib/presentation.ts` | Títulos por ruta y marca, incluidos detalles; efecto al navegar sin recargar. Tests de función y título de navegación administrativa. |

Mejora adicional: `Cart.tsx` separa nombre y especificaciones en el primer `:` y conserva íntegramente el resto del snapshot, incluso otros `:`; test de preservación. No cambia cantidades, descuentos ni cálculo de impuestos.

## Validaciones locales

- Store: `npm run typecheck`, `npm test` (39 módulos de prueba), `npm run build` (Vite + TypeScript backend): correctos.
- Frontend: `npm run typecheck`: correcto; el build completo vuelve a ejecutar `tsc --noEmit`.
- No existe script de lint configurado en estos dos paquetes. `web` no tiene suite propia configurada; no se cuenta su mensaje vacío como prueba.
- `test/ux-audit.test.ts`: frontera Madrid, tarjetas activas/caducadas, etiquetas, navegación, integridad del texto de carrito, campaña por HTTP y permisos/propiedad de presupuestos. Pool simulado y autenticación ficticia; middleware de roles y rutas reales. No sustituye una integración PostgreSQL/JWT end-to-end.
- `scripts/ux-audit.browser.js`: Playwright sobre build local. 40 combinaciones ruta/anchura sin overflow; tres roles; carrito añadido/cantidad/retirada para cliente y distribuidor; guía, menú/teclado, títulos, filtros y carrera de respuestas. Resultado `passed`, 117 peticiones API simuladas, una guía simulada, cero errores JavaScript durante el recorrido.
- El harness aborta destinos externos y sirve el hostname público desde la preview loopback. No usa servidor público ni datos reales. La apertura inicial de preview sin fixtures obtiene un error de API no disponible; no forma parte del recorrido instrumentado, que instala fixtures antes de navegar.
- `node --check scripts/ux-audit.browser.js`, `git diff --check` y revisión de secretos: correctos. Sin dependencias nuevas ni cambios en lockfiles, migraciones, Horneo, MQTT, gateways o alarmas.
- Capturas locales inspeccionadas: `output/playwright/auditoria-guia-390.png` y `output/playwright/auditoria-admin-390.png`. Artefactos regenerables fuera del commit.

Reproducción del navegador desde raíz del repositorio: después del build, ejecutar preview de Vite en `127.0.0.1:4173` desde `horizonst-store/web`; abrir una sesión nueva con `npx --yes --package @playwright/cli playwright-cli -s=store-audit open about:blank`; ejecutar `run-code --filename horizonst-store/scripts/ux-audit.browser.js` con el mismo prefijo de sesión y cerrarla al finalizar. No abrir previamente páginas de producción ni reutilizar sesiones con rutas/listeners antiguos.

## Preguntas concretas pendientes

1. H02: ¿el servicio anual se renueva automáticamente y qué implantación, mantenimiento o soporte están incluidos, aparte del hardware comprado?
2. H07: ¿qué ficha autorizada podemos citar para requisitos concretos de energía, conectividad y evaluación de cobertura?
3. H10: ¿Enterprise es una licencia completa independiente o una ampliación que obliga a adquirir Professional? ¿Qué condiciones contractuales prueban esa relación?
4. H11: ¿negocio ratifica «Solicitud recibida» (`submitted`), «En revisión» y «Propuesta enviada» (`sent`) como términos definitivos?
5. H14: ¿qué resultado real de Horneo está documentado y autorizado para publicación? ¿Se ratifican los datos de superficie y trabajadores ya publicados?

## Validación posterior en staging (pendiente, no realizada)

No hay nuevas variables, migraciones ni precios que configurar. Requiere actualizar conjuntamente backend y frontend de Store mediante un despliegue autorizado aparte; cambiar solo frontend dejaría incoherente la fecha en servidor/correos.

1. Usar cuentas ficticias independientes cliente/distribuidor/admin y entorno de correo de pruebas, nunca direcciones ni credenciales reales.
2. Comprobar rutas de ambos hostnames, catálogo API real y coherencia IVA/subtotal/descuento/total. Verificar conservación del 5 % y valores del catálogo sin modificar datos comerciales.
3. Confirmar navegación y denegación de rutas ajenas por rol, y 404 de presupuesto de otro usuario. Probar borrador y pendientes administrativos.
4. Repetir los cinco tamaños y capturas; teclado, privacidad normal/visitado/foco, CTA guía y limpieza de filtros. El harness local no acredita configuración TLS/proxy/dominio desplegada.
5. Probar vencimiento con reloj inyectado en test aislado, no cambiando reloj del servidor compartido. Confirmar 410 después del corte y alternativa comercial, incluido un enlace abierto antes del vencimiento.
6. Correos/guía, confirmación comercial y generación de presupuesto solo contra transporte/almacenamiento ficticios o con autorización explícita de pruebas: aquí no se efectuaron envíos reales.

No se demuestra mejora de conversión ni se cierra un hallazgo parcial por cambiar texto. La aceptación comercial y la validación end-to-end en staging siguen pendientes.
