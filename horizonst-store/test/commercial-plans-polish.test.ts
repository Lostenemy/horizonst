import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { PublicPlanCards, buildPublicPlanCards } from '../web/src/pages/PublicLanding.js';
import { annualServiceTerms, enterpriseTerms } from '../web/src/components/AnnualServiceTerms.js';
import type { SaasPlan } from '../web/src/lib/types.js';
const { renderToStaticMarkup } = createRequire(new URL('../web/package.json', import.meta.url))('react-dom/server') as typeof import('react-dom/server');
const plans: SaasPlan[] = ['starter', 'professional', 'enterprise'].map((code, i) => ({
  id: `fixture-${code}`, code, name: ['Starter', 'Professional', 'Enterprise'][i], description: 'Unverified feature',
  annual_price_cents: [61500, 82500, 125000][i], max_tags: 10 + i, max_gateways: 5 + i,
  tax_rate: 21, is_active: true, is_enterprise: false
}));
const render = (options: Partial<Parameters<typeof PublicPlanCards>[0]> = {}) => renderToStaticMarkup(PublicPlanCards({ plans, loading: false, error: false, ...options }));
const html = render();
assert.equal((html.match(/class="lp-comparison-item"/g) ?? []).length, 3);
assert.doesNotMatch(html, /lp-plan-card|Unverified feature|más vendido/i);
for (const price of ['615,00', '825,00', '1250,00']) assert.equal(html.split(price).length - 1, 1);
assert.equal((html.match(/Consultar condiciones actuales/g) ?? []).length, 3);
for (const text of [...Object.values(annualServiceTerms), enterpriseTerms]) assert.equal(html.split(text).length - 1, 1, 'each complete shared condition occurs exactly once');
assert.ok(html.indexOf(annualServiceTerms.included) < html.indexOf('<details'));
assert.ok(html.indexOf(annualServiceTerms.excluded) < html.indexOf('<details'));
assert.ok(html.indexOf(annualServiceTerms.renewal) < html.indexOf('<details'));
assert.match(html, /<details class="lp-service-details"><summary>Detalle del servicio y condiciones/);
const partial = render({ plans: [{ ...plans[2], annual_price_cents: null, max_tags: null, max_gateways: null }] });
assert.equal((partial.match(/class="lp-comparison-item"/g) ?? []).length, 1);
assert.match(partial, /Contactar/); assert.match(partial, /Consultar/); assert.match(partial, /Algunas opciones/);
assert.equal(buildPublicPlanCards([{ ...plans[0], is_active: false }]).length, 0);
assert.match(render({ loading: true }), /role="status"/);
assert.match(render({ error: true, plans: [] }), /role="alert"/);
assert.match(render({ error: true }), /últimos datos cargados como referencia/);
assert.match(render({ plans: [] }), /No hay planes disponibles/);
const campaign = { active: true, campaign: 'fixture', endAt: '2027-01-01T22:59:59.999Z', codes: ['starter', 'professional', 'enterprise'] as ('starter' | 'professional' | 'enterprise')[] };
const calls: string[] = [];
const tree = PublicPlanCards({ plans, loading: false, error: false, campaign, onPrereserve: code => calls.push(code) });
function visit(node: any) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'button' && node.props.className === 'lp-plan-action') node.props.onClick({ currentTarget: {} });
  const children = node.props?.children;
  (Array.isArray(children) ? children.flat(Infinity) : [children]).forEach(visit);
}
visit(tree); assert.deepEqual(calls, ['starter', 'professional', 'enterprise']);
const oldCalls = calls.length;
visit(PublicPlanCards({ plans, loading: false, error: true, campaign, onPrereserve: code => calls.push(code) }));
assert.equal(calls.length, oldCalls, 'stale catalog cannot start a new prereservation while preserving focusable nodes');
assert.equal((render({ campaign, onPrereserve() {} }).match(/Prerreservar con 5 % de descuento/g) ?? []).length, 3);
assert.equal((render({ campaign: { ...campaign, active: false }, onPrereserve() {} }).match(/Consultar condiciones actuales/g) ?? []).length, 3);
const source = await readFile(new URL('../web/src/pages/PublicLanding.tsx', import.meta.url), 'utf8');
assert.match(source, /<details className="lp-hardware-option" key=\{pack.name\}/);
assert.match(source, /pack.items.map/); assert.match(source, /coverageLabel\(pack.coverageSquareMeters\)/);
assert.match(source, /href=\{customerAccessUrl\(\)\}/);
assert.match(source, /href="\/contacto">Consultar la configuración de mi instalación/);
assert.match(source, /prereservationEndLabel\(campaign.endAt\)/);
assert.match(source, /window.setInterval\(load, 30000\)/);
console.log('Plans polish: PL-001/002/003/004/007 render, shared terms integrity, callback codes and campaign regressions passed');
