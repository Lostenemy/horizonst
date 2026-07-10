# Guía APPCC 2026

La fuente editorial es `guia-appcc-2026.md`. El PDF público se genera sin servicios externos ni credenciales:

```text
npm run generate:appcc-guide
```

El script `scripts/generate-appcc-guide.mjs` usa PDFKit, dependencia ya incluida en HorizonST Store, y escribe el resultado en `web/public/recursos/guia-appcc-2026.pdf`. Vite copia ese recurso a `web/dist/recursos/` durante `npm run build`.

Antes de publicar cambios editoriales, revisar enlaces, fuentes oficiales, advertencias y el PDF generado. La guía es informativa; no sustituye el APPCC ni la evaluación de riesgos de cada centro.

El flujo de leads conserva el registro antes de intentar SMTP y responde con error controlado si el envío falla. Un reintento puede crear otro lead del mismo email hasta el límite actual de tres solicitudes por hora. Si el volumen o la operativa lo requieren, una evolución conservadora sería registrar el estado de entrega e impedir un nuevo envío reciente para el mismo email, mediante una migración específica revisada por negocio y protección de datos.
