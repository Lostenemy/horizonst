-- Restaura la regla comercial sobrescrita por 007_hardware_packs.sql.
-- El plan web Enterprise requiere presupuesto manual y nunca tiene precio automático.
UPDATE store.saas_plans
SET annual_price_cents = NULL,
    is_enterprise = true,
    updated_at = now()
WHERE code = 'enterprise'
  AND (annual_price_cents IS NOT NULL OR is_enterprise IS DISTINCT FROM true);
