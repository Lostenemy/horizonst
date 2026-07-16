import assert from 'node:assert/strict';
import { calculateLineTotals, calculateQuoteTotals, canAutoPriceSaasPlan, canSubmitCart, generateDraftQuoteNumber } from '../src/modules/cart/cart.service.js';
import { addItemSchema } from '../src/modules/cart/cart.routes.js';
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

// 5. Planes web con precio en céntimos, incluido Enterprise.
assert.equal(canAutoPriceSaasPlan({ annual_price_cents: null }), false, 'plans without price cannot be added');
assert.equal(canAutoPriceSaasPlan({ annual_price_cents: 58000 }), true, 'starter web plan can be added');
assert.equal(canAutoPriceSaasPlan({ annual_price_cents: 120000 }), true, 'enterprise web plan can be added');

// 6. Pack Starter con IVA y descuento de distribuidor aprobado.
const starterPack = calculateLineTotals({ quantity: 1, unitPriceCents: 325000, discountPercent: '10.00', taxRate: '21.00' });
assert.deepEqual(starterPack, { line_subtotal_cents: 325000, line_discount_cents: 32500, line_tax_cents: 61425, line_total_cents: 353925 });
assert.deepEqual(addItemSchema.parse({ item_type: 'pack', pack_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }), { item_type: 'pack', pack_id: '11111111-1111-4111-8111-111111111111', quantity: 1 });
assert.equal(addItemSchema.safeParse({ item_type: 'product', product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }).success, false, 'new individual product lines are rejected');

const cartRouterSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/modules/cart/cart.routes.ts', import.meta.url), 'utf8'));
assert.doesNotMatch(cartRouterSource, /z\.literal\('product'\)|SELECT id, name, price_cents, tax_rate FROM store\.products/, 'the client cart has no product purchase path');
assert.match(cartRouterSource, /coverage_square_meters/);
assert.match(cartRouterSource, /Cobertura aproximada: hasta/, 'new pack lines snapshot coverage for carts, quotes and orders');

const orderServiceSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/modules/orders/order.service.ts', import.meta.url), 'utf8'));
assert.match(orderServiceSource, /item_type, product_id, saas_plan_id, pack_id/, 'historical product lines remain copyable into orders');

// Los quote_number draft no deben exponer UUID de usuario.
const draftNumber = generateDraftQuoteNumber();
assert.match(draftNumber, /^DRAFT-[0-9a-f-]{36}$/);
assert.equal(draftNumber.includes('user-id'), false);
