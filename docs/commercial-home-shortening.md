# Portada abreviada — traslado de detalle a Cómo funciona

Fecha: 2026-11-03. Rama local: `codex/commercial-v3-collaborations`. Base: `ae33b10b1cf566a0df3e7d867f2f19969e6f9f15`. Propuesta local, sin push ni despliegue.

## Decisión confirmada y correspondencia visible

La numeración inicial podía incluir las franjas de imágenes. Se preguntó por los títulos exactos y el usuario confirmó estos cuatro bloques. No se aplicó la numeración de componentes ni la del documento del copywriter:

| Número confirmado | Título | Destino |
| --- | --- | --- |
| 2 | ¿Cómo seguís hoy los tiempos dentro de la cámara? | Cómo funciona, tras la entrada |
| 3 | Del control diario a los registros que necesitas | Cómo funciona, tras situaciones |
| 4 | Un dispositivo personal, un control automático | Cómo funciona, conservando #funcionamiento |
| 6 | Dedica menos esfuerzo a reunir la información | Cómo funciona, tras Qué se instala y antes de FAQ |

Las ilustraciones de alimentación/almacenamiento acompañan al bloque 2 y la de supervisión al bloque 3. No se han sustituido imágenes ni generado otras. El esquema conceptual del bloque 4 se separa y queda en Inicio, con el enlace existente a la explicación. Se conserva además el esquema que ya estaba en Cómo funciona.

Inicio queda: primera pantalla → esquema conceptual → Caso de éxito/Horneo → Colaboraciones → cierre de contacto. No se añaden textos para compensar el detalle trasladado. Primera pantalla, Horneo, Colaboraciones y cierre conservan su contenido y CTA.

En Cómo funciona, el bloque de cuatro pasos trasladado reemplaza la explicación inicial equivalente para no repetirla. Se conservan instalación, las 12 FAQ y cierre. No se modifica el archivo de copy, las rutas, SEO, navegación, formulario, Empresa opcional, catálogo, precios, campaña, impuestos, condiciones ni permisos.

## Comprobaciones

- Node 22.23.4 / Windows, workspace aislado `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-hO3p8F`.
- Evidencia de suite: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-L1GMbP/summary.json`.
- Typecheck backend, build backend y build frontend: código 0. Typecheck frontend adicional `tsc --noEmit -p web/tsconfig.json` en ese workspace: código 0.
- **51 módulos Store aprobados**, 0 módulos fallidos/omitidos. Incluye nueva regresión de traslado, preservación literal de párrafos, bloques retenidos y ausencia de duplicación del resumen.
- Lifecycle: **24/24**, 0 fallidas y 0 omitidas. SQL y transportes ficticios; no es nueva evidencia Docker/Linux.
- Navegador Chrome local con todos los dominios interceptados: **8 comprobaciones previas y 30 posteriores**, 0 fallidas en las ejecuciones completas. Cero POST/intentos de escritura y cero excepciones JS. Se comprueban los cuatro títulos, ausencia en Inicio, presencia única en Cómo funciona, esquema y ancla únicos en cada página, CTA, FAQ por teclado y ausencia de imágenes rotas/overflow en 390 y 1440 px.
- Primer guion de captura terminó antes de esperar la navegación del CTA; se comprobó que la URL y ancla eran correctas y se añadió espera explícita de URL/elemento, no un sleep. `before.log` se conserva; `before-2.log` completa las ocho comprobaciones.
- El HTML de la primera pantalla de Inicio coincide antes/después en los dos tamaños. SSR exige contenido idéntico para Horneo, Colaboraciones y cierre. Se inspeccionaron las capturas posteriores de ambas páginas en escritorio y móvil; no se afirma una revisión manual de cada píxel. También se capturó el ancla en móvil (`anchor-mobile.png`): el inicio del bloque quedaba visible por debajo de la navegación sticky en esa comprobación.
- No se han recontado las 102 comprobaciones de la revisión anterior como nuevas. Los otros recorridos conservan sus regresiones de la suite; no se han contactado servicios reales.

## Medición antes/después

Mismo navegador, viewport, fuentes, assets y formularios sin actividad. Medida DOM de scrollHeight tras cargar/decodificar imágenes. FAQ cerradas durante las capturas. Las cifras describen solo este conjunto medido, no una mejora de conversión demostrada.

| Anchura | Página | Antes, px | Después, px |
| --- | --- | ---: | ---: |
| 390 | Inicio | 8607 | 4009 |
| 1440 | Inicio | 5779 | 2519 |
| 390 | Cómo funciona | 4402 | 8473 |
| 1440 | Cómo funciona | 3303 | 6299 |

Inicio se reduce un 53,4 % y un 56,4 % respectivamente. Cómo funciona recibe el detalle deliberadamente y conserva el acceso directo desde el CTA a #funcionamiento.

Evidencia propia, sin sobrescribir la revisión inicial: `output/playwright/home-shortening-20261103/`.

- [Inicio escritorio](../output/playwright/home-shortening-20261103/after-inicio-1440.png) · [Inicio móvil](../output/playwright/home-shortening-20261103/after-inicio-390.png).
- [Cómo funciona escritorio](../output/playwright/home-shortening-20261103/after-funcionamiento-1440.png) · [Cómo funciona móvil](../output/playwright/home-shortening-20261103/after-funcionamiento-390.png).
- Comparación: `before-2.log` y `after.log`; capturas `before-*` y `after-*`. Resumen versionado: `commercial-home-shortening-results.json`.

## Reproducción y límites

Ejecutar `infrastructure/testing/store-lifecycle-suites.cjs` con Node 22.23.4. Usar el workspace temporal que imprime, no el dist no versionado del checkout. Servir ese `web/dist` con `infrastructure/testing/commercial-preview.cjs` (solo GET y loopback). Abrir una sesión local nueva sin cierre automático y ejecutar `run-code --filename infrastructure/testing/commercial-home-short.pw.js`; crear una carpeta de evidencia propia y ajustar su destino para no sobrescribir capturas previas. El guion requiere empezar en loopback, intercepta todo y no usa backend real.

El navegador permanece abierto. No hay migraciones ni cambios de API/runtime. Backend externo, Horneo y hardware no se han modificado ni contactado. Revertir únicamente el commit de este traslado en una rama local devuelve la distribución anterior, sin tocar el copy ni datos; no se ha ejecutado ese retorno.

Siguen pendientes aprobación final para publicar y validación autorizada del correo real. No se afirman pruebas en Safari/Firefox, lectores de pantalla o móviles físicos. Los cambios y archivos preexistentes se conservan.
