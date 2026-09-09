# Correcciones de seguridad — septiembre de 2026

Base: `2d8902f5b45d959584a28d3ba82b71abb27b7a92`. Rama: `codex/security-remediation`.

Esta entrega implementa las correcciones de aplicación del informe del 5 de septiembre. No es una autorización de despliegue ni certifica el entorno de producción. No se han leído secretos, cambiado topics ni enviado comandos a hardware.

## Estado por hallazgo

| Hallazgo | Implementación | Límite / comprobación pendiente |
| --- | --- | --- |
| SEC-01: HTML no escapado | Las tablas Horneo escapan texto por defecto; los controles requieren un marcador local no falsificable desde JSON. Nombres, emails, históricos y mensajes se escapan. Identificadores interpolados en controles se restringen a caracteres inertes. | CSP de scripts en modo report-only; se mantienen los manejadores inline existentes. Verificar interfaz en staging. |
| SEC-02: privilegios JWT antiguos | Backend consulta usuario y rol actuales. Backend y Store vinculan access tokens a un HMAC de la credencial vigente; cambiar contraseña invalida el token sin exponer el hash. | JWT anteriores sin esa versión dejan de autenticar. Los tokens de servicio Hardware Manager no se modifican. |
| SEC-03: abuso de autenticación | Contadores PostgreSQL compartidos por réplicas en backend, Horneo y Store. PBKDF2 del login backend pasa a ejecución asíncrona. Protección local del login MQTT UI. | MQTT UI necesita control adicional compartido si se replica. Revisar los presupuestos detrás del proxy antes de publicar. |
| SEC-04: recuperación y sesiones | Consumo condicional del token bajo bloqueo del usuario y en una sola transacción. Revocación de sesiones Horneo y refresh tokens Store; access tokens Store anteriores también pierden validez. Los logins usan el mismo bloqueo para no recrear sesiones antiguas tras un reset concurrente. | Verificar bloqueo/rollback en PostgreSQL aislado antes del despliegue; las pruebas de concurrencia locales usan un doble transaccional. |
| SEC-05: token en URL | SSE Horneo usa fetch streaming con Authorization; desaparece la aceptación genérica de `access_token` en query. La conexión revalida la sesión en cada ciclo. | Publicar conjuntamente frontend y backend Horneo; el cliente EventSource antiguo ya no autentica. |
| SEC-06: errores internos | Horneo devuelve mensaje genérico en 500 y un identificador de correlación; no registra mensajes de excepción que puedan incluir parámetros sensibles. | Comprobar observabilidad operativa con los nuevos campos; no se conservan detalles SQL arbitrarios en el log. |
| SEC-07: archivos sensibles históricos | Se añade un control incremental de artefactos y formatos reconocibles de secretos para PRs. No se abren ni eliminan archivos históricos. | Revisión por custodio, rotación y eventual limpieza del historial siguen pendientes de autorización. El control incremental no equivale a un escáner exhaustivo. |
| SEC-08: token de recuperación dev | Store nunca devuelve el token al solicitante; usa correo y fragmento URL, eliminado por la página al cargar. Respuesta genérica en todos los modos, también si falla SMTP. | Validar SMTP de staging con una cuenta de prueba autorizada. Si el correo está deshabilitado, no hay entrega ni alternativa HTTP insegura. |

## Sesiones y contraseñas

- No se cambian las claves de firma ni se añade una contraseña por defecto.
- El HMAC de versión se calcula con la clave ya configurada y el hash actual, con separación de dominio. No se incluye el hash de contraseña en el JWT o la respuesta del usuario.
- Los JWT antiguos del backend requieren iniciar sesión de nuevo. En Store, un refresh token aún vigente puede emitir un access token actualizado; después de un reset los refresh tokens quedan revocados.
- Horneo elimina sesiones cuando se restablece o cambia una contraseña, se cambia un rol o se desactiva un usuario. La desactivación invalida también recuperaciones pendientes.
- Horneo exige al menos diez caracteres y como máximo 72 bytes UTF-8 para nuevas contraseñas, evitando truncado por bcrypt. La validación de creación/edición se refleja en la interfaz. El login sigue permitiendo contraseñas antiguas no vacías más cortas, pero rechaza las que excedan 72 bytes.
- Sigue existiendo almacenamiento de tokens en `localStorage`. Migrarlo a cookies HttpOnly exigiría un cambio coordinado de sesión/CSRF; no se considera resuelto en esta entrega.

