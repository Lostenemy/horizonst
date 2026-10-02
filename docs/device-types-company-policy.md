# Catálogo técnico y política por compañía

Fecha: 02-10-2026. Base `c2257afaccf34a9e63bfd3729ad778c277cafe1b` de origin/main actualizado.
Rama local: `codex/device-types-company-policy`. No hay despliegue ni migraciones ejecutadas en entornos compartidos.

## Contrato confirmado

1. Una selección de tipos autoriza nuevas asignaciones de esos tipos a esa compañía.
2. Compatibilidad operativa independiente: inicialmente solo código `b5`. Un tipo nuevo no recibe comandos/capacidades B5.
3. Baja lógica del catálogo. Retirar una selección se bloquea con cualquier dispositivo asignado, incluso inactivo.
4. Selección vacía = ningún tipo, no todos. Una compañía nueva empieza sin selecciones.
5. Desactivar bloquea nuevas altas/asignaciones/cambios de tipo, no operaciones existentes ni su reactivación por estado. No se modifican IDs, MAC, compañía, credenciales o historial de dispositivos existentes.

Las compañías existentes se inicializan exclusivamente con los tipos que ya utilizan, incluyendo dispositivos/compañías inactivos. Los dispositivos sin compañía no generan una política de compañía ficticia. `tag`, `unknown`, `sensor`, `beacon` y `b5` mantienen su significado. No se infiere modelo por nombre/MAC.

## Implementación

- Migración nueva `backend/migrations/013_device_type_catalog.sql`. El runner ya existente ejecuta SQL y ledger/checksum en la misma transacción; no editar 001–012.
- `device_types`: código estable PK, nombre/descripción, active y fechas; códigos inmutables, eliminación física bloqueada, baja lógica. `devices.device_type` conserva su columna/default/NOT NULL y pasa de CHECK fijo a FK RESTRICT.
- `company_device_types`: relación única por compañía/código, ambas FKs RESTRICT. No se borra historia por desactivación. Sin filtros active en la comprobación de referencias.
- Preflight y bloqueo de devices/companies durante inicialización: si hay tipos NULL o fuera del legacy esperado, abortar y revisar; no corregir datos silenciosamente. Ningún UPDATE de devices.
- Triggers validan también SQL directo de bootstrap/conciliadores, no solo el formulario. Nueva asignación toma cerrojo de compañía y SHARE del tipo activo. Retirada toma el mismo cerrojo de compañía y reevalúa dispositivos. Un cambio concurrente se serializa o devuelve conflicto; no omitir la validación. Una actualización sin cambio de compañía/tipo conserva la referencia existente aunque el catálogo esté inactivo.
- `hardware_device_policy`: contrato JSON por dispositivo (`known`, `typeActive`, `companyAllowed`, `horneoCompatible`). `typeActive` se usa para **nuevas asignaciones**, no para revocar operación existente. Compatibilidad se calcula en central, no es un campo editable del CRUD.
- API: GET/POST `/api/device-types`; PATCH/DELETE `/:code` (DELETE lógico); GET/PUT `/api/companies/:id/device-types`. PUT sustituye selección explícita `{types: [...]}`; duplicados/códigos inválidos rechazados; cada operación de gestión es transaccional y auditada. Modificación solo ADMIN/hardware_superadmin; lectura de política por compañía requiere alcance hardware existente. USER legacy puede leer catálogo no sensible, no gestionar compañías/políticas.
- Altas/cambios de dispositivos dejan de validar un enum cerrado y conservan autorización existente. SQL exige tipo conocido/activo y selección de compañía en nuevas asignaciones. Conflictos 409, sin escrituras parciales. Inventario sin compañía sigue permitido a quien ya tenía permiso.
- APIs públicas/internas añaden `type_policy` sin ocultar filas incompatibles. Si SQL de política no está disponible, la consulta falla: no inventa permisos. No hay un permiso implícito por catálogo no cargado.
- Horneo usa `isOperationalB5` en los puntos operativos ya existentes: active/status y B5 siguen independientes de autorización por compañía. Un B5 con typeActive=false sigue admitido si su política existente lo permite. Falta de policy en una respuesta nueva se rechaza, con motivo explícito; es imprescindible desplegar Backend compatible antes de Horneo.
- Inventario/selectores Horneo añaden aviso de compatibilidad no verificada, sin borrar overlays, ocultar registros o cambiar fallback. La validación de asignaciones/eventos/acciones permanece en servidor, no en la etiqueta del selector.
- El ajuste inicialmente propuesto para filtrar selectores y deshabilitar fallback fue rechazado por protección de ejecución. Se descartó: fallback y lista de registros conservados, alternativa informativa implementada. No se eludió esa protección.
- Navegación compartida `navigation.js` vía `initAuthPage`; nueve páginas existentes y catálogo nuevo. Login y redirección device-create no son páginas de navegación autenticada. Mismo orden, permisos, `aria-current`, menú con teclado/Escape, rutas relativas bajo `/administracion`, sin dependencia del hostname ni cambios Nginx/DNS.
- Inventarios mantienen la carga independiente de c2257af. El catálogo es un recurso auxiliar con reintento; si falla, no oculta inventario y deshabilita acciones dependientes. Tipos incompatibles/inactivos muestran estado explícito.

