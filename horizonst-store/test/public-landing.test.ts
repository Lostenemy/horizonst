import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPublicPlanCards, hardwarePacks, PublicPlanCards, publicPlanPrice } from '../web/src/pages/PublicLanding.js';
import type { SaasPlan } from '../web/src/lib/types.js';
import { customerAccessUrl, isPublicMarketingHost, publicMarketingPage } from '../web/src/lib/domains.js';

assert.equal(isPublicMarketingHost('horizonst.com.es'), true);
assert.equal(isPublicMarketingHost('www.horizonst.com.es'), true);
assert.equal(isPublicMarketingHost('tienda.horizonst.com.es'), false);
assert.equal(customerAccessUrl, 'https://tienda.horizonst.com.es');
assert.equal(publicMarketingPage('/'), 'home');
assert.equal(publicMarketingPage('/planes'), 'plans');
assert.equal(publicMarketingPage('/info-faqs'), 'info-faqs');
assert.equal(publicMarketingPage('/aviso-legal'), 'legal-notice');
assert.equal(publicMarketingPage('/privacidad'), 'privacy');
assert.equal(publicMarketingPage('/desconocida'), 'not-found');
assert.equal(hardwarePacks.length, 3);
assert.ok(hardwarePacks.every((pack) => pack.items.length === 4));

const plan = (code: string, price: number | null, overrides: Partial<SaasPlan> = {}): SaasPlan => ({
  id: `${code}-id`, code, name: code[0].toUpperCase() + code.slice(1), description: null,
  annual_price_cents: price, tax_rate: '21.00', max_tags: null, max_gateways: null,
  is_enterprise: price == null, is_active: true, ...overrides
});
assert.match(publicPlanPrice(61500), /615,00.*€/u, 'prices in cents use Spanish EUR formatting');
assert.equal(publicPlanPrice(0), 'Contactar', 'plans without a positive price never show zero euros');
const originalCards = buildPublicPlanCards([plan('starter', 58000)]);
const changedCards = buildPublicPlanCards([plan('starter', 61500)]);
assert.match(originalCards[0].price, /580,00/);
assert.match(changedCards[0].price, /615,00/, 'a changed API price changes the value rendered by the landing card');
assert.doesNotMatch(changedCards[0].price, /580,00/);
assert.equal(buildPublicPlanCards([plan('enterprise', null)])[0].price, 'Contactar', 'plans without an automatic price show contact text');
assert.deepEqual(buildPublicPlanCards([plan('starter', 99900, { is_active: false })]), [], 'inactive plans are not rendered');
assert.match(String((PublicPlanCards({ plans: [], loading: true, error: false }) as any).props.children), /Cargando precios/, 'loading state remains renderable');
assert.match(String((PublicPlanCards({ plans: [], loading: false, error: true }) as any).props.children), /No se pudieron cargar los precios/, 'catalog errors remain renderable');
assert.match(String((PublicPlanCards({ plans: [], loading: false, error: false }) as any).props.children), /No hay planes disponibles/, 'missing expected plans remain renderable');

const app = await readFile(new URL('../web/src/App.tsx', import.meta.url), 'utf-8');
assert.match(app, /<PublicHome \/>/);
assert.match(app, /<PublicPlans \/>/);
assert.match(app, /<PublicInfoFaqs \/>/);
assert.match(app, /Página no encontrada/);
const landing = await readFile(new URL('../web/src/pages/PublicLanding.tsx', import.meta.url), 'utf-8');
assert.doesNotMatch(landing, />Inicio</); assert.match(landing, /className="lp-brand" href="\/">HorizonST/); assert.match(landing, /INFO\/FAQS/); assert.match(landing, /Acceso clientes/);
assert.match(landing, /source: 'appcc_guide'/); assert.match(landing, /privacyAccepted/);
assert.doesNotMatch(landing, /Solicitar demo|source="demo"|\bBLE\b|Gateway BLE|Tag BLE/);
assert.doesNotMatch(landing, /3\.250 €|6\.500 €|12\.995 €/);
assert.doesNotMatch(landing, /580 €|800 €|1\.200 €|58000|80000|120000/, 'commercial prices are not hardcoded in the landing');
assert.match(landing, /\/api\/catalog\/saas-plans/, 'the public landing consumes the catalog API');
assert.match(landing, /annual_price_cents/, 'the landing renders annual prices received in cents');
assert.match(landing, /publicPlanPrice/, 'the landing uses the shared Spanish currency formatter');
assert.doesNotMatch(landing, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i, 'the landing does not hardcode catalog UUIDs');
assert.match(landing, /tecnologías inalámbricas|monitorización inalámbrica/);
assert.match(landing, /Visibilidad cuando más importa/); assert.match(landing, /Guía 2026 para la seguridad en cámaras congeladoras/); assert.match(landing, /href="\/planes">Ver planes/);
assert.match(landing, /El problema/); assert.match(landing, /Beneficios/); assert.match(landing, /Cómo funciona/); assert.match(landing, /Calculadora orientativa/); assert.match(landing, /<details/); assert.match(landing, /<summary>/);
assert.doesNotMatch(landing, /Planes web|Ver todos los planes y packs/);
const layout = await readFile(new URL('../web/src/components/Layout.tsx', import.meta.url), 'utf-8');
assert.match(layout, /https:\/\/horizonst\.com\.es/);
const css = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf-8');
assert.match(css, /\.lp-nav \.secondary\{background:#fff;color:#08233f/);
assert.match(css, /\.lp-nav \.secondary:focus-visible/);
assert.match(css, /\.lp-section h2\{font-size:clamp\(1\.75rem,3\.3vw,2\.75rem\)/);
