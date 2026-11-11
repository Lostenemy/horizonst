# Ajustes de las capturas — 2026-11-04

Rama local: `codex/commercial-v3-collaborations`, base `03e9366fba26f240b05e50ea27ce23112fbd329e`. Sin push ni despliegue.

## Cambios

- Inicio: se elimina la línea pequeña y se incorpora el nombre al titular: «Horizon Smartracking controla automáticamente la permanencia y los descansos en tus cámaras congeladoras». Conserva ventajas, botones, destinos y esquema original.
- Cómo funciona: variante compacta del esquema en escritorio y móvil, sin la franja SOS. Los cuatro pasos y su identificación conceptual se mantienen, al igual que los bloques separados de aviso preventivo y SOS situados debajo. No se oculta contenido recortándolo por CSS: los nuevos SVG tienen dimensiones y descripción propias. Los originales se conservan.
- Qué se instala: tres elementos con nombre destacado y explicación directa. PoE se explica como alimentación mediante el cable de red. Se conserva la antena por perforación preparada y la revisión de electricidad, Internet, cobertura y organización, sin nuevas garantías técnicas.
- No se alteran logotipo, cabecera, pie, precios, campaña, contratos, áreas privadas, MQTT ni comportamiento operativo. No se generan ni retocan fotografías.

## Validación local

Node 22.23.4, Windows, copia temporal sin servicios reales. Comando desde la raíz: `node infrastructure/testing/store-lifecycle-suites.cjs`.

- Backend Store: typecheck y build correctos; frontend: build y typecheck adicional correctos.
- Suite Store: 52 módulos aprobados, 0 fallidos; lifecycle: 24 pruebas aprobadas, 0 fallidas, 0 omitidas.
- Evidencias de la ejecución final: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-htSnau/summary.json` y logs vecinos. Copia: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-J7Tecp`.
- Primer intento conservado en `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-H34s5y`: falló un contrato que exigía literalmente «requiere alimentación…». Se actualizó a «Se necesita alimentación…», manteniendo la obligación de electricidad e Internet; la suite completa posterior pasa.
- Navegador Chromium con todos los dominios interceptados hacia la copia estática local: 71 comprobaciones aprobadas, 0 fallidas, 0 escrituras y 0 excepciones JavaScript. Anchuras 320, 390, 768 y 1440 px; titular, esquema compacto, imágenes, ancla, FAQ, enlaces por entorno y fallos de imágenes simulados.
- Revisión visual de cuatro capturas: Inicio y Cómo funciona, escritorio y móvil. No se observaron desbordamientos ni imágenes vacías en estos casos. No es evidencia de despliegue ni de todos los navegadores.
- `git diff --check`, sintaxis del guion de navegador y control de secretos del diff: correctos.

Capturas locales (no publicadas):

- `output/playwright/photo-review-20261104/local-inicio-1440.png`
- `output/playwright/photo-review-20261104/local-inicio-390.png`
- `output/playwright/photo-review-20261104/local-funcionamiento-1440.png`
- `output/playwright/photo-review-20261104/local-funcionamiento-390.png`

Reproducción visual: servir el `web/dist` de la copia impresa por el runner mediante `commercial-preview.cjs`, abrir una sesión CLI en loopback y ejecutar `run-code --filename infrastructure/testing/commercial-smartracking.pw.js`. Los hosts mostrados en el navegador son simulados; no navegar a producción para validar esta propuesta. Conservar las pestañas abiertas. Pendiente: revisión del usuario y autorización de publicación, no solicitada en esta entrega.
