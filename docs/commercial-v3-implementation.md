# Revisión comercial v3 — propuesta integrada para revisión local

Fecha: 2026-11-03. Rama: `codex/commercial-v3-collaborations`. Base: `2f55a682a6b7d4192387668689c414d70aa2d865`.
**Implementación local preparada para revisión; no autorizada para publicar ni desplegar.** No se acredita producción ni el funcionamiento físico del producto.

Actualización posterior autorizada: la distribución actual de Inicio y Cómo funciona se documenta en [commercial-home-shortening.md](commercial-home-shortening.md). Las evidencias de esta revisión inicial se conservan; no deben confundirse con las del traslado posterior.

Revisión de 2026-11-04: [Smartracking y recorrido de funcionamiento](commercial-smartracking-review.md). Sustituye la presentación detallada de Cómo funciona, manteniendo Inicio abreviado; las evidencias anteriores siguen siendo históricas, no una comprobación de la versión nueva.

## Resultado, origen y decisiones

Encargo: adjunto `96538907-3f02-4b00-a628-a9fe16ec2d77/Texto pegado.txt`. El usuario autorizó contactar con **Mejorar copy B2B de HorizonST** y después integrar su versión editorial **como propuesta en previsualización**, no como aprobación para producción. Confirmó expresamente que Empresa es opcional: es la empresa de quien consulta, no una compañía de Administración/Horneo.

Texto de origen: `C:/Users/User/Documents/publicidad/salida-web-horizonst/copy-final-2026-11-03/COPY-PUBLICO-v1.md`.
SHA-256: `05aa9e0e6fcf64d149bbada995323287eb8f5ad067363909ca6089bd5a75f01b`.
Notas de origen: `ESTADO-Y-NOTAS-INTEGRACION.md`, en el mismo directorio.
No se ha modificado esa entrega ni se ha copiado el brief al bundle. `commercial-copy.ts` contiene exclusivamente texto público estructurado de las ocho páginas. Adaptaciones de integración: conservar condiciones comerciales autorizadas, Empresa opcional, mensaje opcional, pequeños textos técnicos de límites/errores y no prometer una guía sin comprobar su entrega. No se inventan nuevas prestaciones ni se cambia negocio.

Las capacidades y funcionalidades descritas proceden de las confirmaciones del usuario. Esta revisión web no valida físicamente SOS, pitido, vibración, presencia ni descansos. No se modificó código de esos recorridos.

## Diagnóstico confirmado

- La versión base ya tenía las cuatro páginas comerciales y los enlaces por entorno; no tenía rutas Colaboraciones.
- Su contenido no distinguía suficientemente el aviso personal preventivo del SOS al supervisor.
- Contacto aceptaba nombre/email/mensaje; no transportaba la modalidad de colaboración.
- El antiguo CTA de guía prometía entrega por email. Hay generador, PDF y API legacy, pero no evidencia end-to-end autorizada de entrega en este encargo. Se retira su promesa de esta propuesta; no se borran recursos ni API ni notificaciones.
- Se conservó la revisión compacta de Planes y su fuente comercial. No se recuperan precios históricos del brief ni se reactiva la campaña.

## Mapa de rutas

| Ruta | Implementación | Recorrido |
| --- | --- | --- |
| / | CommercialHome | Cliente final; escenas aprobadas; funciones, funcionamiento, Caso de éxito/Horneo, valor cualitativo, colaboraciones y consulta |
| /planes | PublicPlans | Comparativa API existente, condiciones íntegramente conservadas, modelo de contratación, FAQ y presupuesto |
| /info-faqs | CommercialInfo | Pasos, esquema, instalación, 12 FAQ y ancla #funcionamiento |
| /colaboraciones | PublicCollaborations | Tres modalidades distintas y formulario con selección |
| /colaboraciones/instaladores | PublicCollaborations | Proyecto/instalación; FAQ propias; modalidad fija |
| /colaboraciones/asesorias-prl | PublicCollaborations | Seguimiento preventivo; FAQ propias; modalidad fija |
| /colaboraciones/ingenierias-frio | PublicCollaborations | Uso previsto/proyecto; FAQ propias; modalidad fija |
| /contacto | PublicContact / ConsultationForm | Instalación, presupuesto o colaboración; intención validada desde ?motivo= |
| /aviso-legal y /privacidad | PublicLegal | Rutas y datos legales preservados; finalidad de consultas adaptada a campos reales |

