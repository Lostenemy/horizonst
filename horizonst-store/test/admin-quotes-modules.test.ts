import assert from 'node:assert/strict';
import { buildQuotePdfLines, generateQuotePdf } from '../src/modules/admin/quotes/pdf.js';
import { canTransitionQuoteStatus, quoteStatusChangeSchema, quoteStatuses, shouldRecordQuoteStatusHistory } from '../src/modules/admin/quotes/status.js';

assert.deepEqual(quoteStatuses, ['draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled']);
assert.equal(quoteStatusChangeSchema.parse({ status: 'draft', comment: 'Reopened' }).status, 'draft');
assert.throws(() => quoteStatusChangeSchema.parse({ status: 'paid' }));

assert.equal(canTransitionQuoteStatus('draft', 'submitted'), true);
assert.equal(canTransitionQuoteStatus('draft', 'cancelled'), true);
assert.equal(canTransitionQuoteStatus('submitted', 'in_review'), true);
assert.equal(canTransitionQuoteStatus('in_review', 'sent'), true);
assert.equal(canTransitionQuoteStatus('sent', 'accepted'), true);
assert.equal(canTransitionQuoteStatus('accepted', 'draft'), false);
assert.equal(canTransitionQuoteStatus('rejected', 'sent'), false);
assert.equal(canTransitionQuoteStatus('cancelled', 'sent'), false);
assert.equal(canTransitionQuoteStatus('sent', 'sent'), false);
assert.equal(shouldRecordQuoteStatusHistory('sent', 'accepted'), true);
assert.equal(shouldRecordQuoteStatusHistory('sent', 'sent'), false, 'same-state changes must not insert history');
assert.equal(shouldRecordQuoteStatusHistory('cancelled', 'sent'), false, 'invalid transitions must not insert history');

const data = {
  quote: {
    quote_number: 'Q-2026-0001',
    created_at: '2026-06-23T10:00:00.000Z',
    full_name: 'José María',
    email: 'cliente@example.com',
    company_name: 'Málaga Sensores SL',
    subtotal_cents: 10000,
    tax_cents: 2100,
    total_cents: 12100,
    notes: 'Presupuesto nº urgente para Málaga'
  },
  items: [{
    description: 'Gateway BLE para Málaga',
    quantity: 1,
    unit_price_cents: 10000,
    line_subtotal_cents: 10000,
    line_tax_cents: 2100,
    line_total_cents: 12100
  }]
};

const lines = buildQuotePdfLines(data);
assert.ok(lines.includes('Presupuesto nº: Q-2026-0001'));
assert.ok(lines.some((line) => line.includes('José María')));
assert.ok(lines.some((line) => line.includes('Málaga')));

const pdf = await generateQuotePdf(data);
assert.equal(pdf.subarray(0, 8).toString('ascii'), '%PDF-1.3');
assert.ok(pdf.includes(Buffer.from('%%EOF')));
assert.ok(pdf.length > 1000);
