-- Una observación 2053 no debe reutilizarse tras iniciar una escritura 1053,
-- incluso si el resultado del envío es incierto. El diario original se conserva.
CREATE TABLE hardware_b5_filter_observation_uses (
  read_id UUID PRIMARY KEY REFERENCES hardware_gateway_reads(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE hardware_b5_filter_observation_uses IS
  'Reserva durable de una lectura 2053 para impedir reenvíos ciegos; no prueba publicación ni ACK.';