## Vías programáticas y compatibilidad

No se ejecutaron bootstrap ni conciliadores. Sus INSERT/UPDATE quedan sujetos a triggers. El bootstrap sigue creando `tag`, el conciliador conserva su contrato B5; ningún tag/unknown existente se convierte por esta migración.

Para una compañía nueva o vacía, un operador global debe seleccionar explícitamente `tag` antes de bootstrap que lo requiera, o `b5` antes de altas B5 del conciliador. No insertar permisos automáticamente para hacer que el script pase. Un dry-run antiguo no acredita autorización de tipos: el apply puede rechazar y revertir su transacción central. No usar scripts de reconciliación como despliegue ni tratar sus dos bases como transacción distribuida.

El harness de paridad de producción prepara **en sus fixtures aislados** la selección requerida antes del bootstrap: primero prueba rechazo y rollback sin selección; después selecciona explícitamente solo `tag`. No se ha cambiado el bootstrap operativo ni se conceden permisos desde él. El ledger Backend se compara por nombres y checksums SHA-256 de todas las migraciones actuales (incluida 013), y se comprueba que el rearranque conserva también sus fechas. Repetir el harness actualizado antes de utilizarlo como validación de producción. No interpretar la migración 013 como soporte de nuevos protocolos físicos.

## Secuencia propuesta (no ejecutada)

1. Antes de cualquier cambio compartido, ejecutar migración/pruebas en PostgreSQL 15 desechable y revisión de retorno. El usuario ha comunicado que `deviceTypes.postgres.test` pasó en PostgreSQL 15 aislado en staging: 1 aprobada, 0 fallidas, 0 omitidas. Esta evidencia no equivale a ejecutar el harness de bootstrap actualizado, que sigue pendiente. Docker local no tiene daemon disponible. No sustituir el entorno desechable por la base compartida de staging.
2. Operador autorizado: obtener inventario agregado previo, incluidos NULL, tipos legacy, compañías/dispositivos inactivos y sin compañía. Comparar conteos/IDs/referencias privadamente; no exportar MAC, trabajadores, credenciales o payloads.

   ```sql
   BEGIN TRANSACTION READ ONLY;
   SET LOCAL statement_timeout='5s';
   SELECT device_type,active,status,company_id IS NULL AS unassigned,count(*)
   FROM devices GROUP BY device_type,active,status,company_id IS NULL;
   SELECT c.active,d.device_type,count(*) FROM devices d JOIN companies c ON c.id=d.company_id
   GROUP BY c.active,d.device_type;
   ROLLBACK;
   ```

3. Preparar respaldo y artefactos revisados; ventana de mantenimiento para inicialización. Aplicar **013 mediante runner**, con políticas completas derivadas de filas actuales. La migración bloquea escrituras mientras inicializa; fijar timeouts operativos apropiados en la sesión del despliegue, y abortar sin limpiar datos si no puede adquirirlos. Comparar antes/después: ningún device cambia, cero huérfanos/NULL nuevos; cada pareja compañía/tipo usada tiene selección.
4. Publicar primero Backend/UI compatibles con esquema 013 y mantener Horneo anterior mientras se verifica API interna (misma compañía, B5 activo, `type_policy` completa). Estos son pasos para el operador tras autorización, no acciones hechas aquí.
5. Actualizar Horneo únicamente después de verificar las respuestas centrales. Invalidar/refrescar la caché con el mecanismo existente o reinicio autorizado; esperar TTL y comprobar presencia/snapshot de forma pasiva. No enviar LED/buzzer/vibración, configuraciones ni MQTT para validar este trabajo.
6. Comprobar roles y navegación con fixtures; en staging autorizado comprobar estado API/UI y conservación de B5 existente, incluidos tipos desactivados. Tipo nuevo permitido sigue incompatible. Solo después ampliar catálogo/configuración de nuevas compañías explícitamente.

## Retorno compatible

