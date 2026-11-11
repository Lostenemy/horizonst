# HTML comercial rastreable — propuesta local

Fecha de revisión: 11 de noviembre de 2026. Rama `codex/commercial-seo-prerender`, base `a6164a649e519c780275b6364a06a45cfd37edaa`. No se ha modificado configuración activa, DNS ni desplegado. El hash desplegado actualmente no se ha podido determinar solo mediante HTTP público.

## Diagnóstico y decisión

El 11 de noviembre, GET público a `horizonst.es/`, `horizonst.com.es/`, `horizonst.es/info-faqs`, `/robots.txt` y `/sitemap.xml` devolvió 200, `text/html` y 360 bytes. En el repositorio examinado, Vite crea un shell vacío y `server.ts` entrega `index.html` como fallback. Esto explica el comportamiento observado si ese código corresponde al despliegue, pero no identifica por sí solo el artefacto desplegado ni demuestra bloqueo o desindexación en Google.

El usuario confirmó `https://horizonst.es` como dominio preferente y `.com.es` como staging. La petición pública `https://www.horizonst.es/info-faqs?seo=1` devolvió un **301** con `Location: https://horizonst.es/info-faqs?seo=1`; el destino respondió 200. No se alteraron Nginx ni sus reglas. Operaciones debe conservar esa redirección HTTPS de un salto, ruta y consulta al integrar esta propuesta y comprobar también otros alias concretos antes de añadir reglas. No redirigir tienda, API o subdominios por coincidencia parcial.

## Solución

El build ejecuta Vite y genera dos juegos de HTML a partir de los mismos componentes React, sin variar por User-Agent. Las páginas se hidratan con `hydrateRoot`; la tienda conserva su shell. El servidor identifica únicamente los hosts comerciales explícitos, sirve el HTML correspondiente y rechaza rutas y archivos inexistentes con 404. `robots.txt` y `sitemap.xml` tienen rutas y tipos propios. El sitemap contiene únicamente las diez páginas de la tabla y no inventa `lastmod`.

Producción declara canonicals absolutos `https://horizonst.es` y permite el rastreo público; staging declara esos mismos canonicals y añade `noindex, nofollow` en HTML y cabecera. Su robots restringe el rastreo. **Advertencia:** un robots restrictivo puede impedir que un rastreador vea el `noindex`; no es garantía de desindexación ni control de acceso. Si staging necesita confidencialidad o ya estuviera indexado, operaciones debe revisar acceso y estrategia de retirada con el responsable, sin debilitar autenticación.

El HTML de Planes no incorpora precios, campañas ni resultados de API: estos se recuperan en ejecución. Sin JavaScript se ofrece un enlace de consulta y una explicación de que los precios y campañas requieren JavaScript. El HTML se regenera en cada build, por lo que los cambios editoriales requieren nueva compilación; no se incorporan respuestas de API, sesiones, tokens ni condiciones privadas de distribuidores.

Los textos legales existentes identifican al titular del sitio, como ya hacía la web pública: no se afirma ausencia absoluta de datos personales en esas páginas. Las capturas comerciales previamente aprobadas siguen siendo recursos estáticos existentes con datos agregados saneados; no se han añadido datos de trabajadores ni dispositivos en este encargo. La revisión de privacidad de esos recursos sigue siendo una condición previa a su publicación.

## Evidencia por ruta

GET real sin JavaScript contra el servidor aislado tras el build, con `Host: horizonst.es`: todas devolvieron 200, HTML en español, título y descripción, H1, navegación, enlaces y canonical de su propia ruta. Bytes corresponden al HTML recibido, no al peso total de la página.

| Ruta | Bytes | H1 |
| --- | ---: | --- |
| `/` | 5.254 | Horizon Smartracking controla automáticamente la permanencia y los descansos en tus cámaras congeladoras. |
| `/planes` | 5.506 | Un plan según las necesidades de tu instalación |
| `/info-faqs` | 11.605 | Así funciona Horizon Smartracking en tus cámaras congeladoras |
| `/contacto` | 6.175 | Hablemos de tu instalación o de una colaboración |
| `/colaboraciones` | 8.027 | Ayuda a tus clientes a controlar el trabajo en cámaras congeladoras |
| `/colaboraciones/instaladores` | 8.353 | Complementa la instalación de la cámara con el control de permanencia |
| `/colaboraciones/asesorias-prl` | 8.802 | Más información para revisar el trabajo en cámaras congeladoras |
| `/colaboraciones/ingenierias-frio` | 8.668 | Considera el control de permanencia desde el proyecto |
| `/aviso-legal` | 2.250 | Aviso legal |
| `/privacidad` | 2.807 | Política de privacidad |

Los HTML de evidencia están en `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-C9SDfx/horizonst-store/web/dist/prerender/production/` y `.../staging/`; son artefactos temporales de prueba, no documentos desplegados.

## Pruebas

- Node 22.23.4 en Windows, copia temporal y dependencias existentes; sin base de datos, MQTT ni envío de formularios reales. `node infrastructure/testing/store-lifecycle-suites.cjs`: typecheck y builds correctos, 52 módulos Store aprobados y 24/24 pruebas de lifecycle. Evidencia: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-yACvNQ/`.
- En la copia, `node scripts/build-web.mjs` ejecutó el comando real web: typecheck, Vite cliente, Vite SSR y generación de 20 documentos (10 rutas × 2 entornos). Vite informó del aviso de chunk superior a 500 kB; no se instalaron paquetes. `node integration/commercial-seo-http.mjs`, con entorno ficticio y preload de red aislada, verificó ambas variantes, metadatos, enlaces, canonical, `noindex`, robots, sitemap, API y 404. El sitemap se parseó además como XML con 10 URL.
- Chromium local: 20 combinaciones de ruta/anchura (390 y 1440), comparando título, descripción y H1 antes y después de hidratación, canonical, un H1 y ausencia de desbordamiento o errores de hidratación. Se probaron selección del formulario sin envío, parámetro de prerreserva y cierre del diálogo, selector/ampliación, vídeo, anclas y enlace de tienda staging. Se forzó carga y decodificación de imágenes. Sin peticiones de escritura.
- Capturas: `output/playwright/commercial-seo-verified-20261111/home-1440.png`, `home-390.png`, `info-1440.png` e `info-390.png`. HTML inicial y código de prueba: `horizonst-store/integration/commercial-seo-http.mjs`; navegador: `infrastructure/testing/commercial-seo-browser.pw.js`.
- Un primer test de dominio falló porque `fetch` de Node sustituyó la cabecera Host; se cambió el test a `http.get` con Host explícito. Se corrigió también un contrato de rutas heredado para conservar el acceso directo a prerreserva y páginas legales de la SPA. No se sustituyó una respuesta fallida por una aserción más débil.

## Pendiente y retorno

No se ha accedido a Search Console ni se ha solicitado indexación o verificación de propiedad. Tras un despliegue expresamente autorizado, comprobar respuestas sin JavaScript, canonical, robots, sitemap, rutas privadas y archivos inexistentes en cada entorno; realizar Inspección de URL para portada e interior distinguiendo prueba publicada del índice y solo entonces valorar el envío del sitemap con autorización. La validación de Google y la producción permanecen pendientes.

Ensayar primero el build e imagen reales de Linux en staging, conservar artefacto y configuración previos, verificar las reglas efectivas del proxy y la separación de hosts, y disponer de retorno a la imagen anterior. No se han modificado servicios activos ni se han ejecutado migraciones. El resultado local no prueba comportamiento Docker/Linux ni producción.
