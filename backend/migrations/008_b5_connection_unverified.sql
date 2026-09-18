-- 3151 no contiene identificador de intento: su recepción no prueba qué 1150 completó.
ALTER TABLE hardware_gateway_commands
  DROP CONSTRAINT hardware_gateway_commands_connection_state_check;

ALTER TABLE hardware_gateway_commands
  ADD CONSTRAINT hardware_gateway_commands_connection_state_check CHECK (
    connection_state IS NULL OR connection_state IN ('awaiting_report', 'established', 'rejected', 'timed_out', 'unverified')
  );

COMMENT ON COLUMN hardware_gateway_commands.connection_state IS
  'Estado BLE de 1150; unverified indica 3151 no atribuible inequívocamente al intento y no autoriza acciones físicas.';
