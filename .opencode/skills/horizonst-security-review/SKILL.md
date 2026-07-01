---
name: horizonst-security-review
description: Use when reviewing HorizonST authentication, authorization, data exposure, validation, SQL, or security-sensitive changes.
---

# HorizonST Security Review

Revisa con mentalidad de auditoría y prioriza hallazgos explotables.

## Checklist

- Middleware de autenticación.
- Control de roles.
- Propiedad del recurso.
- IDOR.
- Validación Zod.
- Consultas SQL parametrizadas.
- Exposición de notas internas o datos privados.
- Respuestas 404/403.
- Límites de tamaño.
- Archivos subidos.
- Path traversal.
- Secretos.
- Auditoría.
- Transacciones.
- Concurrencia.

## Informe

Ordena por severidad con referencias de archivo y línea. Si no hay hallazgos, dilo explícitamente y lista riesgos residuales.
