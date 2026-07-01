export type Role = 'customer' | 'distributor' | 'admin';

export type User = {
  id: string;
  email: string;
  full_name: string;
  phone?: string | null;
  role: Role;
  status: string;
  created_at?: string;
  last_login_at?: string | null;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  price_cents: number | null;
  tax_rate: string | number;
  is_active: boolean;
};

export type SaasPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  annual_price_cents: number | null;
  tax_rate: string | number;
  max_tags: number | null;
  max_gateways: number | null;
  is_enterprise: boolean;
  is_active: boolean;
};

export type Quote = {
  id: string;
  user_id: string;
  quote_number: string;
  status: 'draft' | 'submitted' | 'in_review' | 'sent' | 'accepted' | 'rejected' | 'cancelled';
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  submitted_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
};

export type CartItem = {
  id: string;
  quote_id: string;
  item_type: 'product' | 'saas_plan';
  product_id: string | null;
  saas_plan_id: string | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  discount_percent: string | number;
  tax_rate: string | number;
  line_subtotal_cents: number;
  line_discount_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
};

export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';

export type Order = {
  id: string;
  quote_id: string;
  user_id?: string;
  quote_number: string;
  order_number: string;
  status: OrderStatus;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  customer_notes?: string | null;
  created_at: string;
  updated_at?: string;
};

export type OrderItem = Omit<CartItem, 'quote_id'> & { order_id: string; source_quote_item_id: string | null; item_type: 'product' | 'saas_plan' | 'custom'; unit_price_cents: number | null };

export type OrdersResponse = { orders: Order[] };
export type OrderDetailResponse = { order: Order; items: OrderItem[] };

export type AdminOrder = Order & { user_id: string; email: string; full_name: string; role: Role };
export type AdminOrdersResponse = { orders: AdminOrder[] };
export type AdminOrderDetailResponse = { order: AdminOrder; items: OrderItem[] };

export type Cart = {
  quote: Quote;
  items: CartItem[];
};

export type CustomerProfile = User & {
  company_name?: string | null;
  tax_id?: string | null;
  billing_address?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export type DistributorProfile = {
  user_id: string;
  email: string;
  full_name: string;
  phone?: string | null;
  role: 'distributor';
  user_status: string;
  distributor_profile_id: string;
  company_name: string;
  tax_id: string;
  billing_address?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  website?: string | null;
  contact_person?: string | null;
  validation_status: string;
  review_notes?: string | null;
  discount_percent?: string | number | null;
};

export type DistributorDocument = {
  id: string;
  document_type: string;
  status: string;
  created_at: string;
};