## Presupuestos de autenticación

Ventana de quince minutos, contando intentos admitidos, no solo fallidos:

- 120 por dirección de conexión y grupo de operación.
- 30 por identificador de cuenta normalizado y grupo.
- 10 por combinación dirección/cuenta y grupo.
- Se separa login de recuperación/registro. Rutas operativas, eventos BLE y lecturas autenticadas no consumen estos contadores.
- El identificador de cuenta se toma solo de email/username, nunca de contraseña o token. Las claves persistidas son SHA-256; esto es seudonimización, no anonimización frente a diccionarios.
- Se usa `socket.remoteAddress`, no cabeceras de origen controlables por el cliente. Detrás de un proxy, los usuarios comparten el presupuesto de esa conexión. Esta decisión evita suplantación de IP, pero requiere medir capacidad y diseñar confianza explícita en el proxy si se necesita granularidad por cliente.
- No hay bloqueo permanente de cuentas. La ventana vence y se devuelve `Retry-After` en 429. Si falta la tabla o falla PostgreSQL, el acceso protegido responde 503, sin habilitar intentos ilimitados.
- Se limpian hasta 500 contadores caducados por operación de mantenimiento, como máximo una vez por minuto por proceso activo. Los contadores no afectan a tablas de presencia o histórico.
- MQTT UI mantiene un límite local: 10 por origen y 120 globales cada quince minutos. Se reinicia con el proceso y no se comparte entre réplicas: no sustituye una protección de perímetro distribuida.

## Migraciones aditivas

1. `backend/migrations/004_auth_rate_limits.sql`.
2. `cold-compliance-service/migrations/021_auth_rate_limits.sql`.
3. `horizonst-store/migrations/016_auth_rate_limits.sql`.

Solo crean contadores y su índice de caducidad, sin modificar filas históricas, usuarios, FKs de overlays o hardware. Los runners existentes las envuelven en transacción. Se corrige el runner Horneo para utilizar una única conexión PostgreSQL durante BEGIN, ejecución, registro y COMMIT/ROLLBACK; usar consultas independientes del pool no garantiza esa propiedad. La prueba previa se actualiza para comprobar esta garantía más fuerte.

No se han ejecutado estas migraciones contra ninguna base desplegada. En este entorno no se localizaron binarios PostgreSQL para una instancia desechable; queda pendiente la validación SQL real.

## Orden de actualización — solo tras autorización operativa

1. Confirmar revisión del diff y resultados locales; preparar una base aislada de prueba. Aplicar allí las tres migraciones y probar reinicio/idempotencia, contadores concurrentes, consumo único del reset y rollback ante fallo.
2. Validar SMTP con cuentas de prueba y los presupuestos detrás de los proxies reales. No imprimir credenciales ni URLs con tokens en registros.
3. Identificar y conservar artefactos e imágenes anteriores validados, así como el mecanismo seguro de restauración de configuración; no incluir sus secretos en la documentación.
4. Aplicar migraciones mediante el mecanismo autorizado de cada servicio. No habilitar los nuevos logins sin las tablas: fallarán de forma cerrada con 503. No mezclar frontend Horneo antiguo con backend nuevo por el cambio SSE.
5. Publicar frontend/backend emparejados en staging. Comprobar login, roles reducidos, contraseña cambiada, recuperación, caducidad, reconexión SSE, tablas en lectura y edición, archivado de alertas y generación de informes.
6. Comprobar presencia recibida y observabilidad pasiva. Ninguna prueba debe emitir alarma o configuración física sin autorización expresa. El parser 3070, comandos B5, ACK y topics permanecen intactos.
7. Promover solo después de estas verificaciones y de la autorización de despliegue. Avisar previamente de la renovación de sesiones.

## Rollback

