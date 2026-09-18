-- Estado explícito para ACK con result_code=0 cuya solicitud no puede correlacionarse.
-- No altera filas existentes ni elimina los timed_out históricos.
ALTER TABLE hardware_gateway_commands
  DROP CONSTRAINT hardware_gateway_commands_status_check;

ALTER TABLE hardware_gateway_commands
  ADD CONSTRAINT hardware_gateway_commands_status_check CHECK (
    status IN ('pending', 'published', 'ack_success', 'ack_ambiguous', 'ack_error', 'timed_out', 'publish_error')
  );

COMMENT ON COLUMN hardware_gateway_commands.status IS
  'ack_ambiguous: ACK positivo sin correlación inequívoca tras timeout previo; ack_error: rechazo explícito de la gateway.';
