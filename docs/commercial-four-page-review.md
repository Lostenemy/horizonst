# Web comercial: revisión local de cuatro páginas

Fecha: 2026-10-29. Rama: `codex/commercial-four-page-review`.
Base: referencia local `origin/main`, commit `1546eb4c0572033411329fa6aa6aed0c0656bb70` (no se realizó fetch ni se afirma comprobar la versión desplegada).
Estado: implementado para revisión local; **no publicado ni desplegado**. Sin acceso a Atlas ni a servicios compartidos.

### Capturas locales (precios ficticios de pruebas)

| Página | Escritorio | Móvil |
| --- | --- | --- |
| Inicio | [Ver](../output/playwright/commercial-review-20261029/desktop-inicio.png) | [Ver](../output/playwright/commercial-review-20261029/mobile-inicio.png) |
| Planes | [Ver](../output/playwright/commercial-review-20261029/desktop-planes.png) | [Ver](../output/playwright/commercial-review-20261029/mobile-planes.png) |
| Cómo funciona | [Ver](../output/playwright/commercial-review-20261029/desktop-funcionamiento.png) | [Ver](../output/playwright/commercial-review-20261029/mobile-funcionamiento.png) |
| Contacto | [Ver](../output/playwright/commercial-review-20261029/desktop-contacto.png) | [Ver](../output/playwright/commercial-review-20261029/mobile-contacto.png) |

También disponibles en ese directorio: desktop-modal, mobile-modal, mobile-contacto-validacion y mobile-contacto-error. Las capturas son artefactos locales nuevos bajo output; no se han añadido binarios al commit ni borrado artefactos previos.

## Repositorio y alcance

Código real: `horizonst-store/web`, React/Vite, no la carpeta de informes ni el fixture sintético de Dark Factory. `App.tsx`, `lib/domains.ts` y `src/resources/store-domains.ts` conectan las cuatro rutas comerciales con los seis dominios explícitos existentes.

Solo cambian presentación comercial, textos, pruebas y herramientas de preview. Permanecen intactos backend, catálogo/precios/impuestos/cálculos, campaña, API, correo, validación y antispam, consentimiento, auth, enlaces por entorno, tokens, tienda autenticada y dispositivos. No se ha enviado ninguna guía, prerreserva ni correo real.

## Cambios por página

| Página | Implementación | Evidencia |
| --- | --- | --- |
| Inicio | Titular y tres puntos solicitados; CTA Contacto y enlace al proceso; guía secundaria. Horneo pasa al segundo bloque con 400 m²/10 trabajadores ya publicados, sin resultados ni citas. Logo limitado a 150 px / 100 px móvil. Menos secciones repetidas; cierre comercial claro. | `PublicLanding.tsx`, capturas inicio y prueba SSR de orden/contenido. |
| Planes | Nuevo título. Comparación compacta capacidad/cuota antes de tarjetas, adaptada a móvil. Cuota anual y exclusiones junto al precio; Incluye/No incluye y renovación con las constantes ya existentes. Hardware separado, cantidades y cobertura orientativa conservadas. | Capturas planes; tests de igual precio de API en resumen y tarjeta, valores cambiantes y plan ausente. |
| Cómo funciona | Proceso antes de beneficios; panel/dispositivo/infraestructura en texto, sin diseño del equipo. Diez FAQ nativas con respuesta directa y detalle verificado. Se conserva responsabilidad del centro y necesidad de electricidad/Internet. | Capturas funcionamiento, SSR y pruebas Enter/Espacio/ratón. |
| Contacto | Título, introducción y ayuda Mensaje exactos; sin nuevos campos. Ayudas normales sin mayúsculas heredadas; etiquetas, límites, errores, foco, bloqueo de doble envío y retención de datos intactos. | Capturas contacto/validación/error; estados y flujo de foco simulados en navegador. |

Navegación: página actual diferenciada visualmente y con aria-current; enlaces legales y de tienda por entorno preservados. Espaciado y contraste nuevos están acotados a `.public-landing` en `commercial-review.css`, sin rediseñar la tienda autenticada. Se evita dar al catálogo libertad para introducir supuestas diferencias funcionales en las descripciones comerciales: capacidades y precios siguen leyendo la API y las descripciones usan copy de capacidad revisado.

