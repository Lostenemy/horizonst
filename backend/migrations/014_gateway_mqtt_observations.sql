-- El runner versionado aplica esta migración dentro de una transacción.
-- 2030 es observación sin correlación inequívoca; nunca almacena passwd.
ALTER TABLE hardware_gateway_reads DROP CONSTRAINT hardware_gateway_reads_msg_type_check;
ALTER TABLE hardware_gateway_reads ADD CONSTRAINT hardware_gateway_reads_msg_type_check CHECK (
  (msg_id = 2002 AND read_type = 'gateway_identity') OR
  (msg_id = 2011 AND read_type = 'led_state') OR
  (msg_id = 2030 AND read_type = 'mqtt_configuration') OR
  (msg_id = 2040 AND read_type = 'ble_scan_switch') OR
  (msg_id = 2041 AND read_type = 'filter_relation') OR
  (msg_id = 2057 AND read_type = 'duplicate_rule') OR
  (msg_id = 2201 AND read_type = 'ble_connected_devices')
);
CREATE TABLE hardware_gateway_mqtt_observations (
  gateway_id INTEGER PRIMARY KEY,
  company_id UUID NOT NULL,
  public_value JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (gateway_id, company_id) REFERENCES gateways(id, company_id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(public_value) = 'object'
    AND public_value ?& ARRAY['security_type','host','port','client_id','username','sub_topic','pub_topic','qos','clean_session','keepalive','lwt_en','lwt_qos','lwt_retain','lwt_topic','lwt_payload']
    AND public_value - ARRAY['security_type','host','port','client_id','username','sub_topic','pub_topic','qos','clean_session','keepalive','lwt_en','lwt_qos','lwt_retain','lwt_topic','lwt_payload']::text[] = '{}'::jsonb)
);
COMMENT ON TABLE hardware_gateway_mqtt_observations IS
  'Última configuración MQTT pública recibida; observed_at es recepción, no prueba de frescura ni conexión. Sin contraseña, hashes o huellas.';
