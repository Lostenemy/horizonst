import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnnualServiceTerms, annualServiceTerms, enterpriseTerms } from '../web/src/components/AnnualServiceTerms.js';
import { PublicPlanCards, PublicHome, PublicInfoFaqs } from '../web/src/pages/PublicLanding.js';
import { quoteStatusLabels, displayLabel } from '../web/src/lib/presentation.js';
import { canAutoPriceSaasPlan as canPriceWeb } from '../web/src/lib/commercialPricing.js';
import { calculateLineTotals, canAutoPriceSaasPlan } from '../src/modules/cart/cart.service.js';
import { calculatePrereservationOffer } from '../src/modules/prereservation/prereservation.service.js';
import { cartRouter, addItemSchema } from '../src/modules/cart/cart.routes.js';
import { pool } from '../src/db/pool.js';

const terms = AnnualServiceTerms().props.children;
for (const text of Object.values(annualServiceTerms)) assert.ok(terms.includes(text));
assert.match(terms, /únicamente el uso de la aplicación, sus actualizaciones y soporte básico/);
assert.match(terms, /consultas por correo e incidencias de funcionamiento/);
assert.match(terms, /No incluye instalación, mantenimiento de hardware ni otros servicios/);
assert.match(terms, /renovación requiere la aceptación previa del cliente/);
assert.doesNotMatch(terms, /automática|automatización|cobro recurrente/i);
assert.match(enterpriseTerms, /completo e independiente.*desde cero.*ampliación.*No requiere contratar Professional/);
assert.doesNotMatch(enterpriseTerms, /prorrate|descuento|migración/i);

const id = '11111111-1111-4111-8111-111111111111';
const enterprise = { id, code: 'enterprise', name: 'Enterprise', description: null, max_tags: 40, max_gateways: 20,
  annual_price_cents: 120000, tax_rate: 21, is_active: true, is_enterprise: false };
assert.equal(canPriceWeb(enterprise), true);
assert.equal(canAutoPriceSaasPlan(enterprise), true);
assert.equal(canAutoPriceSaasPlan({ ...enterprise, is_enterprise: true }), false, 'manual pricing is not a Professional dependency');
const cards = JSON.stringify(PublicPlanCards({ plans: [enterprise], loading: false, error: false }));
assert.ok(cards.includes(enterpriseTerms), 'Enterprise alone renders its standalone conditions');
assert.ok(cards.includes('Enterprise'));
assert.equal(calculatePrereservationOffer('enterprise', { code: 'enterprise', name: 'Pack', price_cents: 1299500, tax_rate: 21, is_active: true },
  { ...enterprise, price_cents: enterprise.annual_price_cents }).available, true, 'offer needs no previous Professional plan');
assert.deepEqual(quoteStatusLabels.submitted, 'Solicitud recibida');
assert.equal(quoteStatusLabels.in_review, 'En revisión');
assert.equal(quoteStatusLabels.sent, 'Propuesta enviada');
for (const code of ['submitted', 'in_review', 'sent'] as const) assert.equal(displayLabel(code), quoteStatusLabels[code]);

const publicContent = JSON.stringify([PublicHome(), PublicInfoFaqs(), cards, terms]);
assert.match(publicContent, /aproximadamente 400 m²/);
assert.match(publicContent, /10 trabajadores distintos/);
assert.match(publicContent, /no un resultado medido ni una garantía de seguridad/);
assert.match(publicContent, /requiere alimentación eléctrica y conexión a Internet/);
assert.doesNotMatch(publicContent, /inspectora|inspección de trabajo|homologación|certificación|aval institucional|aprobación institucional|organismo/i);
for (const page of ['Catalog', 'Cart', 'Quotes', 'PublicPrereservation', 'admin/AdminQuoteDetail']) {
  const source = await readFile(new URL(`../web/src/pages/${page}.tsx`, import.meta.url), 'utf8');
  assert.match(source, /<AnnualServiceTerms \/>/, `${page} uses the same confirmed terms`);
}
const dashboard = await readFile(new URL('../web/src/pages/admin/AdminDashboard.tsx', import.meta.url), 'utf8');
for (const code of ['submitted', 'in_review', 'sent']) assert.ok(dashboard.includes(`quoteStatusLabels.${code}`));

// Ejercita el handler real de alta del carrito con un cliente nuevo y solo Enterprise.
// Pool sustituido temporalmente: ninguna conexión, correo ni escritura real.
const originalConnect = pool.connect;
const originalQuery = pool.query;
const sqlCalls: string[] = [];
let inserted: unknown[] = [];
let released = 0;
const quote = { id: 'quote-fixture', user_id: 'new-customer', status: 'draft' };
const query = async (sql: string, params: unknown[] = []) => {
  sqlCalls.push(sql);
  if (sql.includes('SELECT * FROM store.quotes')) return { rows: [] };
  if (sql.includes('INSERT INTO store.quotes')) return { rows: [quote] };
  if (sql.includes('FROM store.saas_plans')) { assert.deepEqual(params, [id]); return { rows: [enterprise] }; }
  if (sql.includes('SELECT * FROM store.quote_items')) return { rows: [] };
  if (sql.includes('INSERT INTO store.quote_items')) { inserted = params; return { rows: [{ id: 'item-fixture' }] }; }
  if (sql.includes('SELECT line_subtotal_cents')) return { rows: [calculateLineTotals({ quantity: 1, unitPriceCents: 120000, discountPercent: 0, taxRate: 21 })] };
  if (sql.startsWith('SELECT id, user_id') || sql.startsWith('UPDATE store.quotes')) return { rows: [quote] };
  if (sql.startsWith('SELECT id, quote_id')) return { rows: [{ id: 'item-fixture', saas_plan_id: id }] };
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('INSERT INTO store.audit_log')) return { rows: [] };
  throw new Error(`Unexpected fixture SQL: ${sql}`);
};
try {
  pool.connect = (async () => ({ query, release: () => { released++; } })) as any;
  pool.query = query as any;
  const layer = (cartRouter as any).stack.find((entry: any) => entry.route?.path === '/items' && entry.route.methods.post);
  let response: any;
  let status = 200;
  const res = { json: (body: any) => { response = body; }, status: (value: number) => { status = value; return res; } };
  const body = addItemSchema.parse({ item_type: 'saas_plan', saas_plan_id: id, quantity: 1 });
  await layer.route.stack[0].handle({ body, user: { sub: 'new-customer', role: 'customer' } }, res, (error: unknown) => { throw error; });
  assert.equal(status, 201);
  assert.equal(response.quote.id, quote.id);
  assert.equal(response.items[0].saas_plan_id, id);
  assert.equal(inserted[3], id);
  assert.deepEqual(inserted.slice(10), [120000, 0, 25200, 145200], 'prices and taxes are unchanged');
  assert.ok(sqlCalls.includes('COMMIT'));
  assert.ok(!sqlCalls.includes('ROLLBACK'));
  assert.ok(sqlCalls.every((sql) => !/professional|subscription|renewal/i.test(sql)), 'no prerequisite plan or renewal is queried');
  assert.equal(released, 1);
} finally { pool.connect = originalConnect; pool.query = originalQuery; }
console.log('Store business decisions: confirmed copy, standalone Enterprise cart, terminology and public evidence OK');
