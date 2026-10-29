# Pulido de Planes — planes-polish-20261029

Fecha: 2026-10-29. Rama existente: `codex/commercial-four-page-review`.
Base comprobada: `06b67a65ac01957657a18214816dab3983875cd3`, árbol versionado limpio antes de editar. No se cambió de base ni se fusionaron ramas. Archivos no versionados preexistentes conservados.

Estado: implementado y comprobado **para revisión local**, sin publicación, push, despliegue ni acceso a Atlas/APIs reales. Los estados HTTP, precios y campañas de navegador son ficticios; no acreditan condiciones desplegadas ni recepción de correo.

## Cambio acotado

- Aplicación: se eliminaron las tres tarjetas duplicadas. Cada opción muestra una sola vez nombre, precio anual, capacidad y acción en la comparación. CTA por código con campaña activa y enlace de consulta cuando termina; mismas reglas de precio/Contactar/datos desconocidos. Sin distintivo comercial inventado ni descripciones funcionales arbitrarias.
- Condiciones: aplicación/actualizaciones/soporte básico, exclusiones y renovación permanecen visibles. El texto completo de cada entrada de `annualServiceTerms` y `enterpriseTerms` aparece exactamente una vez; los detalles de soporte y Enterprise se abren en `Detalle del servicio y condiciones`. La independencia de Enterprise también tiene una aclaración breve visible. No se modifican las constantes compartidas.
- Hardware: tres details nativos con nombre y cobertura orientativa visibles, lista íntegra y enlace B2B al abrir. Se explica una sola vez pago único frente a cuota anual y se mantiene advertencia visible sobre estudio/cobertura. Los nombres no se presentan como contrato de equivalencia con la capacidad dinámica de la aplicación.
- Fecha: se humaniza solo el copy de la página; sigue usando `prereservationEndLabel(campaign.endAt)` y la zona Europe/Madrid existente. No se cambia el instante final, descuento ni backend de campaña.
- Refresco: keys estables y details nativos conservan DOM, apertura y foco. Un fallo inicial sin catálogo conserva el error; un fallo transitorio con datos anteriores muestra aviso explícito sin desmontar decisiones/detalles. Mientras persista ese fallo, botones de prerreserva conservan el foco con aria-disabled y su handler no abre otra oferta; recuperación los habilita. No cambia envío, token, consentimiento ni validación de backend.
- CSS nuevo solo bajo `.lp-plans-page`. Inicio, Cómo funciona, Contacto y funciones compartidas no cambian. No hay imágenes nuevas ni fotos de dispositivos.

## Medición antes/después

Se tomaron capturas propias ANTES de editar sobre la compilación previa y DESPUÉS sobre las fuentes finales. Misma Chrome local, escala CSS 1, scrollbars, viewport y catálogo sintético: cuotas 615/825/1250 €, capacidades 10/20/40 y 5/10/20, campaña activa. No son precios consultados a producción. Se mide scrollHeight del documento, con desplegables inicialmente cerrados; no se compara un antes abierto con un después cerrado. El contenido de los detalles permanece disponible y fue desplegado y comprobado.

| Viewport | Antes, px | Después, px | Reducción |
| --- | ---: | ---: | ---: |
| 320 × 844 | 6036 | 2896 | 52,0 % |
| 390 × 844 | 5130 | 2545 | 50,4 % |
| 768 × 1000 | 3815 | 1581 | 58,6 % |
| 1440 × 1000 | 2392 | 1450 | 39,4 % |

Las capturas PNG pueden redondear un píxel respecto a la medida DOM. Estas reducciones se limitan al conjunto y entorno medidos; no son garantía universal de altura con otros textos/datos o tamaños. Texto base legible conservado; no se redujo la escala del navegador para obtenerlas. CTA de al menos 44 px y detalle de capacidad de 0,9 rem.

