ALTER TABLE store.distributor_documents
  DROP CONSTRAINT IF EXISTS distributor_documents_document_type_check;

ALTER TABLE store.distributor_documents
  ADD CONSTRAINT distributor_documents_document_type_check CHECK (document_type IN (
    'tax_id', 'census_registration', 'company_registration', 'business_registration', 'business_activity',
    'certificado_censal', 'modelo_036', 'modelo_037', 'cif_empresa', 'certificado_autonomo', 'escrituras', 'otro'
  ));

UPDATE store.saas_plans
SET description = CASE code
      WHEN 'starter' THEN 'Gestión básica para pequeñas instalaciones y primeros despliegues.'
      WHEN 'professional' THEN 'Gestión avanzada para operaciones con mayor volumen y varios puntos de control.'
      WHEN 'enterprise' THEN 'Gestión escalable para grandes instalaciones, múltiples ubicaciones y necesidades personalizadas.'
      ELSE description
    END,
    max_tags = CASE code WHEN 'starter' THEN 10 WHEN 'enterprise' THEN 40 ELSE max_tags END,
    max_gateways = CASE code WHEN 'enterprise' THEN 20 ELSE max_gateways END,
    updated_at = now()
WHERE code IN ('starter', 'professional', 'enterprise')
  AND (
    description IS DISTINCT FROM CASE code
      WHEN 'starter' THEN 'Gestión básica para pequeñas instalaciones y primeros despliegues.'
      WHEN 'professional' THEN 'Gestión avanzada para operaciones con mayor volumen y varios puntos de control.'
      WHEN 'enterprise' THEN 'Gestión escalable para grandes instalaciones, múltiples ubicaciones y necesidades personalizadas.'
      ELSE description
    END
    OR (code = 'starter' AND max_tags IS DISTINCT FROM 10)
    OR (code = 'enterprise' AND (max_tags IS DISTINCT FROM 40 OR max_gateways IS DISTINCT FROM 20))
  );