- No bajar el esquema ni borrar catálogo, políticas, devices o ledger 013. El CHECK anterior no puede restaurarse si ya hay códigos nuevos; tampoco falsear el ledger/checksum.
- Para revertir aplicación, primero volver al artefacto Horneo anterior mientras Backend aún sirve el contrato ampliado; después, si necesario, volver al Backend c2257af. Esto evita Horneo nuevo contra Backend antiguo sin `type_policy`.
- Mantener 013 y sus triggers: Backend anterior sigue funcionando con legacy y los B5 existentes, pero altas/cambios pueden rechazarse por política. Suspender gestión técnica de altas/reasignaciones/cambios de tipo durante ese retorno: UI/API anteriores tienen enum fijo y no gestionan políticas ni códigos nuevos. No editar un tipo nuevo con ese formulario ni convertirlo a unknown.
- Para recuperar gestión completa, reinstalar el artefacto compatible; el runner reconocerá checksum 013 y no reaplicará. Si se necesita retorno de esquema, requiere propuesta separada, inventario y pruebas; no hay migración destructiva de down en esta entrega.
- Verificar pasivamente recepción y estados, no alarmas/configuración física. La falta de política nunca se trata como autorización; errores recuperables no se convierten en falso inventario vacío.

## Pruebas y límites

- Typecheck/build de Backend y Horneo en directorios nuevos; se conserva `dist` no versionado preexistente. Ninguna dependencia o lockfile añadido/modificado.
- Suites Backend/Horneo: autorización HTTP local con JWT ficticio y pool simulado; catálogo/selecciones, duplicados, código inmutable, auditoría/rollback/503, estados auxiliares, B5 existente y eventos con catálogo inactivo, tipo nuevo incompatible y política ausente/rechazada. Backend: 246 pruebas, 241 aprobadas, 0 fallidas, 5 omitidas. Horneo: 158 pruebas, 156 aprobadas, 0 fallidas, 2 omitidas. Typecheck y build de ambos correctos. Las omisiones corresponden a pruebas opt-in de base de datos y no acreditan su resultado.
- `deviceTypes.postgres.test.ts` opt-in: exige PostgreSQL 15, URL loopback y nombre acabado `_isolated_test`, flag explícito `DEVICE_TYPES_ALLOW_DATABASE_TESTS=true`; crea/elimina solo schema UUID propio. Verifica migración+checksum/rearranque, filas/historial intactos, referencias, selección vacía, dispositivos inactivos, unicidad, desactivación y carrera asignación/retirada. **Ejecución real comunicada por el usuario en staging aislado: 1 aprobada, 0 fallidas, 0 omitidas**; no repetida localmente.
- Navegador real local con Playwright: **184 comprobaciones** de páginas autorizadas por cinco roles a 390/768/1000/1440; cero fallos, sin scroll horizontal global y sección actual marcada. Menú click/Escape y foco de retorno; catálogo y selección con B5 marcado/sensor inactivo deshabilitado. Los fixtures no autorizan nada en servidor: roles/aislamiento se prueban por HTTP aparte.
- Un primer recorrido intentó exigir aria-current en Compañías para USER (destino no autorizado/no incluido); se corrigió la matriz del test, no los permisos. Una prueba textual de enlace anterior se adaptó a navegación compartida y se mantiene prueba ejecutable del menú.
- No se certifica lector de pantalla completo ni un despliegue real. No se ejecuta PostgreSQL compartido, servidor externo, MQTT/hardware, emails, push, merge ni despliegue. Las pruebas de protocolos existentes usan simulaciones.

## Validación adicional del bootstrap (02-10-2026)

Solo cambian el harness y sus contratos/documentación. La prueba actualizada exige:

- Sin selección: error de política concreto, rollback de inventario completo (incluidas gateways insertadas antes del fallo), sin concesiones automáticas ni cambios del overlay/históricos.
- Selección explícita `tag` en fixture: 5 gateways, 13 dispositivos `tag`, 12 activos y 1 inactivo. Los modelos/estados originales de Horneo no cambian ni se convierten en B5.
- Segunda ejecución: mismas filas completas, IDs, tipos, estados e históricos. Un registro central de historial no vacío acredita la conservación, además del histórico Horneo ya existente.
- Conflicto de estado y duplicación de identidad de origen: rechazo sin alterar filas; runner posterior conserva inventario e historial.
- Ledger completo y checksums actuales; repetición sin reaplicar ni modificar `applied_at`. Sin expectativa fija de 11 migraciones ni mensaje engañoso de 24 comprobaciones.

Validación local: **18/18 pruebas contractuales**, **51/51 comprobaciones de artefactos**, comprobación de sintaxis y diff correctos. No se ha ejecutado el harness PostgreSQL real localmente ni se ha iniciado Docker. Backend/Horneo no cambian en esta entrega; el usuario comunica sus suites anteriores con 241 y 156 aprobadas respectivamente, sin fallos.

**No considerar la rama desplegable hasta ejecutar el harness actualizado contra PostgreSQL 15 desechable y revisar la secuencia/retorno.**
