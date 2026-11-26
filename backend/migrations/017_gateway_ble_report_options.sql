-- Extiende las restricciones existentes sin alterar sus expresiones previas.
DO $migration$
DECLARE prior text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO STRICT prior FROM pg_constraint
    WHERE conrelid = 'hardware_gateway_reads'::regclass AND conname = 'hardware_gateway_reads_msg_type_check';
  ALTER TABLE hardware_gateway_reads DROP CONSTRAINT hardware_gateway_reads_msg_type_check;
  EXECUTE format('ALTER TABLE hardware_gateway_reads ADD CONSTRAINT hardware_gateway_reads_msg_type_check CHECK ((%s) OR (msg_id=2059 AND read_type=''ble_report_fields'') OR (msg_id=2065 AND read_type=''ble_parsing_options''))', prior);

  SELECT pg_get_expr(conbin, conrelid) INTO STRICT prior FROM pg_constraint
    WHERE conrelid = 'hardware_gateway_observed_settings'::regclass AND conname = 'hardware_gateway_observed_settings_read_type_check';
  ALTER TABLE hardware_gateway_observed_settings DROP CONSTRAINT hardware_gateway_observed_settings_read_type_check;
  EXECUTE format('ALTER TABLE hardware_gateway_observed_settings ADD CONSTRAINT hardware_gateway_observed_settings_read_type_check CHECK ((%s) OR read_type IN (''ble_report_fields'',''ble_parsing_options''))', prior);

  SELECT pg_get_expr(conbin, conrelid) INTO STRICT prior FROM pg_constraint
    WHERE conrelid = 'hardware_gateway_observed_settings'::regclass AND conname = 'hardware_gateway_observed_settings_msg_type_check';
  ALTER TABLE hardware_gateway_observed_settings DROP CONSTRAINT hardware_gateway_observed_settings_msg_type_check;
  EXECUTE format('ALTER TABLE hardware_gateway_observed_settings ADD CONSTRAINT hardware_gateway_observed_settings_msg_type_check CHECK ((%s) OR (msg_id=2059 AND read_type=''ble_report_fields'') OR (msg_id=2065 AND read_type=''ble_parsing_options''))', prior);

  SELECT pg_get_expr(conbin, conrelid) INTO STRICT prior FROM pg_constraint
    WHERE conrelid = 'hardware_gateway_observed_settings'::regclass AND conname = 'hardware_gateway_observed_settings_value_check';
  ALTER TABLE hardware_gateway_observed_settings DROP CONSTRAINT hardware_gateway_observed_settings_value_check;
  EXECUTE format($check$
    ALTER TABLE hardware_gateway_observed_settings ADD CONSTRAINT hardware_gateway_observed_settings_value_check CHECK (
      (%s) OR
      (read_type='ble_report_fields' AND jsonb_typeof(observed_value)='object'
       AND observed_value ?& ARRAY['timestamp','adv_data'] AND observed_value - ARRAY['timestamp','adv_data']::text[] = '{}'::jsonb
       AND jsonb_typeof(observed_value->'timestamp')='number' AND observed_value->>'timestamp' IN ('0','1')
       AND jsonb_typeof(observed_value->'adv_data')='number' AND observed_value->>'adv_data' IN ('0','1')) OR
      (read_type='ble_parsing_options' AND jsonb_typeof(observed_value)='object'
       AND observed_value ?& ARRAY['iBeacon_switch','eddystone_uid_switch','eddystone_tlm_switch','eddystone_url_switch','bxp_acc_switch','bxp_th_switch','bxp_devinfo_switch','bxp_button_switch','bxp_tag&sensor_switch','mk_pir_switch','mk_tof_switch','nanobeacon_info_switch']
       AND observed_value - ARRAY['iBeacon_switch','eddystone_uid_switch','eddystone_tlm_switch','eddystone_url_switch','bxp_acc_switch','bxp_th_switch','bxp_devinfo_switch','bxp_button_switch','bxp_tag&sensor_switch','mk_pir_switch','mk_tof_switch','nanobeacon_info_switch']::text[] = '{}'::jsonb
       AND jsonb_typeof(observed_value->'iBeacon_switch')='number' AND observed_value->>'iBeacon_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'eddystone_uid_switch')='number' AND observed_value->>'eddystone_uid_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'eddystone_tlm_switch')='number' AND observed_value->>'eddystone_tlm_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'eddystone_url_switch')='number' AND observed_value->>'eddystone_url_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'bxp_acc_switch')='number' AND observed_value->>'bxp_acc_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'bxp_th_switch')='number' AND observed_value->>'bxp_th_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'bxp_devinfo_switch')='number' AND observed_value->>'bxp_devinfo_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'bxp_button_switch')='number' AND observed_value->>'bxp_button_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'bxp_tag&sensor_switch')='number' AND observed_value->>'bxp_tag&sensor_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'mk_pir_switch')='number' AND observed_value->>'mk_pir_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'mk_tof_switch')='number' AND observed_value->>'mk_tof_switch' IN ('0','1')
       AND jsonb_typeof(observed_value->'nanobeacon_info_switch')='number' AND observed_value->>'nanobeacon_info_switch' IN ('0','1'))
    )$check$, prior);
END $migration$;

CREATE TABLE hardware_gateway_format_observation_uses (
  read_id UUID PRIMARY KEY REFERENCES hardware_gateway_reads(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
