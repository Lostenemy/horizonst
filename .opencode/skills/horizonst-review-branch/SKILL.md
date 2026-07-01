---
name: horizonst-review-branch
description: Use when reviewing a HorizonST OpenCode or Codex branch before deployment, merge, or pull request approval.
---

# HorizonST Branch Review

No modifiques archivos al iniciar esta skill. Trabaja como revisor conservador.

## Flujo

- Ejecuta `git status -sb`.
- Comprueba la rama actual y su base.
- Compara con `main`.
- Muestra `git diff --stat main...HEAD`.
- Revisa cada archivo cambiado.
- Detecta secretos, binarios, `node_modules`, `dist`, `.env`, backups y cambios inesperados en lockfiles.
- Revisa arquitectura y coherencia con patrones existentes.
- Revisa autenticación, autorización, IDOR, validación Zod y exposición de información.
- Revisa migraciones, constraints, índices, `ON DELETE`, compatibilidad con datos existentes y atomicidad.
- Revisa transacciones, bloqueos y concurrencia.
- Ejecuta pruebas sin desplegar ni reiniciar contenedores.

## Informe

Entrega en español:

- Bloqueos.
- Problemas importantes.
- Mejoras menores.
- Validaciones ejecutadas y resultado.
- Recomendación: aprobar o devolver a desarrollo.
