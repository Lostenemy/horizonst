-- El alta técnica puede preceder a la asignación de empresa. Solo los comandos
-- MQTT de puesta en marcha, emitidos por un usuario global, admiten compañía nula.
-- El gateway_id conserva la trazabilidad; los diarios históricos no se reescriben.
ALTER TABLE hardware_gateway_commands
  ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE hardware_gateway_commands
  ADD CONSTRAINT hardware_gateway_commands_unassigned_check CHECK (
    company_id IS NOT NULL OR
    (actor_type = 'user' AND (
      (command_type = 'mqtt_connection_1030' AND msg_id = 1030) OR
      (command_type = 'gateway_restart_1000' AND msg_id = 1000)
    ))
  );

-- El índice anterior usa company_id y PostgreSQL considera distintos los NULL.
-- Esta clave mantiene la idempotencia de los comandos previos a la asignación.
CREATE UNIQUE INDEX uq_hardware_gateway_commands_unassigned_idempotency
  ON hardware_gateway_commands(gateway_id, idempotency_key)
  WHERE company_id IS NULL AND idempotency_key IS NOT NULL;

COMMENT ON COLUMN hardware_gateway_commands.company_id IS
  'Compañía en el momento del comando; NULL solo para puesta en marcha 1030/1000 antes de asignar. No se reescribe al asignar.';
