import { buildCommercialDocumentPdfLines, generateCommercialDocumentPdf, type CommercialDocumentPdfData } from '../shared/commercial-document-pdf.js';

export type DeliveryNotePdfData = {
  order: {
    order_number: string;
    quote_number: string | null;
    created_at: string | Date;
    status: string;
    full_name: string;
    email: string;
    company_name: string | null;
    customer_tax_id?: string | null;
    customer_billing_address?: string | null;
    customer_city?: string | null;
    customer_province?: string | null;
    customer_postal_code?: string | null;
    customer_country?: string | null;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    total_cents: number;
    customer_notes: string | null;
  };
  items: Array<{
    description: string;
    quantity: number;
    unit_price_cents: number | null;
    discount_percent?: string | number | null;
    line_subtotal_cents: number;
    line_discount_cents?: number | null;
    line_tax_cents: number;
    line_total_cents: number;
  }>;
};

const deliveryNoteStatusLabels: Record<string, string> = {
  pending: 'Pendiente',
  processing: 'En proceso',
  completed: 'Completado',
  cancelled: 'Cancelado'
};

export const deliveryNotePdfData = ({ order, items }: DeliveryNotePdfData): CommercialDocumentPdfData => ({
  type: 'delivery_note',
  document: {
    number: order.order_number,
    createdAt: order.created_at,
    status: deliveryNoteStatusLabels[order.status] ?? order.status,
    sourceReference: order.quote_number,
    subtotalCents: order.subtotal_cents,
    discountCents: order.discount_cents,
    taxCents: order.tax_cents,
    totalCents: order.total_cents,
    notes: order.customer_notes
  },
  customer: {
    fullName: order.full_name,
    email: order.email,
    companyName: order.company_name,
    taxId: order.customer_tax_id,
    address: order.customer_billing_address,
    city: order.customer_city,
    province: order.customer_province,
    postalCode: order.customer_postal_code,
    country: order.customer_country
  },
  items: items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unit_price_cents,
    discountPercent: item.discount_percent,
    lineSubtotalCents: item.line_subtotal_cents,
    lineDiscountCents: item.line_discount_cents,
    lineTaxCents: item.line_tax_cents,
    lineTotalCents: item.line_total_cents
  }))
});

export const buildDeliveryNotePdfLines = (data: DeliveryNotePdfData): string[] => buildCommercialDocumentPdfLines(deliveryNotePdfData(data));
export const generateDeliveryNotePdf = async (data: DeliveryNotePdfData): Promise<Buffer> => generateCommercialDocumentPdf(deliveryNotePdfData(data));
