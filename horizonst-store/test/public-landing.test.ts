import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPublicPlanCards, hardwarePacks, landingArtwork, PublicPlanCards, publicPlanPrice } from '../web/src/pages/PublicLanding.js';
import type { SaasPlan } from '../web/src/lib/types.js';
import { customerAccessUrl, isPublicMarketingHost, publicMarketingPage } from '../web/src/lib/domains.js';

assert.equal(isPublicMarketingHost('horizonst.es'), true);
assert.equal(isPublicMarketingHost('www.horizonst.es'), true);
assert.equal(isPublicMarketingHost('tienda.horizonst.es'), false);
assert.equal(customerAccessUrl, 'https://tienda.horizonst.es');
assert.equal(publicMarketingPage('/'), 'home');
assert.equal(publicMarketingPage('/planes'), 'plans');
assert.equal(publicMarketingPage('/info-faqs'), 'info-faqs');
assert.equal(publicMarketingPage('/prerreserva/starter'), 'prereservation');
assert.equal(publicMarketingPage('/prerreserva/professional'), 'prereservation');
assert.equal(publicMarketingPage('/prerreserva/enterprise'), 'prereservation');
assert.equal(publicMarketingPage('/prerreserva/unknown'), 'not-found');
assert.equal(publicMarketingPage('/aviso-legal'), 'legal-notice');
assert.equal(publicMarketingPage('/privacidad'), 'privacy');
assert.equal(publicMarketingPage('/desconocida'), 'not-found');
assert.equal(hardwarePacks.length, 3);
assert.ok(hardwarePacks.every((pack) => pack.items.length === 4));
assert.deepEqual(hardwarePacks.map((pack) => pack.coverageSquareMeters), [500, 1000, 2000]);

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
assert.match(buildPublicPlanCards([plan('enterprise', 120000, { is_enterprise: false })])[0].price, /1\.?200,00/, 'Enterprise renders its current database price when automatic pricing is enabled');
assert.deepEqual(buildPublicPlanCards([plan('starter', 99900, { is_active: false })]), [], 'inactive plans are not rendered');
assert.match(String((PublicPlanCards({ plans: [], loading: true, error: false }) as any).props.children), /Cargando precios/, 'loading state remains renderable');
assert.match(String((PublicPlanCards({ plans: [], loading: false, error: true }) as any).props.children), /No se pudieron cargar los precios/, 'catalog errors remain renderable');
assert.match(String((PublicPlanCards({ plans: [], loading: false, error: false }) as any).props.children), /No hay planes disponibles/, 'missing expected plans remain renderable');
const campaignCards = JSON.stringify(PublicPlanCards({
  plans: [plan('starter', 1), plan('professional', 2), plan('enterprise', 3, { is_enterprise: false })], loading: false, error: false,
  campaign: { campaign: 'prereservation_2026', endAt: '2026-09-01T21:59:59.999Z', active: true, codes: ['starter', 'professional', 'enterprise'] },
  onPrereserve: () => undefined
}));
assert.equal(campaignCards.match(/Prerreservar con 5 % de descuento/g)?.length, 3, 'all three commercial levels expose their own prereservation action');