Prerreserva: cierre blanco sobre azul oscuro con borde turquesa y área 44×44; privacidad alineada con texto. Se mantienen Escape, trampa de Tab y devolución del foco al disparador. `useCallback` estabiliza el cierre para que editar campos no vuelva a ejecutar el efecto de foco sobre email. Antes del formulario solo se explica el 5 %, fecha y acceso al desglose ya implementados. No se cambia el envío, almacenamiento de acceso ni confirmación posterior.

## Imágenes y material pendiente

Se retiraron de estas cuatro páginas todas las referencias a las ilustraciones de campaña con dispositivos reconocibles. Se conserva únicamente el logo local de Horneo, inspeccionado visualmente. Los assets anteriores NO se borraron; ya no los solicita esta presentación. La composición neutra de Inicio está hecha en HTML/CSS, explica el recorrido y declara que es un esquema, no una foto del producto o del cliente. No usa recursos externos ni imágenes generadas nuevas.

`HorneoCase` dispone de un slot opcional `approvedMedia`; no se aporta contenido ni se renderiza contenedor sin contenido. Para usarlo faltan testimonio autorizado, texto/aprobación de atribución y un posible vídeo real con permisos. No hay citas, vídeo ficticio, aviso de próxima publicación ni huecos públicos pendientes.

No se recibieron recursos nuevos revisados del diseñador en este encargo. Pendientes: propuestas sin diseño identificable de hardware, derechos/procedencia, contexto y revisión antes de incorporarlos. El esquema neutro actual es una composición terminada, no un contenedor vacío.

## Comprobaciones ejecutadas

Entorno: Windows, Node **22.23.4**, Chrome local a través de Playwright CLI. No acredita Safari/Firefox, dispositivos físicos ni lectores de pantalla.

- Runner offline existente: typecheck y builds backend/frontend de Store, código 0. Suite: **47 módulos aprobados, 0 fallidos, 0 omitidos**; no son 47 aserciones individuales. Contiene regresiones de Contacto y validación de precios/negocio con transporte/DB simulados. Lifecycle: **24/24** (8 pruebas × 3 procesos), 0 omitidas. Backend/Horneo externos a Store no se modifican ni se declaran revalidados aquí.
- Navegador: **87/87** verificaciones con APIs interceptadas, incluidas 20 combinaciones página/anchura: 320, 390, 768, 1366 y 1440 px. Sin desbordamiento horizontal de documento, con página actual correcta e imagen sin rotura. El diagnóstico enumera el honeypot fuera de pantalla, intencional y preservado; no es contenido visible recortado.
- Se simulan cuatro hosts comerciales (producción/staging y www), los dos de tienda, enlaces de Contacto y destino B2B; la política de dominios no se modifica. Privacidad permanece en staging al navegar desde allí.
- FAQ abre por ratón, cierra por Enter y abre por Espacio. Ancla de funcionamiento navegable sin quedar tras la barra. Modal probado a 390/1440: foco inicial, estabilidad al editar, ciclo Tab, Escape, botón Cerrar, foco devuelto, colores y dimensiones; formulario inválido no hace POST.
- Contacto: validación local sin POST, foco en Nombre, carga con campos/botón bloqueados, doble clic sin duplicar, error conservando datos y éxito simulado. **Los dos POST se resuelven dentro del navegador**, sin llegar al servidor de preview ni a un backend. Guía inválida no envía; no se realizan POST de guía ni prerreserva.
- Catálogo: estados de carga, error, vacío y recuperación con respuestas ficticias. Sin errores JavaScript en el recorrido comprobado.
- Capturas: 8 de las cuatro páginas en escritorio/móvil, 2 del modal y 2 de validación/error de Contacto. Revisión visual de cabecera, tipografía, densidad, botones, logo, precios y formularios. Los precios **615/825/1250 € son fixtures**, no una comprobación de precios desplegados.

