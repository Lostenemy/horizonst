-- Extiende las lecturas observadas sin modificar las restricciones históricas.
ALTER TABLE hardware_gateway_reads DROP CONSTRAINT hardware_gateway_reads_msg_type_check;
ALTER TABLE hardware_gateway_reads ADD CONSTRAINT hardware_gateway_reads_msg_type_check CHECK (
  (msg_id = 2002 AND read_type = 'gateway_identity') OR
  (msg_id = 2011 AND read_type = 'led_state') OR
  (msg_id = 2030 AND read_type = 'mqtt_configuration') OR
  (msg_id = 2040 AND read_type = 'ble_scan_switch') OR
  (msg_id = 2041 AND read_type = 'filter_relation') OR
  (msg_id = 2053 AND read_type = 'bxp_button_filter') OR
  (msg_id = 2057 AND read_type = 'duplicate_rule') OR
  (msg_id = 2063 AND read_type = 'ble_report_interval') OR
  (msg_id = 2201 AND read_type = 'ble_connected_devices')
);

ALTER TABLE hardware_gateway_observed_settings DROP CONSTRAINT hardware_gateway_observed_settings_read_type_check;
ALTER TABLE hardware_gateway_observed_settings ADD CONSTRAINT hardware_gateway_observed_settings_read_type_check CHECK (
  read_type IN ('led_state', 'ble_scan_switch', 'filter_relation', 'duplicate_rule', 'bxp_button_filter', 'ble_report_interval')
);
ALTER TABLE hardware_gateway_observed_settings DROP CONSTRAINT hardware_gateway_observed_settings_msg_type_check;
ALTER TABLE hardware_gateway_observed_settings ADD CONSTRAINT hardware_gateway_observed_settings_msg_type_check CHECK (
  (msg_id = 2011 AND read_type = 'led_state') OR
  (msg_id = 2040 AND read_type = 'ble_scan_switch') OR
  (msg_id = 2041 AND read_type = 'filter_relation') OR
  (msg_id = 2053 AND read_type = 'bxp_button_filter') OR
  (msg_id = 2057 AND read_type = 'duplicate_rule') OR
  (msg_id = 2063 AND read_type = 'ble_report_interval')
);

-- Preserva exactamente la validación anterior y añade dos esquemas cerrados.
DO $migration$
DECLARE previous_check text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO STRICT previous_check
  FROM pg_constraint
  WHERE conrelid = 'hardware_gateway_observed_settings'::regclass
    AND conname = 'hardware_gateway_observed_settings_value_check';
  ALTER TABLE hardware_gateway_observed_settings DROP CONSTRAINT hardware_gateway_observed_settings_value_check;
  EXECUTE format($check$
    ALTER TABLE hardware_gateway_observed_settings ADD CONSTRAINT hardware_gateway_observed_settings_value_check CHECK (
      (%s) OR
      (read_type = 'ble_report_interval' AND jsonb_typeof(observed_value) = 'object'
       AND observed_value ? 'interval' AND observed_value - ARRAY['interval']::text[] = '{}'::jsonb
       AND jsonb_typeof(observed_value->'interval') = 'number'
       AND observed_value->>'interval' ~ '^(0|[1-9][0-9]{0,4})$'
       AND (observed_value->>'interval')::integer BETWEEN 0 AND 86400) OR
      (read_type = 'bxp_button_filter' AND jsonb_typeof(observed_value) = 'object'
       AND observed_value ?& ARRAY['switch_value','single_press','double_press','long_press','abnormal_inactivity']
       AND observed_value - ARRAY['switch_value','single_press','double_press','long_press','abnormal_inactivity']::text[] = '{}'::jsonb
       AND jsonb_typeof(observed_value->'switch_value') = 'number' AND observed_value->>'switch_value' IN ('0','1')
       AND jsonb_typeof(observed_value->'single_press') = 'number' AND observed_value->>'single_press' IN ('0','1')
       AND jsonb_typeof(observed_value->'double_press') = 'number' AND observed_value->>'double_press' IN ('0','1')
       AND jsonb_typeof(observed_value->'long_press') = 'number' AND observed_value->>'long_press' IN ('0','1')
       AND jsonb_typeof(observed_value->'abnormal_inactivity') = 'number' AND observed_value->>'abnormal_inactivity' IN ('0','1'))
    )$check$, previous_check);
END
$migration$;