const app = await readFile(new URL('../web/src/App.tsx', import.meta.url), 'utf-8');
assert.match(app, /<PublicHome \/>/);
assert.match(app, /<PublicPlans \/>/);
assert.match(app, /<PublicInfoFaqs \/>/);
assert.match(app, /<PublicPrereservation code=/);
assert.match(app, /Página no encontrada/);
const landing = await readFile(new URL('../web/src/pages/PublicLanding.tsx', import.meta.url), 'utf-8');
const horneoLogo = await readFile(new URL('../web/public/images/casos-exito/horneo.png', import.meta.url));
const selectedArtwork = [landingArtwork.hero, landingArtwork.intro, landingArtwork.alert, landingArtwork.response, landingArtwork.review, ...landingArtwork.sectors, landingArtwork.guide, landingArtwork.plans, landingArtwork.closing];
assert.equal(selectedArtwork.length, 10, 'the landing selects artwork by commercial purpose instead of rendering the complete campaign');
assert.equal(new Set(selectedArtwork.map((artwork) => artwork.src)).size, selectedArtwork.length, 'selected artwork is never repeated');
assert.ok(selectedArtwork.every((artwork) => artwork.alt.length > 20), 'informative artwork has useful alternative text');
assert.ok(selectedArtwork.every((artwork) => artwork.width > 0 && artwork.height > 0), 'artwork dimensions are explicit to prevent layout shifts');
for (const artwork of selectedArtwork) {
  for (const src of [artwork.src, artwork.mobileSrc]) {
    const asset = await readFile(new URL(`../web/public${src}`, import.meta.url));
    assert.ok(asset.length > 0, `${src} is stored locally`);
    assert.equal(asset.subarray(0, 4).toString('hex'), '52494646', `${src} is an optimized WebP asset`);
  }
}
assert.match(landingArtwork.hero.src, /05-entering-freezer/);
assert.match(landingArtwork.intro.src, /06-buddy-check/);
assert.match(landingArtwork.alert.src, /19-mobile-alert/);
assert.match(landingArtwork.guide.src, /14-team-onboarding/);
assert.match(landingArtwork.plans.src, /18-charging-fleet/);
assert.match(landingArtwork.closing.src, /20-worker-portrait/);
assert.doesNotMatch(landing, /campaignComicPanels|CampaignComic|campaign-comic-title|Una jornada en frío, viñeta a viñeta|lp-comic-sequence/, 'the rejected 13-panel gallery is removed');
assert.match(landing, /landingArtwork\.hero} priority/, 'the hero artwork is the only prioritized campaign image');
assert.match(landing, /fetchPriority=\{priority \? 'high' : undefined\}/);
assert.match(landing, /loading=\{priority \? undefined : 'lazy'\}/);
assert.match(landing, /id="guia"[^>]+aria-labelledby="guide-conversion-title"/);
assert.match(landing, /landingArtwork\.guide/);
assert.match(landing, /id="plans-art-title"/);
assert.match(landing, /landingArtwork\.plans/);
assert.match(landing, /id="emotional-close-title"/);
assert.match(landing, /landingArtwork\.closing/);
assert.match(landing, /href="#guia">Recibir la guía gratuita/);
assert.match(landing, /href="\/info-faqs">Descubrir cómo funciona/);
assert.match(landing, /href="\/planes">Ver planes/);
assert.ok(horneoLogo.length > 0, 'the Horneo logo is stored locally');
assert.equal(horneoLogo.subarray(1, 4).toString('ascii'), 'PNG', 'the local success-case asset is a PNG');
assert.match(landing, /Horneo ya utiliza HorizonST en una cámara frigorífica de aproximadamente 400 m²/);
assert.match(landing, /10 trabajadores distintos/);
assert.match(landing, /src="\/images\/casos-exito\/horneo\.png"/);
assert.match(landing, /alt="Logotipo de Horneo"/);
assert.doesNotMatch(landing, /horneo\.es\/Media|logo_horneo2\.png/, 'the landing never hotlinks the official image');
assert.match(landing, /coverageSquareMeters: 500/);
assert.match(landing, /coverageSquareMeters: 1000/);
assert.match(landing, /coverageSquareMeters: 2000/);
assert.match(landing, /coverageLabel\(pack\.coverageSquareMeters\)/, 'public pack cards render their coverage');
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
assert.match(landing, /El problema/); assert.match(landing, /Beneficios/); assert.match(landing, /Cómo funciona/); assert.doesNotMatch(landing, /Calculadora orientativa|Calculadora de ahorro|Ahorro potencial orientativo|calculatePotentialSavings/); assert.match(landing, /<details/); assert.match(landing, /<summary>/);
assert.match(landing, /Prerreservar con 5 % de descuento/);
assert.match(landing, /PrereservationAccessModal/);
assert.match(landing, /required type="email"/);
assert.match(landing, /href="\/privacidad"/);
assert.match(landing, /sessionStorage\.setItem\(prereservationSessionKey\(code\), data\.accessToken\)/);
assert.doesNotMatch(landing, /localStorage/);
assert.doesNotMatch(landing, /email.*window\.location|window\.location.*email/i, 'the email is never added to the URL');
assert.doesNotMatch(landing, /Planes web|Ver todos los planes y packs/);
const layout = await readFile(new URL('../web/src/components/Layout.tsx', import.meta.url), 'utf-8');
assert.match(layout, /https:\/\/horizonst\.es/);
const css = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf-8');
assert.match(css, /\.lp-nav \.secondary\{background:#fff;color:#08233f/);
assert.match(css, /\.lp-nav \.secondary:focus-visible/);
assert.match(css, /\.lp-section h2\{font-size:clamp\(1\.75rem,3\.3vw,2\.75rem\)/);
assert.doesNotMatch(css, /counter-reset:comic-panel|counter\(comic-panel\)|\.lp-comic/, 'the numbered gallery styles are removed');
assert.match(css, /\.lp-final-cta \.actions\{justify-content:center\}/, 'the information page final actions are centered without changing global actions');
assert.doesNotMatch(css, /\.lp-hero-visual\{[^}]*margin-right:\s*-/, 'the hero visual no longer escapes its grid with a negative right margin');
assert.match(css, /\.lp-hero-visual\{[^}]*min-width:0;[^}]*width:100%;max-width:100%/, 'the hero visual stays within the available grid track');
assert.match(css, /@media\(max-width:1024px\)/);
assert.match(css, /@media\(max-width:860px\)/);
assert.match(css, /@media\(max-width:640px\)/);
assert.match(css, /prefers-reduced-motion:reduce/);
const prereservationPage = await readFile(new URL('../web/src/pages/PublicPrereservation.tsx', import.meta.url), 'utf-8');
assert.match(prereservationPage, /sessionStorage\.getItem\(prereservationSessionKey\(code\)\)/);
assert.doesNotMatch(prereservationPage, /localStorage|new URLSearchParams\([^)]*email/);
assert.match(prereservationPage, /!offer\.available/);
assert.match(prereservationPage, /No es una compra y no se realizará ningún cargo/);
assert.match(prereservationPage, /coverageLabel\(offer\.hardware!\.coverageSquareMeters\)/, 'the prereservation shows current pack coverage');
const catalogPage = await readFile(new URL('../web/src/pages/Catalog.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(catalogPage, /images\/campaign-comic/, 'campaign compositions remain outside the private storefront');
assert.match(catalogPage, /coverageLabel\(pack\.coverage_square_meters\)/, 'the private pack catalog renders coverage');
assert.doesNotMatch(catalogPage, /\/api\/catalog\/products|item_type: 'product'/, 'the private storefront has no individual-product API or purchase action');
const catalogRouter = await readFile(new URL('../src/modules/catalog/catalog.routes.ts', import.meta.url), 'utf8');
assert.doesNotMatch(catalogRouter, /catalogRouter\.get\('\/products'/, 'the customer product catalog endpoint no longer exists');
const adminCatalogRouter = await readFile(new URL('../src/modules/admin/catalog.routes.ts', import.meta.url), 'utf8');
assert.match(adminCatalogRouter, /adminCatalogRouter\.get\('\/products'/, 'internal product administration is preserved');
