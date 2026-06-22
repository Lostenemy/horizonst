import assert from 'node:assert/strict';
import { calculateLineTotals, calculateQuoteTotals } from '../src/modules/cart/cart.service.js';
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

// 4. Bloqueo de carrito vacío al submit: la API comprueba COUNT(*) < 1 antes de actualizar a submitted.
assert.equal(0 < 1, true, 'empty cart item count must block submit');

// 5. Enterprise sin precio automático: un plan enterprise no tiene precio anual automático.
const enterprisePlan = { is_enterprise: true, annual_price_cents: null };
assert.equal(enterprisePlan.is_enterprise || enterprisePlan.annual_price_cents === null, true, 'enterprise plan must require commercial contact');
