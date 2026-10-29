import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { renderToStaticMarkup } = createRequire(new URL('../web/package.json', import.meta.url))('react-dom/server') as typeof import('react-dom/server');
import { HorneoCase, PublicHome, PublicInfoFaqs, PublicPlanCards } from '../web/src/pages/PublicLanding.js';
import PublicContact from '../web/src/pages/PublicContact.js';
const React = createRequire(new URL('../web/package.json', import.meta.url))('react') as typeof import('react');

const home = renderToStaticMarkup(React.createElement(PublicHome));
const info = renderToStaticMarkup(React.createElement(PublicInfoFaqs));
const contact = renderToStaticMarkup(React.createElement(PublicContact));
const caseOnly = renderToStaticMarkup(React.createElement(HorneoCase));
assert.match(home, /Supervisa accesos y permanencias en tus cámaras congeladoras\./);
assert.ok(home.indexOf('lp-success-case') < home.indexOf('home-process-title'), 'Horneo is immediately after the hero');
assert.match(caseOnly, /Horneo: un caso real/);
assert.doesNotMatch(caseOnly, /lp-case-media|<video|<blockquote|próximamente|pendiente/i);
assert.match(home, /href="\/contacto">Consultar mi instalación/);
assert.match(home, /href="\/info-faqs#funcionamiento">Ver cómo funciona/);
assert.ok(info.indexOf('id="funcionamiento"') < info.indexOf('Qué aporta'));
assert.equal((info.match(/<details/g) ?? []).length, 10);
assert.equal((home.match(/aria-current="page"/g) ?? []).length, 1);
assert.match(contact, /Cuéntanos cómo es tu instalación/);
assert.match(contact, /No necesitas conocer los detalles técnicos/);
assert.match(contact, /aria-describedby="contact-message-context contact-message-help"/);
assert.doesNotMatch(contact, /name="(?:phone|company)"|24 horas|48 horas/i);
const plans = renderToStaticMarkup(React.createElement(PublicPlanCards, {
  plans: [{ id: 'fixture', code: 'starter', name: 'Starter', description: 'Función exclusiva no verificada', annual_price_cents: 61500,
    tax_rate: 21, max_tags: 13, max_gateways: 7, is_active: true, is_enterprise: false }], loading: false, error: false
}));
assert.match(plans, /Compara capacidad y cuota/);
assert.doesNotMatch(plans, /lp-plan-card/, 'no duplicated decision cards');
assert.equal((plans.match(/615,00/g) ?? []).length, 1, 'the API-derived price appears once');
assert.doesNotMatch(plans, /Función exclusiva no verificada/, 'catalog prose does not invent functional differences between plans');
for (const text of ['13', '7', 'Cuota anual de aplicación', 'incluye únicamente', 'No incluye', 'aceptación previa']) assert.ok(plans.includes(text));
assert.doesNotMatch(home + info + contact + plans, /primeros en España|sin competencia|la mejor solución|generación de informes|vídeo próximamente|inspectora|homologación|certificación/i);
const source = await readFile(new URL('../web/src/pages/PublicLanding.tsx', import.meta.url), 'utf8');
assert.match(source, /onClose=\{closePrereservation\}/, 'modal callback identity remains stable during field edits');
assert.match(source, /useCallback\(\(\) => setSelectedCode\(null\), \[\]\)/);
assert.match(source, /event.key === 'Escape'/);
assert.match(source, /trigger\?\.focus\(\)/);
assert.match(source, /source: 'appcc_guide'/);
assert.match(source, /privacyAccepted, website/);
const css = await readFile(new URL('../web/src/commercial-review.css', import.meta.url), 'utf8');
assert.match(css, /\.lp-modal-close[^}]*color: #fff/);
assert.match(css, /input\[type="checkbox"\]/);
assert.match(css, /summary:focus-visible/);
assert.ok(!css.includes('url('), 'no external images or fonts introduced');
console.log('Commercial review: content order, comparison, legal terms, privacy and scoped presentation contracts passed');
