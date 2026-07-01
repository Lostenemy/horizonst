---
name: horizonst-staging-validation
description: Use when preparing a controlled HorizonST staging validation plan before changing deployed services.
---

# HorizonST Staging Validation

Esta skill es conservadora. Por defecto solo produce un plan y pide autorización antes de cualquier cambio de estado en staging.

## Plan

- Inspecciona primero el servicio afectado.
- Identifica el nombre exacto en Compose.
- Si se solicita, propone build sin caché.
- Recrea solo el servicio afectado, pero únicamente con autorización explícita.
- Ejecuta migraciones únicamente con autorización explícita.
- Verifica `/health`.
- Inspecciona logs solo cuando esté autorizado y sin exponer secretos.
- Ejecuta pruebas funcionales.
- Crea datos temporales claramente identificables.
- Limpia los datos temporales.
- Verifica la limpieza.
- Define rollback.
- No fusiones ni hagas push a `main`.

## Entrega

Devuelve pasos numerados, comandos propuestos, puntos de autorización y criterios de éxito/fallo.
