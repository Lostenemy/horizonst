CREATE TABLE IF NOT EXISTS store.packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  presentation_order INTEGER NOT NULL DEFAULT 0 CHECK (presentation_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.pack_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES store.packs(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES store.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  presentation_order INTEGER NOT NULL DEFAULT 0 CHECK (presentation_order >= 0),
  UNIQUE (pack_id, product_id)
);

ALTER TABLE store.quote_items ADD COLUMN IF NOT EXISTS pack_id UUID REFERENCES store.packs(id) ON DELETE RESTRICT;
ALTER TABLE store.order_items ADD COLUMN IF NOT EXISTS pack_id UUID REFERENCES store.packs(id) ON DELETE RESTRICT;
ALTER TABLE store.leads ADD COLUMN IF NOT EXISTS privacy_accepted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE store.leads ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

ALTER TABLE store.quote_items DROP CONSTRAINT IF EXISTS quote_item_product_or_plan_check;
ALTER TABLE store.order_items DROP CONSTRAINT IF EXISTS order_item_product_or_plan_check;
ALTER TABLE store.quote_items DROP CONSTRAINT IF EXISTS quote_items_item_type_check;
ALTER TABLE store.order_items DROP CONSTRAINT IF EXISTS order_items_item_type_check;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_item_product_plan_or_pack_check' AND conrelid = 'store.quote_items'::regclass) THEN
    ALTER TABLE store.quote_items ADD CONSTRAINT quote_item_product_plan_or_pack_check CHECK (
      (item_type = 'product' AND product_id IS NOT NULL AND saas_plan_id IS NULL AND pack_id IS NULL) OR
      (item_type = 'saas_plan' AND product_id IS NULL AND saas_plan_id IS NOT NULL AND pack_id IS NULL) OR
      (item_type = 'pack' AND product_id IS NULL AND saas_plan_id IS NULL AND pack_id IS NOT NULL) OR
      (item_type = 'custom' AND product_id IS NULL AND saas_plan_id IS NULL AND pack_id IS NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_item_type_check' AND conrelid = 'store.quote_items'::regclass) THEN
    ALTER TABLE store.quote_items ADD CONSTRAINT quote_items_item_type_check CHECK (item_type IN ('product', 'saas_plan', 'pack', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_product_plan_or_pack_check' AND conrelid = 'store.order_items'::regclass) THEN
    ALTER TABLE store.order_items ADD CONSTRAINT order_item_product_plan_or_pack_check CHECK (
      (item_type = 'product' AND product_id IS NOT NULL AND saas_plan_id IS NULL AND pack_id IS NULL) OR
      (item_type = 'saas_plan' AND product_id IS NULL AND saas_plan_id IS NOT NULL AND pack_id IS NULL) OR
      (item_type = 'pack' AND product_id IS NULL AND saas_plan_id IS NULL AND pack_id IS NOT NULL) OR
      (item_type = 'custom' AND product_id IS NULL AND saas_plan_id IS NULL AND pack_id IS NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_item_type_check' AND conrelid = 'store.order_items'::regclass) THEN
    ALTER TABLE store.order_items ADD CONSTRAINT order_items_item_type_check CHECK (item_type IN ('product', 'saas_plan', 'pack', 'custom'));
  END IF;
END $$;

UPDATE store.products SET name = 'Antenas y accesorios de instalación', updated_at = now() WHERE sku = 'gateway_antenna';
UPDATE store.products SET name = 'Inyector PoE de alimentación', updated_at = now() WHERE sku = 'poe_power_supply';
UPDATE store.products SET name = 'Tag BLE personal con alarma', updated_at = now() WHERE sku = 'tag_ble';
UPDATE store.saas_plans SET annual_price_cents = 120000, is_enterprise = false, updated_at = now() WHERE code = 'enterprise';

INSERT INTO store.packs (code, name, description, price_cents, tax_rate, presentation_order)
VALUES
  ('starter', 'PACK Starter', 'Pack inicial para operaciones con hasta 5 gateways y 10 tags.', 325000, 21.00, 1),
  ('professional', 'PACK Professional', 'Pack para operaciones con hasta 10 gateways y 20 tags.', 650000, 21.00, 2),
  ('enterprise', 'PACK Enterprise', 'Pack para operaciones ampliadas con 20 gateways y 40 tags.', 1299500, 21.00, 3)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, price_cents = EXCLUDED.price_cents, tax_rate = EXCLUDED.tax_rate, presentation_order = EXCLUDED.presentation_order, is_active = true, updated_at = now();

INSERT INTO store.pack_items (pack_id, product_id, quantity, presentation_order)
SELECT pack.id, product.id, composition.quantity, composition.presentation_order
FROM (VALUES
  ('starter', 'gateway_ble', 5, 1), ('starter', 'gateway_antenna', 5, 2), ('starter', 'poe_power_supply', 1, 3), ('starter', 'tag_ble', 10, 4),
  ('professional', 'gateway_ble', 10, 1), ('professional', 'gateway_antenna', 10, 2), ('professional', 'poe_power_supply', 2, 3), ('professional', 'tag_ble', 20, 4),
  ('enterprise', 'gateway_ble', 20, 1), ('enterprise', 'gateway_antenna', 20, 2), ('enterprise', 'poe_power_supply', 4, 3), ('enterprise', 'tag_ble', 40, 4)
) AS composition(pack_code, product_sku, quantity, presentation_order)
JOIN store.packs pack ON pack.code = composition.pack_code
JOIN store.products product ON product.sku = composition.product_sku
ON CONFLICT (pack_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity, presentation_order = EXCLUDED.presentation_order;

CREATE INDEX IF NOT EXISTS store_packs_active_order_idx ON store.packs (is_active, presentation_order);
CREATE INDEX IF NOT EXISTS store_pack_items_pack_id_idx ON store.pack_items (pack_id);
CREATE INDEX IF NOT EXISTS store_quote_items_pack_id_idx ON store.quote_items (pack_id) WHERE pack_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS store_order_items_pack_id_idx ON store.order_items (pack_id) WHERE pack_id IS NOT NULL;
