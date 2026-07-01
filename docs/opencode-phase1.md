# OpenCode Fase 1 HorizonST

## Arquitectura

La configuración del proyecto vive en `opencode.json` en la raíz del repositorio. Las instrucciones persistentes están en `AGENTS.md`, las skills en `.opencode/skills/*/SKILL.md` y el plugin local de protección en `.opencode/plugins/horizonst-guard.js`.

OpenCode 1.17.12 carga esta configuración al iniciar. Hay que reiniciar OpenCode después de cambiar estos archivos.

## Archivos Creados

- `AGENTS.md`
- `opencode.json`
- `.opencode/package.json`
- `.opencode/plugins/horizonst-guard.js`
- `.opencode/skills/horizonst-review-branch/SKILL.md`
- `.opencode/skills/horizonst-create-migration/SKILL.md`
- `.opencode/skills/horizonst-staging-validation/SKILL.md`
- `.opencode/skills/horizonst-security-review/SKILL.md`
- `docs/opencode-phase1.md`

## LSP TypeScript

La configuración usa `"lsp": true`, que activa los LSP integrados compatibles de OpenCode.

Comprobaciones realizadas antes de configurar:

- `opencode.cmd debug lsp diagnostics horizonst-store/src/server.ts` devolvió `{}`.
- `opencode.cmd debug lsp diagnostics horizonst-store/web/src/App.tsx` devolvió `{}`.
- `horizonst-store` y `horizonst-store/web` incluyen `typescript` local en `devDependencies`.
- No existe `typescript-language-server` local en esos paquetes.

El LSP sirve para navegación, símbolos y diagnósticos rápidos dentro de OpenCode. No sustituye a `npm run typecheck`, porque el typecheck ejecuta la configuración completa del proyecto y debe seguir siendo la validación obligatoria.

## Skills Disponibles

- `horizonst-review-branch`: revisión conservadora de ramas antes de merge, despliegue o PR.
- `horizonst-create-migration`: creación o revisión segura de migraciones PostgreSQL.
- `horizonst-staging-validation`: plan controlado de validación en staging, conservador por defecto.
- `horizonst-security-review`: revisión de autenticación, autorización, IDOR, Zod, SQL y exposición de datos.

Invocación: pide explícitamente a OpenCode que use la skill por nombre, por ejemplo `usa la skill horizonst-review-branch para revisar esta rama`.

## Permisos Bloqueados

Se configuran permisos nativos y un plugin local adicional para bloquear:

- `git reset --hard`
- `git clean`
- `git push --force`
- `git push -f`
- `git push origin main`
- `git branch -D`
- lectura directa de `.env`
- lectura de claves privadas comunes
- `docker system prune`
- `docker volume rm`
- `docker compose down -v`
- SQL destructivo evidente como `DROP DATABASE`, `DROP SCHEMA` y `TRUNCATE`
- ejecución de Certbot
- operaciones evidentes sobre Nginx y systemd

## Operaciones Que Requieren Aprobación

- `git commit`
- cualquier `git push`
- `git merge`
- `git rebase`
- instalación de dependencias
- cambios de estado con Docker Compose
- conexión con `psql`
- escritura fuera del repositorio
- `webfetch` y `websearch`

## GitHub MCP

Se configura el GitHub MCP Server oficial remoto:

- URL: `https://api.githubcopilot.com/mcp/`
- Token: variable de entorno `GITHUB_MCP_TOKEN`
- OAuth desactivado para usar PAT por cabecera.
- Toolsets habilitados: `repos,pull_requests,actions`.

No se incluye ningún token real. Javier debe crear un token fine-grained restringido a `Lostenemy/horizonst` con permisos mínimos:

- Metadata: read.
- Contents: read.
- Pull requests: read/write solo si se crearán PRs desde OpenCode.
- Actions: read, solo si se consultarán checks o workflows.
- Commit statuses/checks: read si GitHub lo separa en la interfaz del token.

No conceder administración de secretos, miembros, reglas del repositorio, borrado de ramas ni administración de Actions.

Para usarlo:

```powershell
# Define GITHUB_MCP_TOKEN en el entorno de la shell antes de iniciar OpenCode.
opencode.cmd mcp list
```

No escribas el valor en archivos versionados.

## Plugin Local

`horizonst-guard.js` bloquea antes de ejecutar comandos o lecturas sensibles. No usa red, no envía telemetría, no lee secretos y no modifica comandos permitidos.

En este entorno Windows CLI cubre patrones directos y habituales de lectura mediante `type`, `cat`, `more` y `Get-Content` cuando el argumento parece apuntar a `.env`, `.env.local`, `.env.production` o cualquier `.env.*` que no sea un archivo de ejemplo. También bloquea lecturas directas mediante la herramienta `read` de OpenCode para `.env` sensibles y claves privadas comunes.

La comprobación reproducible está en `.opencode/tests/horizonst-guard.test.mjs` y no lee archivos reales; solo invoca el hook con comandos simulados.

Limitaciones:

- No promete protección absoluta frente a shell ofuscado ni implementa un parser completo de PowerShell o shell.
- No puede analizar SQL arbitrario construido dinámicamente.
- Complementa, pero no sustituye, los permisos nativos y la revisión humana.

## Notificaciones

No se instaló ningún plugin de notificaciones. La documentación oficial muestra ejemplos con `osascript` para macOS y menciona notificaciones de la app de escritorio, pero este entorno es Windows CLI y no se confirmó una opción mantenida, segura y con permisos mínimos.

Recomendación: usar notificaciones nativas de la app de escritorio de OpenCode si Javier la utiliza. No incluir prompts, rutas sensibles, tokens, código ni variables de entorno en notificaciones.

## Actualización Segura

- No usar versiones `latest` implícitas para plugins externos.
- Antes de añadir un plugin, revisar repositorio, mantenedor, licencia, actividad, código ejecutado y permisos.
- Validar `opencode.cmd debug config` tras cambios.
- Reiniciar OpenCode para aplicar cambios.

## Desinstalación

Para retirar esta fase:

- Eliminar `opencode.json` si no contiene otras configuraciones necesarias.
- Eliminar `.opencode/skills` y `.opencode/plugins/horizonst-guard.js`.
- Eliminar o conservar `AGENTS.md` según se quiera mantener las reglas del proyecto.
- Reiniciar OpenCode.

## Resolución De Problemas

- Si OpenCode no arranca, ejecutar con `OPENCODE_DISABLE_PROJECT_CONFIG=1` y corregir `opencode.json`.
- Si el MCP devuelve 401, revisar que `GITHUB_MCP_TOKEN` exista en el entorno y tenga permisos vigentes.
- Si el MCP no aparece, ejecutar `opencode.cmd mcp list` y `opencode.cmd mcp debug github`.
- Si el LSP no muestra diagnósticos, ejecutar `opencode.cmd debug lsp diagnostics <archivo>`.
- Si una skill no aparece, ejecutar `opencode.cmd debug skill` y comprobar frontmatter y ruta `SKILL.md`.

## Comprobación De Secretos

Antes de commit:

- Ejecutar `git diff --check`.
- Revisar archivos añadidos.
- Buscar patrones de token y claves en archivos añadidos.
- Confirmar que no se versionan `.env`, claves privadas, certificados, `node_modules`, `dist`, backups ni lockfiles innecesarios.
