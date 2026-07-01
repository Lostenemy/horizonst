---
name: horizonst-create-migration
description: Use when creating or reviewing PostgreSQL migrations for HorizonST services.
---

# HorizonST Migration Safety

No ejecutes migraciones contra el servidor desplegado.

## Comprobaciones Obligatorias

- Identifica el siguiente número disponible.
- No modifiques migraciones anteriores.
- Revisa nombres de constraints.
- Revisa tipos, valores por defecto, `NOT NULL` y checks.
- Revisa claves foráneas y comportamiento `ON DELETE`.
- Revisa índices, unicidad y consultas esperadas.
- Evalúa compatibilidad con filas existentes.
- Evalúa duración de bloqueos.
- Evalúa idempotencia del runner.
- Evalúa atomicidad y rollback operativo.
- Revisa impacto en backend y frontend.
- Define pruebas necesarias.

## Entrega

Explica los riesgos de datos, concurrencia y despliegue. Si falta autorización explícita, no ejecutes la migración.
