# HorizonST OpenCode Rules

## Idioma

- Responder y documentar en español.
- Mantener identificadores y código en inglés cuando así esté el proyecto.

## Git

- Antes de modificar: mostrar `git status -sb`.
- Trabajar siempre en una rama específica.
- Nunca modificar directamente `main`.
- Nunca fusionar en `main`.
- Nunca hacer push a `main`.
- Nunca usar force push.
- No borrar ramas sin autorización.
- No modificar ni eliminar archivos no versionados preexistentes.
- Un único commit coherente por entrega, salvo autorización expresa.
- Antes del commit: revisar diff, revisar archivos añadidos, buscar secretos y ejecutar validaciones.

## Alcance

- Modificar únicamente archivos relacionados con la tarea.
- No introducir refactors generales no solicitados.
- No añadir dependencias salvo necesidad demostrable.
- No cambiar `package-lock.json` sin justificarlo.
- No tocar backups, archivos `.env`, certificados ni credenciales.

## Docker y Servidor

- No ejecutar despliegues sin autorización explícita.
- No ejecutar `docker compose up -d`, `down`, `restart` o `rm` durante tareas de desarrollo.
- Se permiten builds aislados si no sustituyen servicios desplegados.
- No acceder al socket Docker mediante MCP.
- No modificar Nginx, Certbot o systemd.
- No publicar puertos.
- No eliminar volúmenes.

## Base De Datos

- No ejecutar migraciones contra la base de datos desplegada.
- No realizar `INSERT`, `UPDATE`, `DELETE`, DDL o comandos administrativos salvo autorización explícita.
- No modificar migraciones antiguas.
- Crear siempre una migración nueva.
- Revisar constraints, claves foráneas, índices, comportamiento `ON DELETE`, compatibilidad con datos existentes, atomicidad y concurrencia.

## Seguridad

- No leer ni mostrar valores de `.env`.
- No imprimir tokens.
- No incluir secretos en commits.
- Revisar autenticación, autorización, IDOR, validación Zod y exposición de información.
- Preferir 404 frente a revelar la existencia de recursos ajenos cuando el patrón del proyecto así lo establezca.

## Validación

Para cambios TypeScript:

- instalación limpia cuando proceda;
- typecheck;
- build backend;
- build frontend;
- pruebas relevantes.

No considerar correcta una tarea solo porque compila.

## Entrega

Mostrar:

- `git status -sb`;
- `git diff --stat main...HEAD`;
- pruebas ejecutadas;
- resultado;
- hash del commit;
- rama local y remota;
- riesgos pendientes.
