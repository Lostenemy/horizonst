import assert from 'node:assert/strict';
import { buildQuotePdfLines, generateQuotePdf } from '../src/modules/admin/quotes/pdf.js';
import { buildDeliveryNotePdfLines, generateDeliveryNotePdf } from '../src/modules/orders/pdf.js';
import { commercialDocumentFilename } from '../src/modules/shared/commercial-document-pdf.js';
import { commercialCompany } from '../src/resources/commercial-company.js';

const items = [{ description: 'Gateway BLE HorizonST', quantity: 2, unit_price_cents: 10000, discount_percent: '10.00', line_subtotal_cents: 20000, line_discount_cents: 2000, line_tax_cents: 3780, line_total_cents: 21780 }];
const customer = { full_name: 'Cliente Prueba', email: 'cliente@example.test', company_name: 'Cliente Frío SL', customer_tax_id: 'B12345678', customer_billing_address: 'Calle Cliente 1', customer_city: 'Murcia', customer_province: 'Murcia', customer_postal_code: '30001', customer_country: 'ES' };
const amounts = { subtotal_cents: 20000, discount_cents: 2000, tax_cents: 3780, total_cents: 21780 };

const quoteData = { quote: { quote_number: 'HST-2026-0042', created_at: '2026-08-27T10:00:00.000Z', ...customer, ...amounts, notes: 'Validez de la oferta: 30 días.' }, items };
const deliveryData = { order: { order_number: 'ORD-HST-2026-0042', quote_number: 'HST-2026-0042', created_at: '2026-08-28T10:00:00.000Z', status: 'processing', ...customer, ...amounts, customer_notes: 'Entregar en recepción.' }, items };

const quoteLines = buildQuotePdfLines(quoteData);
assert.equal(quoteLines[0], 'PRESUPUESTO');
assert.equal(quoteLines.some((line) => line.includes('ALBARÁN')), false, 'quote never identifies itself as a delivery note');
assert.ok(quoteLines.some((line) => line.includes('Número de presupuesto: HST-2026-0042')));
assert.ok(quoteLines.some((line) => line.includes(commercialCompany.legalName)));
assert.ok(quoteLines.some((line) => line.includes(commercialCompany.taxId)));
assert.ok(quoteLines.some((line) => line.includes('10.00%')), 'persisted line discount is represented');

const deliveryLines = buildDeliveryNotePdfLines(deliveryData);
assert.equal(deliveryLines[0], 'ALBARÁN');
assert.equal(deliveryLines.some((line) => /presupuesto/i.test(line)), false, 'delivery note never identifies itself as a quote');
assert.ok(deliveryLines.includes('Referencia de origen: HST-2026-0042'));
assert.ok(deliveryLines.some((line) => line.includes('Estado: En proceso')));
assert.ok(deliveryLines.some((line) => line.includes('Gateway BLE HorizonST')));
assert.ok(deliveryLines.some((line) => line.includes('Total: 217.80 €')));

const quotePdf = await generateQuotePdf(quoteData);
const deliveryPdf = await generateDeliveryNotePdf(deliveryData);
for (const pdf of [quotePdf, deliveryPdf]) {
  assert.equal(pdf.subarray(0, 8).toString('ascii'), '%PDF-1.3');
  assert.ok(pdf.includes(Buffer.from('%%EOF')));
  assert.ok(pdf.length > 3000, 'commercial PDF contains the complete branded layout');
}
assert.notDeepEqual(quotePdf, deliveryPdf, 'quote and delivery note are differentiated documents');
assert.equal(commercialDocumentFilename('quote', 'HST/2026 42'), 'PRESUPUESTO-HST-2026-42.pdf');
assert.equal(commercialDocumentFilename('delivery_note', 'ORD-HST-0042'), 'ALBARAN-ORD-HST-0042.pdf');