| Tamaño | Antes | Después final |
| --- | --- | --- |
| Móvil 390 | [Captura](../output/playwright/plans-polish-20261029/before-390.png) | [Captura](../output/playwright/plans-polish-20261029/after-final-390.png) |
| Escritorio 1440 | [Captura](../output/playwright/plans-polish-20261029/before-1440.png) | [Captura](../output/playwright/plans-polish-20261029/after-final-1440.png) |
| Móvil 320 | [Captura](../output/playwright/plans-polish-20261029/before-320.png) | [Captura](../output/playwright/plans-polish-20261029/after-final-320.png) |
| Tablet 768 | [Captura](../output/playwright/plans-polish-20261029/before-768.png) | [Captura](../output/playwright/plans-polish-20261029/after-final-768.png) |

[Detalle abierto, escritorio](../output/playwright/plans-polish-20261029/after-expanded-1440.png). También se conservan capturas intermedias after-* y todos los artefactos de la entrega anterior en su directorio original, sin sobrescribirlos.

## Criterios y evidencia

| ID | Estado | Evidencia y alcance |
| --- | --- | --- |
| PL-001 | Acreditado localmente | SSR: precio una sola vez y tres opciones sin lp-plan-card. Navegador: tres acciones y códigos starter/professional/enterprise correctos. Capturas alineadas/compactas. |
| PL-002 | Acreditado localmente | Reglas de precios existentes intactas; tests de precio dinámico, valores desconocidos, planes inactivos, catálogo parcial, carga/error/vacío/recuperación. Navegador añade fallo transitorio explícito y bloqueo/recuperación de nuevas acciones. |
| PL-003 | Acreditado localmente | Test exige las cuatro constantes anuales y Enterprise completas exactamente una vez. Decisivos antes de details; apertura nativa por Enter y texto completo en DOM. No se limita mediante fetch ni búsqueda personalizada. |
| PL-004 | Acreditado localmente | Tres opciones inicialmente cerradas; apertura de las tres, cuatro líneas de equipos por opción y cantidades originales 10/20/40 de dispositivos. Enlaces B2B comprobados para producción y staging simulados; aviso visible sin garantía de cobertura. |
| PL-005 | Acreditado en escenarios probados | Reloj de Playwright adelanta el setInterval real de 30000 ms: precio cambia, mismo nodo/keys y foco; details permanecen abiertos. Modal, email/privacidad, Escape y foco devuelto. Error transitorio también conserva apertura/foco, recuperación habilita acciones. Teclado abre/cierra details. Seis PNG de las otras tres páginas son idénticos SHA-256 a los de la entrega previa. |
| PL-006 | Acreditado localmente | before.log / after-final.log y ocho capturas antes/después a cuatro anchuras. Sin scroll horizontal; revisión visual de las cuatro capturas finales. Tabla de medidas anterior. |
| PL-007 | Acreditado por diff/tests/mocks | No cambia backend, precios, impuestos, descuento, campaña ni payloads de formulario. Contratos de precio/campaña existentes pasan. Callback de cada CTA probado; cero POST en el recorrido nuevo de navegador. No acredita operación comercial real. |
| PL-008 | Acreditado para revisión local | Informe, tabla de criterios, fuentes finales con hash, logs y capturas vinculados. Se distinguen pruebas sintéticas de las validaciones reales pendientes; no se declara producción validada. |

Nota sobre alcance del foco: se prueba refresco con ofertas vigentes, cambio de precio y fallo transitorio; no se promete conservar foco en un control de una oferta que el servidor retire. Vacío y catálogo parcial se comprueban como estados seguros, sin reconstruir ofertas suprimidas. No hay lectores de pantalla, dispositivos físicos, Safari/Firefox ni Ctrl+F del navegador acreditados aquí; se usan details/summary nativos y contenido completo local, sin filtro personalizado que impida buscarlo.

## Pruebas y procedencia

