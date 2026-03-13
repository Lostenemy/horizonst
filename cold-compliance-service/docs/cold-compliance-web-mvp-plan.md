# Cold Compliance Service · Plan e implementación MVP web

## PASO 1 · Estructura operativa
### 1) Requisitos confirmados
- Roles válidos: trabajador (sin login), supervisor, administrador, superadministrador.
- Login obligatorio y recuperación de contraseña por email desde fase 1.
- Pantallas MVP: inicio/dashboard, usuarios, gateways+tags, asignaciones trabajador-tag, alarmas, informes.
- Dashboard con prioridad de alertas y presencia en tiempo real (trabajadores dentro + tiempo acumulado).
- Alarmas generales CRUD (crear/editar/activar-desactivar/eliminar).
- Informe único inspección exportable a PDF y Excel con mismos datos.
- Responsive escritorio/móvil.

### 2) Permisos por rol
- Supervisor: alarmas + asignación tags a trabajadores + desactivar usuarios.
- Administrador: permisos supervisor + informes + crear usuarios + editar usuarios.
- Superadministrador: permisos administrador + asignar MAC tags/gateways + borrar usuarios.

### 3) Entidades y CRUD
- app_users (C/U/R/D según rol).
- workers (registro interno, no login).
- tags (MAC + descripción; MAC gestionada por superadministrador).
- gateways (MAC + descripción; MAC gestionada por superadministrador).
- worker_tag_assignments (alta, cambio, histórico con fecha fin).
- alarm_rules (CRUD completo).

### 4) Flujos
1. Login y gestión de sesión.
2. Recuperación contraseña: solicitud email + token + reset.
3. Operación dashboard: presencia activa + alertas activas.
4. Gestión usuarios por rol (desactivar vs borrar).
5. Gestión inventario tags/gateways.
6. Asignaciones trabajador-tag con desasignación implícita y trazabilidad.
7. Descarga informe inspección (PDF/XLSX).

### 5) Tiempo real
- SSE `/realtime/stream` para contadores activos (trabajadores en cámara y alertas).
- Polling en dashboard para detalle de tablas.

### 6) Exportaciones
- `/reports/inspection.pdf`
- `/reports/inspection.xlsx`
- Mismo dataset base (`cold_room_sessions` + trabajador + tag).

### 7) Riesgos/huecos detectados
- El backend original no tenía auth/usuarios de app/roles.
- No existía entidad explícita de alarma configurable (solo alertas operativas disparadas).
- El flujo email real depende de integración SMTP externa; en MVP se genera token y se registra en logs.
- Topología actual de una sola cámara: se mantiene sin añadir complejidad multi-cámara.

## PASO 2 · Especificación funcional mínima
- Interfaz web única publicada por el servicio en `/` y recursos estáticos en `/web/*`.
- Módulos navegables: Inicio, Usuarios, Gateways+Tags, Asignaciones, Alarmas, Informes.
- Seguridad por token Bearer y control por rol en endpoints.

## PASO 3 · Arquitectura técnica
- Sin sobreingeniería: Express + HTML/CSS/JS nativo (sin framework adicional).
- Persistencia PostgreSQL con migración incremental `003_web_mvp.sql`.
- Tiempo real con SSE (compatible tras Nginx con `proxy_buffering off` si se habilita ruta).
- Despliegue Docker actual conservado (solo copia carpeta `web`).

## PASO 4 · Revisión backend existente
### Cubierto previamente
- workers/tags/cámaras/presencia/alertas/incidencias/reportes parciales.

### Carencias encontradas
- Sin login/sesiones/recuperación contraseña.
- Sin CRUD de usuarios de aplicación ni borrado/desactivación por rol.
- Sin CRUD de alarmas generales parametrizables.
- Sin CRUD explícito de gateways.
- Sin endpoint de dashboard listo para frontend.
- Reportes no alineados al informe único inspección PDF+Excel mismo dataset.

## PASO 5 · Necesidades backend exactas
Implementado en esta iteración:
- Migración de tablas: `app_users`, `auth_sessions`, `password_reset_tokens`, `alarm_rules` + vista historial asignaciones + seed superadmin.
- Endpoints nuevos: `/auth/*`, `/users/*`, `/gateways/*`, `/alarm-rules/*`, `/dashboard/*`, `/realtime/stream`.
- Endpoints ajustados: `/workers`, `/tags`, `/cameras`, `/alerts`, `/reports` con auth y permisos.

## PASO 6 · Fases
1. Login (completado).
2. Dashboard presencia+alertas (completado).
3. Usuarios (completado).
4. Tags+gateways (completado).
5. Asignaciones (completado con histórico).
6. Informes (completado con PDF/XLSX homogéneos).

## PASO 7 · Implementación
- Web MVP integrada y operativa en el contenedor `cold_compliance_service`.
- Preparado para publicación detrás de Nginx sin romper servicios existentes.

## Ajustes de iteración (alineación funcional)
- Recuperación de contraseña ahora usa envío SMTP real (`MAIL_*`) con enlace de reset, eliminando dependencia de logs.
- Realtime ampliado: snapshot y SSE con detalle operativo (trabajadores dentro, tiempo, tag, estado operativo y alertas activas).
- Permisos de usuarios corregidos: supervisor ya no puede desactivar usuarios autenticables.
- UI web ampliada para operación MVP completa: dashboard priorizado, usuarios, inventario, asignaciones, alarmas e informes con descarga autenticada.
- Separación explícita de estados:
  - Usuario autenticable: `active/inactive` (tabla `app_users`).
  - Estado operativo de presencia: `dentro/fuera/alarma` (derivado de sesiones y alertas).

- Correcciones de validación real aplicadas:
  - SMTP DATA finalizado correctamente con terminación `\r\n.\r\n` para evitar `lost connection after DATA`.
  - Login compacto y envío por Enter en formulario (`submit`).
  - Alta operativa de trabajadores añadida en UI para desbloquear flujo de asignación de tags.
  - Alta/promoción a `superadministrador` bloqueada en UI y endurecida en backend.
  - Configuraciones de ejemplo saneadas sin secretos reales versionados.
