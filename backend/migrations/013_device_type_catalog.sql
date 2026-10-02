-- El runner ejecuta este archivo y su registro/checksum en una única transacción.
-- No modifica ninguna fila de devices ni sus referencias históricas.
LOCK TABLE devices, companies IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM devices WHERE device_type IS NULL
    OR device_type NOT IN ('tag','b5','sensor','beacon','unknown')) THEN
    RAISE EXCEPTION 'Device type preflight failed: review existing inventory before migration';
  END IF;
END $$;
CREATE TABLE device_types (
  code VARCHAR(32) PRIMARY KEY CHECK(code ~ '^[a-z][a-z0-9_]{0,31}$'),
  name VARCHAR(160) NOT NULL CHECK(length(btrim(name)) > 0),
  description VARCHAR(2000) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO device_types(code,name) VALUES
  ('tag','Tag'),('b5','B5'),('sensor','Sensor'),('beacon','Beacon'),('unknown','Desconocido');
CREATE TABLE company_device_types (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  type_code VARCHAR(32) NOT NULL REFERENCES device_types(code) ON DELETE RESTRICT,
  PRIMARY KEY(company_id,type_code)
);
-- Incluye compañías/dispositivos inactivos; ninguna selección implica todos.
INSERT INTO company_device_types(company_id,type_code)
SELECT DISTINCT company_id,device_type FROM devices WHERE company_id IS NOT NULL;
ALTER TABLE devices DROP CONSTRAINT devices_device_type_check;
ALTER TABLE devices ADD CONSTRAINT devices_device_type_fk
  FOREIGN KEY(device_type) REFERENCES device_types(code) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION enforce_device_type_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.device_type IS NOT DISTINCT FROM OLD.device_type
      AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN RETURN NEW; END IF;
  END IF;
  -- Mismo cerrojo que cambios de selección. Releer después de adquirirlo.
  IF NEW.company_id IS NOT NULL THEN
    PERFORM 1 FROM companies WHERE id=NEW.company_id AND active=TRUE FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Company is not active' USING ERRCODE='23514'; END IF;
  END IF;
  PERFORM 1 FROM device_types WHERE code=NEW.device_type AND active=TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device type is unknown or inactive' USING ERRCODE='23514'; END IF;
  IF NEW.company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_device_types WHERE company_id=NEW.company_id AND type_code=NEW.device_type
  ) THEN RAISE EXCEPTION 'Device type is not permitted for company' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER devices_type_assignment BEFORE INSERT OR UPDATE OF device_type,company_id ON devices
  FOR EACH ROW EXECUTE FUNCTION enforce_device_type_assignment();

CREATE FUNCTION enforce_company_device_type_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company UUID; kind TEXT;
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Policy keys are immutable; use explicit removal and insertion' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN company := OLD.company_id; kind := OLD.type_code;
  ELSE company := NEW.company_id; kind := NEW.type_code; END IF;
  PERFORM 1 FROM companies WHERE id=company FOR UPDATE;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM devices WHERE company_id=company AND device_type=kind) THEN
      RAISE EXCEPTION 'Type still assigned to company devices, including inactive devices' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM 1 FROM device_types WHERE code=kind AND active=TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cannot select unknown or inactive type' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_device_types_change BEFORE INSERT OR UPDATE OR DELETE ON company_device_types
  FOR EACH ROW EXECUTE FUNCTION enforce_company_device_type_change();
CREATE FUNCTION preserve_device_type_code() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Deactivate types instead of deleting' USING ERRCODE='23514'; END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Technical type codes are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER device_types_preserve BEFORE UPDATE OR DELETE ON device_types
  FOR EACH ROW EXECUTE FUNCTION preserve_device_type_code();

-- Autorizar compañía NO otorga protocolo B5. Inactividad del catálogo no revoca
-- operaciones existentes; active/status del dispositivo se verifican aparte.
CREATE FUNCTION hardware_device_policy(kind TEXT, company UUID) RETURNS JSONB
LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
   'known', EXISTS(SELECT 1 FROM device_types WHERE code=kind),
   'typeActive', EXISTS(SELECT 1 FROM device_types WHERE code=kind AND active),
   'companyAllowed', company IS NOT NULL AND EXISTS(
     SELECT 1 FROM company_device_types WHERE company_id=company AND type_code=kind),
   'horneoCompatible', kind='b5' AND EXISTS(SELECT 1 FROM device_types WHERE code=kind)
 )
$$;
COMMENT ON TABLE device_types IS 'Tipo técnico estable; no es categoría ni modelo observado. Baja lógica, sin revocación de dispositivos existentes.';
COMMENT ON TABLE company_device_types IS 'Selección vacía: ningún tipo. Retirada bloqueada con cualquier dispositivo asignado, incluso inactivo.';
