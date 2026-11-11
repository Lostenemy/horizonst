# Smartracking y recorrido comercial — propuesta local

Fecha: 2026-11-04. Rama: `codex/commercial-v3-collaborations`. Base local: `9a3bcef5db63382610c5b16951582203701901d7`. Sin push, merge ni despliegue. No se modifican funcionalidades operativas de presencia, SOS, B5 o alarmas.

## Fuente y revisión de lo publicado

Encargo autorizado: adjunto `62b1753c-f9c0-4c21-b827-2226dac958b9/Texto pegado.txt`. El significado ST → Smartracking y los nuevos textos provienen de esa confirmación del usuario; no son una inferencia sobre GPS, IA o seguimiento fuera de la cámara.

Se consultaron por GET público `https://horizonst.com.es/` y `/info-faqs`. Ambas devolvieron 200 y enlazaron `/assets/index-GFE_LGlJ.js` y `/assets/index-CyBo_TbJ.css`. Se abrió una sesión nueva de Chrome, sin autenticación, bloqueando métodos distintos de GET y hosts distintos del staging autorizado. No se enviaron formularios ni se consultaron bases de datos.

Se comprobó el párrafo original bajo el titular y la distribución de la página larga. En esa revisión las siete cargas de imágenes registradas devolvieron 200, con dimensiones visibles y decodificación correcta. No se reprodujo la leyenda sin imagen; su causa histórica **no está demostrada**. No se atribuye a lazy loading, red, AVIF o CSS sin evidencia. Capturas y registro: `output/playwright/smartracking-20261104/staging-*` y `staging-read.log`. La correspondencia visual no demuestra qué commit está desplegado.

## Implementación

### Inicio

- Se conserva exactamente el H1, los destinos y etiquetas de los dos botones y el resto de la portada abreviada.
- La línea de marca muestra una sola vez: «HorizonST · Smartracking para el control de permanencia en cámaras congeladoras.» Sustituye el antetítulo para no añadir otro bloque.
- El párrafo señalado se sustituye por un `ol` nativo con las tres ventajas literales del encargo. Cada `li` es una fila; numeración decimal, texto con sangría colgante, sin tarjetas ni distribución horizontal. Los botones siguen debajo.
- Se mantiene el esquema conceptual, Caso de éxito/Horneo, Colaboraciones y cierre. No regresan los cuatro bloques extensos trasladados.

### Cómo funciona

1. Cabecera con el H1 conservado, nueva entrada y una única explicación breve de Smartracking.
2. `#funcionamiento` comienza con cuatro pasos numerados. La explicación del supervisor trata los registros; el SOS se diferencia después. Se conserva el esquema como apoyo visual resumido, sin otra cuadrícula de pasos repetidos. La sangría y el orden DOM son 1–4 también cuando hay dos columnas.
3. Dos bloques breves distintos: aviso personal turquesa y SOS al supervisor ámbar. El texto del SOS no atribuye vibración/pitido al supervisor ni lo hace automático por agotar tiempo.
4. Instalación: dispositivo personal, receptor exterior/PoE, antena por perforación preparada y valoración de alimentación, conexión, cobertura y organización. Sin promesas de ausencia de obras o cobertura garantizada.
5. Registros, preparación documental y una frase de reducción de recopilación manual; enlace secundario a Planes. Se elimina la repetición del argumento económico largo.
6. Siete desplegables conservan íntegramente las respuestas de descansos, SOS y procedimiento, límites/BOE, obras, contratación, visita de valoración y servicio de prevención. Las cinco preguntas restantes se integran en pasos, bloques de avisos, instalación y registros; no se borran los datos normativos o contractuales necesarios.
7. Cierre: «Veamos qué necesita tu instalación» y CTA de consulta.

La disposición previa y su guion `commercial-home-short.pw.js` documentan la revisión 9a3bcef. El contrato de la página se ha actualizado expresamente con este nuevo encargo; para validar la versión actual debe usarse `commercial-smartracking.pw.js`, no exigir la repetición de los títulos de los bloques ya condensados.

## Recursos visuales

| Recurso | Decisión | Función |
| --- | --- | --- |
| 01 Inicio, AVIF/WebP escritorio/móvil | Conservado en Inicio | Dispositivo personal visible y receptor exterior reconocible |
| 03 esquema, SVG escritorio/móvil | Conservado en ambas páginas | Recorrido conceptual y separación del SOS; no arquitectura técnica |
| 07 revisión de instalación, AVIF/WebP | Recolocado junto a Qué se instala | Diferenciar dispositivo personal y receptor exterior |
| 04 alimentación y 05 almacenamiento | Retirados de Cómo funciona | Se elimina la repetición contextual; archivos conservados |
| 02 supervisión con móvil abstracto | Retirado de Cómo funciona | No aporta información adicional ni se presenta como interfaz real |
| Logo real Horneo / recursos de Colaboraciones | Conservados | Sin cambios ni atribución de ilustraciones a Horneo |

No se generaron ni retocaron imágenes ni se añadieron antenas dibujadas. Se conservan las variantes móviles, dimensiones, alt y leyendas de IA. No se copiaron referencias fotográficas, instrucciones o rutas locales al contenido público.

### Tratamiento de carga fallida

`CommercialVisual` mantiene `picture` AVIF/WebP y los recortes suministrados. Ante error del recurso primario realiza una única transición a WebP. Si también falla, sustituye la imagen por una alternativa textual accesible, con su descripción, en el mismo figure. Sin bucles, temporizadores o reintento indefinido; la leyenda no queda aislada en otra columna. La recuperación se conserva por escena y no se transmiten diagnósticos a servidores.

