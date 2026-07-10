import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePotentialSavings, faqItems, landingSections, privateHardwareMessages, privatePlanMessages } from '../web/src/pages/PublicLanding.js';
import { customerAccessUrl, isPublicMarketingHost } from '../web/src/lib/domains.js';

assert.equal(isPublicMarketingHost('horizonst.com.es'), true, 'LP-01 routes apex domain to public funnel');
assert.equal(isPublicMarketingHost('www.horizonst.com.es'), true, 'LP-01 routes www domain to public funnel');
assert.equal(isPublicMarketingHost('tienda.horizonst.com.es'), false, 'LP-01 keeps store private domain on store app');
assert.equal(customerAccessUrl, 'https://tienda.horizonst.com.es', 'LP-04 customer access points to private store');

assert.deepEqual([...landingSections], ['hero', 'problem', 'solution', 'benefits', 'appcc-guide', 'savings-calculator', 'private-catalog', 'trust', 'faq', 'final-cta']);
assert.ok(privatePlanMessages.find((plan) => plan.description === 'Planes adaptados al tamaño de tu operación.'));
assert.ok(privatePlanMessages.find((plan) => plan.description === 'Solicita una demo para recibir una propuesta personalizada.'));
assert.ok(privateHardwareMessages.includes('Hardware compatible disponible en la zona privada.'));
assert.ok(faqItems.find((item) => item.question.includes('catálogo')));

const low = calculatePotentialSavings(1, 10, 0, 0);
const high = calculatePotentialSavings(8, 25, 3, 1000);
assert.ok(high > low, 'LP-04 calculator changes estimate with inputs');

const app = await readFile(new URL('../web/src/App.tsx', import.meta.url), 'utf-8');
assert.match(app, /<PublicLanding \/>/, 'LP-01 public funnel is not Home.tsx');
assert.match(app, /<Route path="\/catalog" element={<Catalog \/>} \/>/, 'private store keeps catalog route');
assert.ok(app.indexOf('<Route element={<ProtectedRoute />}>') < app.indexOf('<Route path="/catalog" element={<Catalog />} />'), 'catalog is protected in private store');

const landing = await readFile(new URL('../web/src/pages/PublicLanding.tsx', import.meta.url), 'utf-8');
assert.match(landing, /source="demo"/);
assert.match(landing, /source="appcc_guide"/);
assert.match(landing, /No es un resultado garantizado/);
assert.match(landing, /Acceso clientes/);
assert.match(landing, /Protege a tu equipo y cumple APPCC con monitorización inteligente de cámaras frigoríficas\./);
assert.match(landing, /Controla tiempos de exposición al frío, recibe alertas automáticas y mantén la trazabilidad en tiempo real\./);
assert.match(landing, /Solicitar demo gratuita/);
assert.match(landing, /Ver cómo funciona/);
assert.match(landing, /Guía APPCC 2026 para cámaras frigoríficas/);
assert.match(landing, /Aviso legal/);
assert.match(landing, /Privacidad/);
assert.match(landing, /Contacto/);
assert.doesNotMatch(landing, /580 €\/año|800 €\/año|190 €|150 €|75 €/);

const css = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf-8');
assert.match(css, /@media\(max-width:860px\)/, 'responsive landing breakpoint exists');
assert.match(css, /\.lp-grid\.three/);
assert.match(css, /\.lp-calculator/);