Navegación: Inicio → Planes → Cómo funciona → Colaboraciones → Contacto → Tienda B2B.
Solo se añade Colaboraciones. Lista de rutas exacta; prefijos parecidos o subrutas desconocidas no se aceptan. Sin redirecciones ni cambios de Nginx/DNS/certificados. Tienda mantiene los destinos producción/staging de la allowlist existente.

## Formularios y correo

- Nombre y email profesional obligatorios; Empresa y Mensaje opcionales. Perfil/motivo obligatorios. En las tres páginas específicas, modalidad visible y fijada, sin pedir repetirla.
- No se exige cuenta ni datos fiscales. No se añaden teléfono, publicidad ni seguimiento. Privacidad se mantiene sin premarcar; no equivale a consentimiento de marketing.
- Estado y ayuda accesibles; primer error enfocado; doble envío bloqueado; datos conservados ante error y respuesta incierta. El encabezado de Contacto sigue la intención elegida sin añadir datos personales a la URL.
- API estricta: enum compartido, límites, controles de cabeceras, honeypot y autorización de destinatario fijo. Reutiliza los límites y las reservas HMAC existentes.
- Retrocompatibilidad: solicitudes legacy sin contexto siguen exigiendo mensaje de 10–2000 caracteres; la consulta estructurada permite mensaje vacío. Empresa opcional de 2–200 caracteres si se aporta, o vacía/ausente. No se modifica SMTP ni el journal transaccional.
- El contexto validado participa en la reserva HMAC y en texto/HTML escapado del correo. Destinatario siempre comercial@horizonst.es; Reply-To validado. No se escribe información personal en contadores o logs.
- La reserva de contacto existente dura 15 minutos y no es un registro perpetuo de leads; no se ha ampliado su garantía. No se añaden reintentos automáticos. Aceptación SMTP no acredita buzón ni lectura.
- Desplegar solo el frontend nuevo sobre una API antigua provocaría rechazo de los campos nuevos: la entrega requiere revisar/promover frontend y API compatibles juntos. Este documento no autoriza hacerlo.

## Imágenes

26 archivos seleccionados y verificados SHA-256 contra inventario antes/después de copiar: seis escenas × AVIF/WebP × escritorio/móvil y dos SVG. Total: 1.942.180 bytes. Origen autorizado: directorio `direccion-a-dispositivos-referencia-2026-11-03` de publicidad. Destino: `horizonst-store/web/public/images/comercial-v3/`.

Sin originales fotográficos, prompts, documentación interna ni rutas Windows públicas. Imágenes sin retoques ni antenas añadidas. Picture reserva dimensiones, usa el recorte móvil específico y no vuelve a recortarlo. Solo hero usa prioridad alta; resto lazy. Esquema vertical móvil sin recorte y alternativa textual. Leyendas identifican IA; no son fotos de clientes, pantalla real ni instrucciones de montaje. Horneo conserva exclusivamente su logotipo autorizado.

El preview añadió MIME image/avif a su allowlist. No se cambió el servidor de producción.

## Validaciones y evidencia

Entorno: Windows, Node 22.23.4 ya existente, Chrome local con Playwright CLI. Dependencias existentes, sin instalar paquetes. El harness copia fuentes y fixtures a temporal, excluye .env, usa secretos ficticios efímeros y transporte externo bloqueado.