Evidencia principal de suite: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-0JkeM9/summary.json` y logs vecinos. Workspace aislado `horizonst-store-lifecycle-gxNQyq`. Capturas y evidencia de navegador: `output/playwright/commercial-review-20261029/`, especialmente `browser-checks-final-v2.log`. El registro estructurado `commercial-four-page-review-results.json` conserva resultados, rutas y límites.

Intentos previos conservados: `...-FLvPPP` (ReactDOM no resolvía desde tests del paquete padre), `...-odk8FC` (React requería resolución desde web), `...-mf6rTd` (expectativa textual antigua «Planes de hardware»). Se corrigió la resolución de dependencias de prueba con createRequire desde `web/package.json`, sin instalar paquetes, y se actualizó el contrato de texto al nuevo encargo. `...-UbViv4` y `...-2RVVEQ` también pasaron; la última evidencia corresponde a las fuentes finales. CLI por argumento largo falló antes de ejecutar y se sustituyó por su opción `--filename`. No se ocultan esos fallos ni se atribuyen al runtime de producción.

## Reproducción segura

No ejecutar el frontend contra APIs reales para esta revisión.

```powershell
# Node 22.23.4 local. Crea workspace y evidencia propios, sin .env.
& '<NODE_22.23.4>/node.exe' infrastructure/testing/store-lifecycle-suites.cjs

# Usar web/dist del workspace temporal impreso por el runner.
& '<NODE_22.23.4>/node.exe' infrastructure/testing/commercial-preview.cjs '<WORKSPACE>/horizonst-store/web/dist'
```

El servidor es de solo lectura, loopback con puerto efímero; no tiene backend ni proxy. Rechaza POST y /api. No publica puertos Docker ni cambia servicios. En otra terminal, con Playwright CLI ya instalado:

```powershell
New-Item -ItemType Directory -Force output/playwright/commercial-review-20261029
npx --offline --no-install --package @playwright/cli playwright-cli -s=horizonst-commercial-review open 'http://127.0.0.1:<PUERTO>' --headed --idle-timeout=0
npx --offline --no-install --package @playwright/cli playwright-cli -s=horizonst-commercial-review run-code --filename infrastructure/testing/commercial-review.pw.js
```

El guion exige partir de loopback e intercepta todas las peticiones del navegador a los dominios simulados; obtiene archivos estáticos exclusivamente del preview local y aborta otros destinos. No continúa peticiones a Internet. Para repetir en la misma pestaña, retirar primero las rutas de prueba y navegar al loopback con `run-code`; no cerrar el navegador/pestaña. El preview y la pestaña quedan abiertos para revisión.

## Pendientes e información del equipo

- Envío end-to-end de Contacto, guía y prerreserva: no ejecutado; requiere entorno de pruebas autorizado con destinos/transporte ficticios. No confundir éxito simulado con recepción de correo. El encargo no autoriza activarlo en producción.
- Confirmación comercial de disponibilidad/stock, plazos de implantación, aplicación definitiva del descuento y condiciones vinculantes de reserva. El flujo existente dice que no es compra ni genera cargo; eso no permite inventar stock o garantías de contratación. No se alteró ese flujo ni se publicaron condiciones nuevas por suposición.
- Obras/instalación concreta, alimentación detallada, requisitos específicos de Internet, mantenimiento físico, canales exactos de avisos, funcionamiento sin conexión y disponibilidad del servicio: no hay especificación suficiente para prometerlos. Las FAQ solo afirman lo ya confirmado, dejando evaluación individual donde corresponde.
- Testimonio y vídeo de Horneo: autorización y materiales pendientes. No se incorporó ningún correo privado ni aval institucional.
- Recursos del diseñador y revisión de negocio antes de publicar. El material actual no necesita contenido pendiente para verse completo.
- Pruebas en otros navegadores, lector de pantalla y dispositivos reales pendientes. La inspección visual local no acredita accesibilidad universal ni mejora medida de conversión.

## Retorno

Un único commit local de presentación y pruebas. Revertirlo sobre una rama de revisión devuelve el frontend anterior; no hay migraciones, datos, servicios, permisos o precios que reconciliar. No se ha hecho push, merge, publicación ni despliegue. Los archivos preexistentes, incluidos los no versionados, se conservan.

## Archivos del diff propio

- `horizonst-store/web/src/pages/PublicLanding.tsx`
- `horizonst-store/web/src/pages/PublicContact.tsx`
- `horizonst-store/web/src/main.tsx`
- `horizonst-store/web/src/commercial-review.css`
- `horizonst-store/test/public-landing.test.ts`
- `horizonst-store/test/store-register-and-catalog-form.test.ts`
- `horizonst-store/test/ux-business-decisions.test.ts`
- `horizonst-store/test/commercial-review.test.ts`
- `infrastructure/testing/commercial-preview.cjs`
- `infrastructure/testing/commercial-review.pw.js`
- `docs/commercial-four-page-review.md`
- `docs/commercial-four-page-review-results.json`