1. Detener la promoción si fallan login, SSE, entrega de correo o los presupuestos de acceso. Conservar evidencia sin tokens.
2. Restaurar el artefacto anterior validado de cada servicio afectado. Para Horneo restaurar juntos frontend y backend, no solo el modo de autenticación ni un flag de Hardware Manager.
3. Mantener las tablas nuevas: son aditivas y el código anterior las ignora. No borrar datos ni revertir FKs. No restaurar snapshots completos de la base que puedan perder actividad operacional.
4. Mantener las contraseñas que ya se hayan cambiado y las revocaciones de sesiones. No recuperar tokens consumidos o sesiones revocadas desde una copia antigua.
5. Comprobar login nuevo, permisos, recepción pasiva de presencia y stream compatible con el artefacto restaurado, sin comandos reales.
6. El rollback al código anterior reintroduce vulnerabilidades conocidas; restringir acceso mediante un cambio operativo aprobado y planificar corrección. No afirmar que es equivalente en seguridad al código corregido.

## Validaciones de esta entrega

Las pruebas se ejecutan con `scripts/security-test-isolation.cjs`: evita cargar `.env` y bloquea conexiones externas y puertos de servicios. Los ejecutores físicos y consultas de negocio están sustituidos por dobles en las suites existentes.

Resultados de referencia, actualizados en el informe final:

- Backend: 58 pruebas aprobadas.
- Horneo: 115 aprobadas, una omitida por requerir habilitación explícita de una base PostgreSQL de test.
- Store: runner de 37 archivos, con tests adicionales de concurrencia, revocación, rate limiting y respuesta HTTP sin token en desarrollo/test/producción.
- MQTT UI: cinco pruebas aprobadas, incluyendo el nuevo límite de login.
- Typecheck de backend, Horneo, Store y web Store; builds TypeScript y build Vite de Store.
- Guard de artefactos: autoprueba y comprobación incremental antes del commit; `git diff --check`.

Ejemplo PowerShell desde la raíz:

```powershell
$env:NODE_OPTIONS = '--require="' + (Resolve-Path scripts/security-test-isolation.cjs).Path + '"'
$env:POST_E1_ALLOW_DATABASE_TESTS = 'false'
npm test --prefix backend
npm test --prefix cold-compliance-service
Push-Location horizonst-store
node --import tsx scripts/test.mjs
Pop-Location
npm test --prefix mqtt-ui-api
```

Se usa `node --import tsx` con el mismo runner Store porque el lanzador `tsx` intenta abrir una tubería IPC que el aislamiento bloquea. No se relaja el bloqueo. La suite Store regenera su PDF de guía: ese artefacto no forma parte de esta entrega y debe conservarse/restaurarse con copia verificable al repetirla.

No se hizo instalación limpia: no se añadieron dependencias ni se modificaron lockfiles. La consulta `npm audit` fue bloqueada por la política del entorno al enviar inventario de paquetes a npm; requiere autorización específica. No hay resultado de CVE ni declaración de dependencias libres de vulnerabilidades.

## Uso de Hermes y ahorro

Se delegó únicamente un inventario mecánico de scripts y regresiones comerciales, con proyección de solo lectura. La skill excluye seguridad, autenticación y migraciones, por lo que esas implementaciones y su revisión permanecieron en Codex.

- Tarea: `20260908T171055Z-inventario-mec-nico-de-v-ea037246`.
- Modelo: `qwen3.8:27b`, sin cambiar el predeterminado.
- Resultado: rechazado; timeout de inactividad, sin informe validado.
- Duración registrada: 1.269,18 segundos; un intento; cinco eventos de archivo.
- Trabajos aceptados: cero. Código del modelo local integrado: ninguno.
- `local_tokens` y `gpt_tokens_saved`: no medidos (`null`). No se puede calcular un porcentaje ni ahorro neto real. El intento añadió coordinación sin sustituir trabajo aceptado.
- Se creó seguimiento silencioso cada quince minutos; se pausó tras recoger y registrar el fallo. No se relanzó Hermes ni se cargó su conversación interna.

La medición final no equipara tokens locales con ahorro GPT ni usa el consumo global de la cuenta como sustituto de telemetría de esta tarea.
