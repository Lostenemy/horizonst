import { buildCommercialDocumentPdfLines, generateCommercialDocumentPdf, type CommercialDocumentPdfData } from '../../shared/commercial-document-pdf.js';

export type QuotePdfData = {
  quote: {
    quote_number: string;
    created_at: string | Date;
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
    discount_cents?: number;
    tax_cents: number;
    total_cents: number;
    notes: string | null;
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

export const quotePdfData = ({ quote, items }: QuotePdfData): CommercialDocumentPdfData => ({
  type: 'quote',
  document: {
    number: quote.quote_number,
    createdAt: quote.created_at,
    subtotalCents: quote.subtotal_cents,
    discountCents: quote.discount_cents ?? 0,
    taxCents: quote.tax_cents,
    totalCents: quote.total_cents,
    notes: quote.notes
  },
  customer: {
    fullName: quote.full_name,
    email: quote.email,
    companyName: quote.company_name,
    taxId: quote.customer_tax_id,
    address: quote.customer_billing_address,
    city: quote.customer_city,
    province: quote.customer_province,
    postalCode: quote.customer_postal_code,
    country: quote.customer_country
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

export const buildQuotePdfLines = (data: QuotePdfData): string[] => buildCommercialDocumentPdfLines(quotePdfData(data));
export const generateQuotePdf = async (data: QuotePdfData): Promise<Buffer> => generateCommercialDocumentPdf(quotePdfData(data));