- Node **22.23.4 / Windows**, harness offline `store-lifecycle-suites.cjs`: typecheck y builds Store backend/frontend, todos código 0; **48 módulos aprobados, 0 fallidos, 0 omitidos**. Lifecycle **24/24**, 0 omitidas (8 × 3 procesos). Las cantidades de módulos no son número de aserciones. Backend externo/Horneo no cambiaron y no se reejecutaron.
- Evidencia final: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-VJ7vbC/summary.json`, logs vecinos; workspace `horizonst-store-lifecycle-NdOCPV`. Logs SMTP de error forman parte de escenarios negativos simulados, no envíos reales.
- Browser nuevo: **42/42** comprobaciones; `output/playwright/plans-polish-20261029/after-final.log`. Medición previa **4/4** sin overflow, `before.log`. Las 87 comprobaciones de la entrega anterior no se cuentan como nuevas. API interceptada, archivo estático desde loopback, cero POST. Reloj simulado no demuestra disponibilidad de backend ni latencias reales.
- Hash de `web/src/pages/PublicLanding.tsx` en checkout y copia validada: `4e798571610b6b45fe82bca60d9096e6d33764a32450ba9342541ec2fc8afa6d`.
- Hash de `web/src/commercial-review.css` en ambas: `3ba2267cda58916f6e5193c3af430b27233e3d8e686677c9c37e7af0c66fb10b`.
- La compilación servida se copió exclusivamente del workspace validado al preview temporal propio. Los hash son de los bytes de las fuentes validadas, no una suposición sobre staging. Capturas de regresión Inicio/Cómo funciona/Contacto (dos tamaños cada una): **6/6 byte a byte idénticas** a `commercial-review-20261029`; no se cambió su contenido.
- Primer intento `horizonst-store-lifecycle-evidence-NrK278` conservado: el contrato estático de precios rechazó un condicional por código Enterprise que solo mostraba una aclaración. No se debilitó el test: la aclaración se trasladó a condiciones comunes, sin regla específica sobre la oferta. `...-vx50On` pasó después; se revalidó `...-VJ7vbC` tras añadir el manejo explícito del error de refresco.

## Reproducción

1. Ejecutar con Node 22.23.4: `node infrastructure/testing/store-lifecycle-suites.cjs` (workspace temporal y datos ficticios; sin .env).
2. Servir el `web/dist` impreso por el runner con `node infrastructure/testing/commercial-preview.cjs <ruta>`; solo GET/loopback, sin backend ni proxy.
3. Crear un directorio propio `output/playwright/plans-polish-20261029`. Abrir una pestaña nueva sobre ese loopback en la sesión local Playwright (no cerrar las existentes). Ejecutar `npx --offline --no-install --package @playwright/cli playwright-cli -s=<sesión> run-code --filename infrastructure/testing/commercial-plans-polish.pw.js`.
4. El guion toma origin de la pestaña loopback e intercepta todas las peticiones. Los nombres horizonst.es/com.es son **simulados**, nunca destino de red real. Obtiene estáticos solo del preview y aborta otros hosts. Su reloj se instala una sola vez por pestaña: repetir en pestaña nueva, sin cerrar la anterior. No ejecutar el guion contra APIs reales.
5. Para repetir el ANTES, compilar la base 06b67a6 en una copia aislada sin secretos; el guion reconoce la presencia del diseño antiguo y solo toma medidas/capturas, sin aplicar los criterios del diseño nuevo. No resetear el checkout actual ni sobrescribir evidencia previa.

## Diff y pendientes

Archivos: `PublicLanding.tsx`, `commercial-review.css`, ajuste de `commercial-review.test.ts`, nuevo `commercial-plans-polish.test.ts`, guion `infrastructure/testing/commercial-plans-polish.pw.js` y este informe. No hay cambios de dependencias, servicios, backend, datos ni condiciones comerciales.

Pendiente fuera de alcance: validación de negocio y pruebas en otros navegadores/tecnologías de asistencia; no se han realizado envíos end-to-end. Las condiciones comerciales sin confirmar, recursos del diseñador y materiales de Horneo siguen pendientes según el informe anterior, sin bloquear este pulido local. No se han contactado otros chats para entregar el resultado. Navegador y pestañas quedan abiertos. Retorno: revertir únicamente el commit de este pulido sobre una rama de revisión; sin migraciones o reconciliaciones de datos.
