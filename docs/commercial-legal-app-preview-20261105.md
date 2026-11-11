# Propuesta comercial: normativa y vistas de la aplicación

Revisión de fuentes: 5 de noviembre de 2026. Propuesta local pendiente de revisión; no autoriza publicación ni despliegue. Base: `3de3da7417803afec10ce95398de46b904409adc` en `codex/commercial-v3-collaborations`.

## Normativa

- [Real Decreto 1561/1995, artículo 31](https://www.boe.es/buscar/act.php?id=BOE-A-1995-21346#a31): régimen de permanencia y descansos según temperatura y condiciones aplicables.
- [Ley 31/1995, artículos 14](https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292#a14) y [16](https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292#a16): protección y gestión preventiva.
- [LISOS artículo 7](https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a7), [artículo 12](https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a12), [artículo 13](https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a13) y [artículo 40](https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a40): categorías y rangos generales de sanciones. La tipificación y cuantía dependen de los hechos; no se afirman acumulación ni sanción por falta del producto. El texto consolidado del BOE es informativo.

Inicio incorpora una mención breve y enlace; el detalle se encuentra en `/info-faqs#normativa`. La contratación del producto no se presenta como obligatoria ni garantía de cumplimiento. Los tiempos que aparecen en capturas son una configuración concreta, no reglas universales.

## Capturas autorizadas y protección

Se inspeccionaron las seis imágenes proporcionadas. No se incluyeron `alertas.png` ni `asignaciones.png`, porque contienen restos de identificadores y no son necesarias para las cuatro vistas prioritarias. Los archivos originales no se modificaron ni se copiaron al bundle público.

En `horizonst-store/web/public/images/panel-publico/` hay cuatro derivados PNG aplanados, generados mediante bitmaps nuevos sin copiar metadatos:

- `resumen.png`: recorte de `dashboard.png` que conserva indicadores y excluye tablas identificativas.
- `presencia.png`: `workers.png` con las zonas de nombres e identificadores cubiertas con rectángulos blancos opacos. Conserva el contexto de las barras; el pie aclara que seis horas es una referencia visual que no genera bloqueos ni alarmas.
- `alarmas.png`: derivado de `alarmas.png`, inspeccionado sin nombres ni identificadores visibles.
- `informes.png`: recorte de `informes.png` que excluye la cabecera; muestra opciones sin afirmar haber ejecutado descargas.

Se inspeccionaron los derivados completos tras la generación. El borrado de píxeles en las zonas cubiertas es irreversible en los derivados; no se utiliza CSS como anonimización. No se transcriben identificadores. Antes de publicar sigue siendo necesaria una revisión humana de privacidad y autorización operativa, incluida la consideración del contexto y fechas que permanecen visibles.

## Validación

Node 22.23.4, copia aislada y dependencias existentes. `node infrastructure/testing/store-lifecycle-suites.cjs`: typecheck backend, build backend y frontend y suite de 52 módulos correctos; 24 pruebas de lifecycle aprobadas, 0 fallidas y 0 omitidas. Evidencia: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-k0ECGW/summary.json` y logs asociados. El typecheck frontend se ejecutó por separado.

Navegador local con dominios interceptados y sin API real: 79 comprobaciones aprobadas; ancla, enlaces, selector, ampliación y desplazamiento por teclado a 390 px, carga de las cuatro imágenes, 320/390/768/1440 px, estados de error simulados, 0 escrituras y 0 excepciones JavaScript. En intentos previos se corrigieron una espera de imagen diferida del test y el uso de `End` por `ArrowRight` para el desplazamiento horizontal; no se ocultan esos fallos como aprobados. Las capturas finales se encuentran en `output/playwright/legal-panel-v2-20261105/`.

La imagen del panel es estática y sus botones no son controles; no se han probado exportaciones, conexión en vivo ni el funcionamiento físico de alarmas. Las capturas de navegador no acreditan compatibilidad universal ni revisión legal profesional. Sin correo, MQTT, hardware, bases compartidas ni servicios reales. No cerrar el navegador integrado ni sus pestañas.
