-- Restaura la configuración comercial vigente después de las migraciones 007 y 011.
-- Los precios siguen siendo editables desde PostgreSQL tras aplicar esta corrección inicial.
UPDATE store.saas_plans AS plan
SET annual_price_cents = current_pricing.annual_price_cents,
    is_enterprise = false,
    updated_at = now()
FROM (VALUES
  ('starter', 60000),
  ('professional', 90000),
  ('enterprise', 120000)
) AS current_pricing(code, annual_price_cents)
WHERE plan.code = current_pricing.code
  AND (plan.annual_price_cents IS DISTINCT FROM current_pricing.annual_price_cents
       OR plan.is_enterprise IS DISTINCT FROM false);
