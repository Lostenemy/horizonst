CREATE TABLE IF NOT EXISTS store.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL UNIQUE REFERENCES store.quotes(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES store.users(id) ON DELETE RESTRICT,
  order_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  customer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES store.orders(id) ON DELETE RESTRICT,
  source_quote_item_id UUID REFERENCES store.quote_items(id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL CHECK (item_type IN ('product', 'saas_plan', 'custom')),
  product_id UUID REFERENCES store.products(id) ON DELETE RESTRICT,
  saas_plan_id UUID REFERENCES store.saas_plans(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  discount_percent NUMERIC(5,2) NOT NULL CHECK (discount_percent BETWEEN 0 AND 100),
  tax_rate NUMERIC(5,2) NOT NULL,
  line_subtotal_cents INTEGER NOT NULL CHECK (line_subtotal_cents >= 0),
  line_discount_cents INTEGER NOT NULL CHECK (line_discount_cents >= 0),
  line_tax_cents INTEGER NOT NULL CHECK (line_tax_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  CONSTRAINT order_item_product_or_plan_check CHECK (
    (item_type = 'product' AND product_id IS NOT NULL AND saas_plan_id IS NULL) OR
    (item_type = 'saas_plan' AND saas_plan_id IS NOT NULL AND product_id IS NULL) OR
    (item_type = 'custom' AND product_id IS NULL AND saas_plan_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS store_orders_user_id_idx ON store.orders (user_id);
CREATE INDEX IF NOT EXISTS store_orders_status_idx ON store.orders (status);
CREATE INDEX IF NOT EXISTS store_orders_created_at_idx ON store.orders (created_at);
CREATE INDEX IF NOT EXISTS store_order_items_order_id_idx ON store.order_items (order_id);