- Evidencia final de suite: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-evidence-jMFWkS/summary.json`.
- Workspace validado: `C:/Users/User/AppData/Local/Temp/horizonst-store-lifecycle-FJtDWp`.
- Typecheck backend, build backend y build frontend: código 0.
- Typecheck frontend adicional: `tsc --noEmit -p web/tsconfig.json` en ese workspace: código 0.
- **50 módulos Store aprobados, 0 módulos fallidos/omitidos**. No confundir módulos con número de aserciones. Incluye 16 comprobaciones HTTP de Contacto, pruebas de HTML y regresiones SMTP/journal existentes.
- Lifecycle: **24/24**, 0 fallidas, 0 omitidas, en tres procesos de ocho pruebas. Es evidencia local de regresión, no una nueva validación Docker/Linux.
- Nuevo test de acceso privado: peticiones HTTP anónima/cliente/distribuidor con JWT y middleware reales; SQL simulado, clave efímera. 401/403/200, sin consulta de recursos para no autorizados; no prueba la base real.
- Browser final: **102/102**, `output/playwright/commercial-v3-20261103/browser-final.log`. 8 rutas × 320/390/1440 px, sin desbordamiento ni imágenes rotas, navegación/SEO, enlaces válidos y seis hosts simulados, tiendas separadas, FAQ por teclado, Empresa opcional, modo/origen, duplicados, 503 con conservación y éxito simulado. AVIF y SVG servidos/decodificados; WebP móvil decodificado tras retirar fuentes AVIF solo en el DOM de prueba.
- Cinco POST ficticios interceptados: dos del escenario error/recuperación de presupuesto y uno por modalidad. Ninguno llegó al backend ni a SMTP. Una respuesta 503 intencionada de /api/contact produjo el error de consola esperado; no hubo excepciones JS ni errores de consola inesperados.
- Capturas finales: `output/playwright/commercial-v3-20261103/final/`: 16 páginas (ocho × escritorio/móvil) y error de contacto. Se han inspeccionado visualmente capturas de Inicio, Planes, Contacto e Instaladores/PRL; no se afirma inspección manual de cada píxel de todas ellas.
- No hay pruebas de lectores de pantalla, Firefox/Safari, dispositivos móviles físicos o entrega a buzones reales. No se extrapola compatibilidad universal.
- Consulta normativa: [artículo 31 del RD 1561/1995](https://www.boe.es/buscar/act.php?id=BOE-A-1995-21346#a31) y [Ley 31/1995](https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292), BOE consultado el 3 de noviembre. No se añaden tablas de tiempos, obligación de instalar HorizonST o garantía legal.

Las capturas de Planes usan precios **ficticios 615/825/1250 €** y campaña simulada active=false con fecha de referencia 2027. No reflejan precios ni vigencia consultados al entorno real. La aparente fecha futura en pasado pertenece al fixture, no es una comprobación comercial. El código conserva la respuesta de la fuente autorizada, sin reactivarla o corregir fechas por suposición.

### Evidencia de fallos conservada

- Node predeterminado 22.14.0 fue rechazado por el runner; se usó el 22.23.4 existente, sin relajar controles.
- `...evidence-49XlCq`: typecheck/build fallaron por z.infer en los tipos del proyecto; contrato explícito corregido.
- `...evidence-f4RCiI`: contrato antiguo exigía una sola imagen; se actualizó a las ilustraciones ahora autorizadas y logo. No se eliminaron aserciones de precios, impuestos, permisos, tokens, condiciones o incertidumbre.
- Typecheck frontend intermedio de `RWoe0b` detectó import de FormEvent ausente; corregido y revalidado.
- `browser-1.log`: desbordamiento del formulario a 320 px. Corregido min-width/grid/botón y demostrado en `browser-2.log` (75) y final (102). Logs y capturas previas conservados.

## Matriz de aceptación

| ID | Criterio | Resultado y evidencia |
| --- | --- | --- |
| V3-01 | Nombres/orden/destinos; solo nueva pestaña Colaboraciones | Aprobado local: SSR + navegador, responsive y aria-current |
| V3-02 | Cuatro rutas sin duplicados y argumentos propios | Aprobado local: allowlist exacta, títulos y FAQ distintas, 404 desconocida |
| V3-03 | Recorridos/CTA, consulta sin registro | Aprobado local: formularios y envíos interceptados, modalidad validada en API |
| V3-04 | Permanencia/descanso/aviso/SOS diferenciados | Aprobado editorial/local; funciones físicas no evaluadas ni modificadas |
| V3-05 | Caso de éxito/Horneo sin resultados inventados | Aprobado local: título exacto, 400 m²/10 trabajadores como dimensión, logo real, sin testimonios |
| V3-06 | Hardware/software/instalación y condiciones | Aprobado local: constantes, cálculos y APIs de catálogo conservados; datos comerciales reales pendientes de contraste autorizado |
| V3-07 | Privacidad de condiciones económicas | Aprobado en código/bundle revisado y HTTP aislado por rol; pendiente validación del entorno y recursos reales |
| V3-08 | Formularios/privacidad/entrega | Aprobado con SQL y transporte simulados; recepción real en destino pendiente |
| V3-09 | Tienda y acceso privado | Regresiones y controles JWT/rol aislados aprobados; cuentas reales no utilizadas |
| V3-10 | Imágenes correctas e identificación IA | Aprobado en recursos copiados, hashes y capturas revisadas; no son prueba de montaje |
| V3-11 | Formatos/recortes/alt/tamaños/foco/contraste | Carga/formatos/teclado probados, visual local revisado; sin auditoría WCAG integral ni otros clientes |
| V3-12 | Sin rutas locales, enlaces rotos, errores u overflow | Aprobado en los escenarios ejecutados; error 503 esperado separado |
| V3-13 | Copy integrado sin pisar trabajo paralelo | Origen inalterado y propuesta autorizada integrada; aprobación para publicar pendiente |

## Reproducción local

Desde la raíz del repositorio, sin archivos .env ni servicios reales:

```powershell
& 'C:\Users\User\AppData\Local\Temp\horizonst-node22-94d19a32731641d1bda4589cf9c0ad1f\node.exe' infrastructure/testing/store-lifecycle-suites.cjs
# Usar el workspace NUEVO que imprima el runner, sin sobrescribir dist del checkout.
& '<Node22.23.4>\node.exe' '<workspace>\horizonst-store\node_modules\typescript\bin\tsc' --noEmit -p '<workspace>\horizonst-store\web\tsconfig.json'
& '<Node22.23.4>\node.exe' infrastructure/testing/commercial-preview.cjs '<workspace>\horizonst-store\web\dist'
```

Crear directorio propio de evidencia y actualizar la ruta de capturas del guion para no sobrescribir evidencia anterior. Abrir sesión/pestaña local nueva sobre el loopback impreso:

```powershell
npx --offline --no-install --package @playwright/cli playwright-cli -s=<sesion> open http://127.0.0.1:<puerto>/ --headed --idle-timeout=0
npx --offline --no-install --package @playwright/cli playwright-cli -s=<sesion> run-code --filename infrastructure/testing/commercial-v3.pw.js
```

El guion exige empezar en loopback, intercepta todos los hosts, simula API y solo obtiene estáticos del preview local. Los dominios en la barra son simulados: no abrirlos fuera de esa sesión como si fueran esta entrega. El preview solo acepta GET y no tiene backend/proxy. Navegador y pestañas se dejan abiertos, sin cierre automático.

## Archivos y retorno

Cambios: páginas/componentes comerciales, mapa de rutas/SEO, estilos acotados, contrato público de consulta, validación y constructor de correo de contacto, tests, preview AVIF, guion/evidencia documental y 26 imágenes. Sin lockfiles/dependencias, migraciones, infraestructura productiva, credenciales, ACL, MQTT, B5, presencia o alarmas.

Retorno técnico propuesto para revisión: revertir solo el commit de esta entrega en una rama de revisión y reconstruir frontend/API compatibles. Sin migraciones ni reconciliación de datos. No se ha ejecutado ese retorno ni se autoriza despliegue aquí.

Pendientes: aprobación editorial definitiva; revisión jurídica del texto de privacidad por su responsable; validación autorizada de datos comerciales, recursos privados y entrega de solicitudes en staging; otros navegadores/tecnologías de asistencia. No se ha instalado medición: propuesta futura de eventos inicio de formulario, intento, confirmación de solicitud y modalidad (sin PII), separando clic, solicitud y lead cualificado, previa revisión de privacidad.

El árbol versionado estaba limpio al comenzar esta entrega; los cambios previos de preparación de este mismo encargo se conservaron e integraron. Los no versionados preexistentes no se añaden al commit ni se eliminan. No hubo push, merge, despliegue, acceso a bases/servidores compartidos, correo real ni comandos físicos.
