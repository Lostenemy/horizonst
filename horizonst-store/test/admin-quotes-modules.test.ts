import assert from 'node:assert/strict';
import { buildQuotePdfLines, generateQuotePdf } from '../src/modules/admin/quotes/pdf.js';
import { quoteStatusChangeSchema, quoteStatuses } from '../src/modules/admin/quotes/status.js';

assert.deepEqual(quoteStatuses, ['draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled']);
assert.equal(quoteStatusChangeSchema.parse({ status: 'draft', comment: 'Reopened' }).status, 'draft');
assert.throws(() => quoteStatusChangeSchema.parse({ status: 'paid' }));

const data = {
  quote: {
    quote_number: 'Q-2026-0001',
    created_at: '2026-06-23T10:00:00.000Z',
    full_name: 'Cliente Demo',
    email: 'cliente@example.com',
    company_name: 'Demo SL',
    subtotal_cents: 10000,
    tax_cents: 2100,
    total_cents: 12100,
    notes: 'Instalacion incluida'
  },
  items: [{
    description: 'Gateway BLE',
    quantity: 1,
    unit_price_cents: 10000,
    line_subtotal_cents: 10000,
    line_tax_cents: 2100,
    line_total_cents: 12100
  }]
};

const lines = buildQuotePdfLines(data);
assert.ok(lines.includes('Numero: Q-2026-0001'));
assert.ok(lines.some((line) => line.includes('Gateway BLE')));

const pdf = generateQuotePdf(data);
assert.equal(pdf.subarray(0, 8).toString('ascii'), '%PDF-1.4');
assert.ok(pdf.includes(Buffer.from('%%EOF')));
