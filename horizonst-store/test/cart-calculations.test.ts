import assert from 'node:assert/strict';
import { calculateLineTotals, calculateQuoteTotals, canAutoPriceSaasPlan, canSubmitCart, generateDraftQuoteNumber } from '../src/modules/cart/cart.service.js';
import { hasBlockingActiveDistributorDocuments } from '../src/modules/admin/distributors.routes.js';

// Existing distributor document validation tests.
assert.equal(hasBlockingActiveDistributorDocuments({ blocking_documents: 0 }), false, 'approved-only active documents should not block approval');
assert.equal(hasBlockingActiveDistributorDocuments({ blocking_documents: 1 }), true, 'pending active documents should block approval');
assert.equal(hasBlockingActiveDistributorDocuments({ blocking_documents: '2' }), true, 'rejected active documents should block approval');

// 1. Cálculo de totales sin descuento.
const noDiscountLine = calculateLineTotals({ quantity: 2, unitPriceCents: 10000, discountPercent: 0, taxRate: 21 });
assert.deepEqual(noDiscountLine, { line_subtotal_cents: 20000, line_discount_cents: 0, line_tax_cents: 4200, line_total_cents: 24200 });
assert.deepEqual(calculateQuoteTotals([noDiscountLine]), { subtotal_cents: 20000, discount_cents: 0, tax_cents: 4200, total_cents: 24200 });

// 2. Cálculo de totales con descuento distribuidor aprobado.
const approvedDistributorLine = calculateLineTotals({ quantity: 3, unitPriceCents: 10000, discountPercent: '10.00', taxRate: '21.00' });
assert.deepEqual(approvedDistributorLine, { line_subtotal_cents: 30000, line_discount_cents: 3000, line_tax_cents: 5670, line_total_cents: 32670 });

// 3. Distribuidor no aprobado sin descuento.
const unapprovedDistributorLine = calculateLineTotals({ quantity: 1, unitPriceCents: 58000, discountPercent: 0, taxRate: 21 });
assert.deepEqual(unapprovedDistributorLine, { line_subtotal_cents: 58000, line_discount_cents: 0, line_tax_cents: 12180, line_total_cents: 70180 });

// 4. Bloqueo de carrito vacío al submit.
assert.equal(canSubmitCart(0), false, 'empty cart item count must block submit');
assert.equal(canSubmitCart(1), true, 'non-empty cart can be submitted');

// 5. Enterprise sin precio automático.
assert.equal(canAutoPriceSaasPlan({ is_enterprise: true, annual_price_cents: null }), false, 'enterprise plan must require commercial contact');
assert.equal(canAutoPriceSaasPlan({ is_enterprise: false, annual_price_cents: null }), false, 'plans with null price must require commercial contact');
assert.equal(canAutoPriceSaasPlan({ is_enterprise: false, annual_price_cents: 58000 }), true, 'standard priced plans can be auto-priced');

// Los quote_number draft no deben exponer UUID de usuario.
const draftNumber = generateDraftQuoteNumber();
assert.match(draftNumber, /^DRAFT-[0-9a-f-]{36}$/);
assert.equal(draftNumber.includes('user-id'), false);