Esto demuestra un comportamiento local seguro ante errores simulados, **no demuestra la causa del incidente anterior ni su reproducción en staging**. Si reaparece allí, harán falta hora, navegador, captura y estado de la petición concreta para investigar ese episodio.

## Validación

Entorno de implementación: Windows, Node 22.23.4. Se reutilizaron dependencias existentes. El comando npx sin versión intentó resolver una CLI no disponible offline y fue cancelado; no se instaló nada. Se usó la CLI 0.1.22 existente en caché con el mismo Node.

- Workspace aislado: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-bvYoAs`.
- Evidencia: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-H3NxUp/summary.json` y logs vecinos.
- Typecheck backend y build backend/frontend: código 0. Typecheck frontend adicional en la misma copia: código 0.
- **52 módulos Store aprobados**, 0 módulos fallidos/omitidos; no confundir módulos con número de aserciones. Se ejecutan también los contratos de precios/condiciones, empresa opcional, roles, privacidad, correo y registro SMTP existentes.
- Lifecycle: **24/24**, 0 fallidas/omitidas. Esto es regresión local, no nueva evidencia Docker/Linux.
- **71/71 comprobaciones nuevas de navegador**, 0 fallidas: `local-final.log`. 320, 390, 768 y 1440 px; numeración vertical y separada, H1/CTA, un Smartracking por página, secuencia única, dos recursos distintos, FAQ por teclado, separación personal/SOS, ancla con título no tapado, cuatro hosts comerciales simulados y Empresa opcional.
- Recursos fallidos simulados: recuperación AVIF → WebP y alternativa tras fallo de ambos, dos peticiones de recurso en el caso de fallo total. Cero POST/intentos de escritura y cero excepciones JS. Los 404 provocados son esperados y no son evidencia de errores en staging.
- Primer guion `local-1.log` falló porque esperaba un evento en el nodo AVIF que React reemplaza al recuperar WebP. Se corrigió la espera del test para observar la imagen actual y su decodificación; no se aumentaron esperas ni se cambió la aplicación para favorecer la prueba. `local-2.log` y final pasan; se conserva el primer log.
- Se inspeccionaron las cuatro capturas de Inicio/Cómo funciona, escritorio y móvil. Sin desbordamiento o huecos de imagen en los escenarios normales probados. No se afirma una auditoría WCAG completa ni compatibilidad universal.

La altura medida de Cómo funciona fue 5.029 px a 390 px y 3.592 px a 1440 px. Es una medida de la previsualización local, no un resultado de conversión ni una garantía para otras fuentes o dispositivos. Inicio mantiene su distribución breve; no se ha reducido artificialmente la escala para las capturas.

## Matriz del encargo

| Criterio | Resultado | Evidencia / límite |
| --- | --- | --- |
| Tres ventajas numeradas, filas independientes | Aprobado local | SSR literal y rectángulos/estilo list-item en cuatro anchuras |
| Smartracking breve, significado confirmado | Aprobado local | Una aparición por página y vinculación a presencia/permanencia/descansos; sin prestaciones adicionales |
| Inicio breve y esquema conservado | Aprobado local | Regresiones de portada y capturas; cuatro bloques extensos ausentes |
| Recorrido claro sin bloques duplicados | Aprobado local | Cuatro pasos, siete FAQ, sin preguntas/beneficios/argumento económico largos repetidos |
| Aviso preventivo y SOS diferenciados | Aprobado local | Dos bloques distintos y pruebas de destinatario/activación; no se valida hardware |
| Imágenes explicativas sin huecos | Aprobado en casos probados | Carga normal y errores simulados; incidente histórico no reproducido |
| Navegación, condiciones, privacidad y áreas privadas | Conservadas | Sin cambios en rutas/contratos comerciales/formularios/autorización; regresiones Store completas |

## Evidencias y reproducción

- [Inicio escritorio](../output/playwright/smartracking-20261104/local-inicio-1440.png) · [Inicio móvil](../output/playwright/smartracking-20261104/local-inicio-390.png).
- [Cómo funciona escritorio](../output/playwright/smartracking-20261104/local-funcionamiento-1440.png) · [Cómo funciona móvil](../output/playwright/smartracking-20261104/local-funcionamiento-390.png).
- Error simulado: `local-image-unavailable.png`. Registro público previo: `staging-read.log`. Resumen versionado: `commercial-smartracking-results.json`.

Desde la raíz, con Node 22.23.4: ejecutar `infrastructure/testing/store-lifecycle-suites.cjs`; usar el workspace que imprima, sin sobrescribir dist del checkout. Ejecutar tsc frontend con `--noEmit -p <workspace>/horizonst-store/web/tsconfig.json`. Servir ese web/dist con `commercial-preview.cjs`, que enlaza solo a loopback y no tiene backend. Abrir una sesión local sin cierre automático y ejecutar `run-code --filename infrastructure/testing/commercial-smartracking.pw.js`. Antes de repetir, escoger una carpeta propia de capturas para no sobrescribir evidencias.

Puede invocarse la CLI cacheada con `& '<Node22.23.4>/node.exe' 'C:/Users/User/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/@playwright/cli/playwright-cli.js' -s=<sesion> ...`. El guion exige empezar en loopback e intercepta todos los hosts y API. Los nombres en la barra son simulados, no una publicación. `commercial-staging-read.pw.js` es un guion aparte de solo GET al staging público, no debe confundirse con la validación local ni con autorización para pruebas privadas.

Pendientes: aprobación para publicar, validación real del correo y cuentas/recursos del entorno cuando se autorice, otros navegadores y tecnologías de asistencia. No se instalaron dependencias, usaron credenciales ni .env, consultaron bases compartidas o enviaron correos/comandos físicos. Solo hubo lectura pública remota autorizada. No se hizo push, merge o despliegue; el navegador y sus pestañas permanecen abiertos.
