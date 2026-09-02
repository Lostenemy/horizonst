# Hardware Manager — Fase C

## Alcance

La Fase C centraliza el inventario técnico de los B5 de Horneo en `horizonst.devices`, sin mover ni sustituir la identidad operativa de `cold_compliance.tags`. No despliega migraciones, no aplica la reconciliación y no cambia MQTT, alarmas B5 ni presencia.

## Dos identidades complementarias

`devices.id` es la identidad técnica central del hardware y `tags.id` continúa siendo el UUID operativo interno de Horneo. El UUID local sigue referenciado por sesiones, asignaciones de trabajadores, alertas, incidentes, comandos, sesiones BLE y estado de presencia.

La migración `015_hardware_device_reference.sql` añade `tags.hardware_device_id`. Es una referencia lógica nullable a `horizonst.devices.id`, con un índice único parcial. No existe una clave foránea SQL porque las tablas viven en bases PostgreSQL independientes. La migración no rellena enlaces automáticamente ni modifica relaciones existentes.

Los tiempos de seguimiento y actuación física (`physical_alarm_followup_delay_ms`, `physical_alarm_buzzer_duration_ms` y `physical_alarm_vibration_duration_ms`) permanecen locales.

## Reconciliación

El comando compilado es:

```text
npm run reconcile:horneo-devices
```

Su modo predeterminado es exclusivamente informativo. Lee las dos bases y presenta recuentos, conflictos, diferencias de propiedades y acciones planificadas. Solo `--apply` habilita escrituras.

Las MAC se comparan mediante `normalizeMacAddress()`: doce hexadecimales en mayúsculas, sin depender de separadores o formato. Una coincidencia central sin empresa se reutiliza y se asigna a Horneo durante `--apply`; una coincidencia ya perteneciente a Horneo también se reutiliza. Una propiedad ajena, referencias huérfanas o incoherentes, duplicados, MAC inválidas y estados operativos que requieren decisión detienen toda aplicación.

En particular, el device central `id=1`, MAC `DF9DDAA7EAB3`, se planifica como reutilización: no se crea un duplicado. Al aplicar debe quedar asignado a la empresa `horneo`, con tipo `b5`, activo y estado `active`. Las diferencias descriptivas de nombre o modelo se informan, pero no fuerzan un conflicto ni reemplazan el texto central.

La aplicación usa primero una transacción en la base central y después otra transacción en Horneo para guardar los enlaces. No existe una transacción distribuida real entre ambas bases. Si la segunda transacción falla después del commit central, el procedimiento operativo es corregir la causa y repetir primero en modo informe; la naturaleza idempotente permite completar los enlaces pendientes sin duplicar devices. Para revertir, debe prepararse y revisarse una operación específica: no se incluyen borrados ni rollback automático destructivo.

## API interna y aislamiento

La API service-to-service existente expone:

```text
GET /api/internal/v1/hardware/devices
GET /api/internal/v1/hardware/devices/:id
GET /api/internal/v1/hardware/devices/by-mac/:mac
```

Utiliza el mismo service principal con scope `hardware.read`. El consumidor no puede escoger `company_id`: todas las consultas lo obtienen del principal autenticado y lo aplican en SQL. Un id o una MAC perteneciente a otra empresa responde `404`, evitando revelar su existencia. El listado incluye exclusivamente devices de la empresa del principal, incluidos los inactivos para permitir diagnosticar divergencias operativas.

## Dual-read de Horneo

Con `HARDWARE_MANAGER_ENABLED=true`, el cliente de tags intenta primero `hardware_device_id` y, si no resuelve, busca la MAC canónica. La respuesta indica una fuente:

- `central`: se obtuvo el inventario técnico central;
- `local_fallback`: el central no existe o no está disponible;
- `local_disabled`: la integración está desactivada.

Se informan divergencias de enlace, MAC, `active`, `status` y `device_type`. Nombre y modelo son descriptivos y no se tratan como fallo duro. El fallback conserva el tag local completo, incluidos sus parámetros operativos de alarma.

El endpoint autenticado `GET /tags/:id/hardware-resolution` es solo de diagnóstico. Lee el tag y consulta la API central; no actualiza bases, no publica MQTT, no inicia BLE y no activa buzzer, vibración, LED ni GATT.

## Transición y fases posteriores

Durante la Fase C continúan disponibles los endpoints heredados `POST /tags`, `PATCH /tags/:id` y `DELETE /tags/:id`. No sincronizan automáticamente el inventario central para evitar altas inseguras o duplicadas. Una fase posterior deberá definir la autoridad de escritura definitiva, el alta coordinada y la eventual retirada del CRUD técnico local. También queda pendiente decidir si algún atributo operativo adicional se centraliza; las relaciones y temporizaciones de Horneo no forman parte de esta migración.
