CREATE TABLE IF NOT EXISTS tag_command_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  channels JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tag_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID REFERENCES workers(id),
  tag_id UUID NOT NULL REFERENCES tags(id),
  gateway_id UUID REFERENCES gateways(id),
  command_type TEXT NOT NULL,
  template_code TEXT,
  trigger_source TEXT NOT NULL,
  trigger_reason TEXT,
  msg_id INT NOT NULL,
  topic TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retries_count INT NOT NULL DEFAULT 0,
  timeout_ms INT NOT NULL,
  dedup_key TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tag_commands_status_created ON tag_commands(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tag_commands_msgid_gateway ON tag_commands(msg_id, gateway_id);
CREATE INDEX IF NOT EXISTS idx_tag_commands_dedup ON tag_commands(dedup_key, created_at DESC);

CREATE TABLE IF NOT EXISTS tag_command_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_command_id UUID NOT NULL REFERENCES tag_commands(id) ON DELETE CASCADE,
  attempt_no INT NOT NULL,
  topic TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  UNIQUE(tag_command_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS tag_command_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_command_id UUID NOT NULL REFERENCES tag_commands(id) ON DELETE CASCADE,
  gateway_mac TEXT NOT NULL,
  msg_id INT NOT NULL,
  result_code INT,
  result_msg TEXT,
  response_payload_json JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tag_command_responses_cmd ON tag_command_responses(tag_command_id, received_at DESC);

INSERT INTO tag_command_templates(code, name, description, channels)
VALUES
  ('pre_limit', 'Pre-límite T+40', 'Aviso preventivo de salida próxima', '{"vibration":{"state":1,"intensity":70,"duration":1500},"led":{"state":1,"duration":2000}}'::jsonb),
  ('critical', 'Límite excedido T+45', 'Alerta crítica por sobreexposición', '{"buzzer":{"state":1,"frequency":2200,"duration":2500},"vibration":{"state":1,"intensity":100,"duration":2500},"led":{"state":1,"duration":3000}}'::jsonb),
  ('early_reentry_blocked', 'Reentrada no permitida', 'Aviso por descanso insuficiente', '{"vibration":{"state":1,"intensity":80,"duration":1200},"led":{"state":1,"duration":1200}}'::jsonb),
  ('man_down', 'Hombre muerto', 'Alerta de emergencia por inmovilidad', '{"buzzer":{"state":1,"frequency":2500,"duration":4000},"vibration":{"state":1,"intensity":100,"duration":4000},"led":{"state":1,"duration":5000}}'::jsonb)
ON CONFLICT (code) DO NOTHING;
