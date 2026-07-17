import assert from 'node:assert/strict';
import { calculateLineTotals, calculateQuoteTotals, canAutoPricePack, canAutoPriceSaasPlan, canSubmitCart, generateDraftQuoteNumber } from '../src/modules/cart/cart.service.js';
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

// 5. La disponibilidad y los importes dependen del dato actual de catálogo.
const currentPlan = (annual_price_cents: number | null, overrides: Record<string, unknown> = {}) => ({ annual_price_cents, tax_rate: '21.00', is_active: true, is_enterprise: false, ...overrides });
assert.equal(canAutoPriceSaasPlan(currentPlan(60000)), true, 'Starter can be added at its current database price');
assert.equal(canAutoPriceSaasPlan(currentPlan(90000)), true, 'Professional can be added at its current database price');
assert.equal(canAutoPriceSaasPlan(currentPlan(120000)), true, 'Enterprise can be added when its current database flag allows automatic pricing');
assert.equal(canAutoPriceSaasPlan(currentPlan(null)), false, 'null prices block automatic pricing');
assert.equal(canAutoPriceSaasPlan(currentPlan(0)), false, 'non-positive prices block automatic pricing');
assert.equal(canAutoPriceSaasPlan(currentPlan(120000, { is_active: false })), false, 'inactive plans cannot be sold');
assert.equal(canAutoPriceSaasPlan(currentPlan(120000, { is_enterprise: true })), false, 'the current database manual-pricing flag is respected');
assert.equal(canAutoPriceSaasPlan(currentPlan(120000, { tax_rate: 'invalid' })), false, 'invalid database tax prevents automatic pricing');
const originalEnterpriseLine = calculateLineTotals({ quantity: 1, unitPriceCents: 120000, discountPercent: 0, taxRate: 21 });
const changedEnterpriseLine = calculateLineTotals({ quantity: 1, unitPriceCents: 135000, discountPercent: 0, taxRate: 21 });
assert.notEqual(changedEnterpriseLine.line_total_cents, originalEnterpriseLine.line_total_cents, 'changing the simulated database price changes the cart total without code changes');
const originalStarterLine = calculateLineTotals({ quantity: 1, unitPriceCents: 60000, discountPercent: 0, taxRate: 21 });
const changedStarterLine = calculateLineTotals({ quantity: 1, unitPriceCents: 61500, discountPercent: 0, taxRate: 21 });
assert.notEqual(changedStarterLine.line_total_cents, originalStarterLine.line_total_cents, 'changing the simulated Starter database price changes the cart total without code changes');

assert.equal(canAutoPricePack({ price_cents: 325000, tax_rate: '21.00', is_active: true }), true);
assert.equal(canAutoPricePack({ price_cents: 0, tax_rate: '21.00', is_active: true }), false);
assert.equal(canAutoPricePack({ price_cents: 325000, tax_rate: '21.00', is_active: false }), false);

// 6. Pack Starter con IVA y descuento de distribuidor aprobado.
const starterPack = calculateLineTotals({ quantity: 1, unitPriceCents: 325000, discountPercent: '10.00', taxRate: '21.00' });
assert.deepEqual(starterPack, { line_subtotal_cents: 325000, line_discount_cents: 32500, line_tax_cents: 61425, line_total_cents: 353925 });
assert.deepEqual(addItemSchema.parse({ item_type: 'pack', pack_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }), { item_type: 'pack', pack_id: '11111111-1111-4111-8111-111111111111', quantity: 1 });
assert.equal(addItemSchema.safeParse({ item_type: 'product', product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }).success, false, 'new individual product lines are rejected');

const cartRouterSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/modules/cart/cart.routes.ts', import.meta.url), 'utf8'));
assert.doesNotMatch(cartRouterSource, /z\.literal\('product'\)|SELECT id, name, price_cents, tax_rate FROM store\.products/, 'the client cart has no product purchase path');
assert.match(cartRouterSource, /coverage_square_meters/);
assert.match(cartRouterSource, /Cobertura aproximada: hasta/, 'new pack lines snapshot coverage for carts, quotes and orders');
assert.match(cartRouterSource, /annual_price_cents, tax_rate, is_active, is_enterprise FROM store\.saas_plans/, 'cart pricing reads current plan data from the database');
assert.match(cartRouterSource, /price_cents, tax_rate, is_active, coverage_square_meters FROM store\.packs/, 'cart pricing reads current pack data from the database');
assert.match(cartRouterSource, /unit_price_cents = \$4/, 'updating an existing line persists the current database price');

const orderServiceSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/modules/orders/order.service.ts', import.meta.url), 'utf8'));
assert.match(orderServiceSource, /item_type, product_id, saas_plan_id, pack_id/, 'historical product lines remain copyable into orders');

// Los quote_number draft no deben exponer UUID de usuario.
const draftNumber = generateDraftQuoteNumber();
assert.match(draftNumber, /^DRAFT-[0-9a-f-]{36}$/);
assert.equal(draftNumber.includes('user-id'), false);
