import type { Product, SaasPlan, Quote, CartItem } from '../../lib/types';

export type AuditPayload = string | number | boolean | null | AuditPayload[] | { [key: string]: AuditPayload };

export type AuditEvent = {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_full_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: AuditPayload;
  created_at: string;
};

export type DashboardMetrics = {
  customers_registered: number;
  distributors_pending: number;
  distributors_approved: number;
  quotes_submitted: number;
  quotes_in_review: number;
  quotes_sent: number;
  quotes_accepted: number;
  open_value_cents: number;
  accepted_value_cents: number;
};

export type DashboardQuote = Pick<Quote, 'id' | 'quote_number' | 'status' | 'total_cents' | 'created_at'> & { email: string };

export type DashboardDistributor = {
  id: string;
  company_name: string;
  validation_status: DistributorStatus;
  created_at: string;
  email: string;
};

export type DashboardResponse = {
  metrics: DashboardMetrics;
  latestAudit: Pick<AuditEvent, 'id' | 'action' | 'entity_type' | 'entity_id' | 'created_at' | 'actor_email'>[];
  latestQuotes: DashboardQuote[];
  latestDistributors: DashboardDistributor[];
};

export type DistributorStatus = 'pending' | 'needs_more_info' | 'approved' | 'rejected' | 'suspended' | 'closed';
export type DocumentStatus = 'pending' | 'approved' | 'rejected' | 'replaced';

export type AdminDistributorListItem = DashboardDistributor & {
  tax_id: string;
  updated_at: string;
  approved_at: string | null;
  user_id: string;
  full_name: string;
  user_status: string;
};

export type AdminDistributor = AdminDistributorListItem & {
  phone: string | null;
  role: string;
  billing_address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  website: string | null;
  contact_person: string | null;
  review_notes: string | null;
};

export type AdminDistributorDocument = {
  id: string;
  distributor_profile_id: string;
  document_type: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  status: DocumentStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
};

export type DistributorDetailResponse = {
  distributor: AdminDistributor;
  documents: AdminDistributorDocument[];
};

export type AdminQuoteListItem = Pick<Quote, 'id' | 'quote_number' | 'status' | 'subtotal_cents' | 'discount_cents' | 'tax_cents' | 'total_cents' | 'created_at' | 'updated_at' | 'submitted_at'> & {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
};

export type AdminQuote = AdminQuoteListItem & {
  notes: string | null;
  internal_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export type QuoteDetailResponse = {
  quote: AdminQuote;
  items: CartItem[];
};

export type ProductsResponse = { products: Product[] };
export type SaasPlansResponse = { saasPlans: SaasPlan[] };
export type AuditResponse = { events: AuditEvent[] };
export type QuotesResponse = { quotes: AdminQuoteListItem[] };
