import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePotentialSavings, hardwarePricing, landingSections, planPricing } from '../web/src/pages/PublicLanding.js';
import { customerAccessUrl, isPublicMarketingHost } from '../web/src/lib/domains.js';

assert.equal(isPublicMarketingHost('horizonst.com.es'), true, 'LP-01 routes apex domain to public funnel');
assert.equal(isPublicMarketingHost('www.horizonst.com.es'), true, 'LP-01 routes www domain to public funnel');
assert.equal(isPublicMarketingHost('tienda.horizonst.com.es'), false, 'LP-01 keeps store private domain on store app');
assert.equal(customerAccessUrl, 'https://tienda.horizonst.com.es', 'LP-04 customer access points to private store');

assert.deepEqual([...landingSections], ['hero', 'problem', 'solution', 'appcc-guide', 'savings-calculator', 'plans-pricing', 'hardware-pricing', 'trust', 'final-cta']);
assert.ok(planPricing.find((plan) => plan.name === 'Starter' && plan.price === '580 €/año' && plan.limits.includes('12 tags')));
assert.ok(planPricing.find((plan) => plan.name === 'Professional' && plan.price === '800 €/año' && plan.limits.includes('10 gateways')));
assert.ok(planPricing.find((plan) => plan.name === 'Enterprise' && plan.price === 'A consultar'));
assert.ok(hardwarePricing.find((item) => item.name === 'Gateway BLE HorizonST' && item.price === '190 €'));
assert.ok(hardwarePricing.find((item) => item.name === 'Tag BLE HorizonST' && item.price === '75 €'));

const low = calculatePotentialSavings(1, 10, 0, 0);
const high = calculatePotentialSavings(8, 25, 3, 1000);
assert.ok(high > low, 'LP-04 calculator changes estimate with inputs');

const app = await readFile(new URL('../web/src/App.tsx', import.meta.url), 'utf-8');
assert.match(app, /<PublicLanding \/>/, 'LP-01 public funnel is not Home.tsx');

const landing = await readFile(new URL('../web/src/pages/PublicLanding.tsx', import.meta.url), 'utf-8');
assert.match(landing, /source="demo"/);
assert.match(landing, /source="appcc_guide"/);
assert.match(landing, /No es un resultado garantizado/);
assert.match(landing, /Acceso clientes/);

const css = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf-8');
assert.match(css, /@media\(max-width:860px\)/, 'responsive landing breakpoint exists');
assert.match(css, /\.lp-grid\.three/);
assert.match(css, /\.lp-calculator/);
