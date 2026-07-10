import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePotentialSavings, faqItems, landingSections, privateHardwareMessages, privatePlanMessages, publicWebPlans } from '../web/src/pages/PublicLanding.js';
import { customerAccessUrl, isPublicMarketingHost, publicMarketingPage } from '../web/src/lib/domains.js';

assert.equal(isPublicMarketingHost('horizonst.com.es'), true, 'LP-01 routes apex domain to public funnel');
assert.equal(isPublicMarketingHost('www.horizonst.com.es'), true, 'LP-01 routes www domain to public funnel');
assert.equal(isPublicMarketingHost('tienda.horizonst.com.es'), false, 'LP-01 keeps store private domain on store app');
assert.equal(customerAccessUrl, 'https://tienda.horizonst.com.es', 'LP-04 customer access points to private store');
assert.equal(publicMarketingPage('/'), 'landing');
assert.equal(publicMarketingPage('/aviso-legal'), 'legal-notice');
assert.equal(publicMarketingPage('/privacidad'), 'privacy');

assert.deepEqual([...landingSections], ['hero', 'problem', 'solution', 'benefits', 'appcc-guide', 'savings-calculator', 'private-catalog', 'trust', 'faq', 'final-cta']);
assert.ok(privatePlanMessages.find((plan) => plan.description === 'Planes adaptados al tamaño de tu operación.'));
assert.ok(privatePlanMessages.find((plan) => plan.description === 'Solicita una demo para recibir una propuesta personalizada.'));
assert.ok(privateHardwareMessages.includes('Hardware compatible disponible en la zona privada.'));
assert.ok(faqItems.find((item) => item.question.includes('catálogo')));
assert.deepEqual(publicWebPlans.map((plan) => plan.price), ['580 € PVP + IVA', '800 € PVP + IVA', '1.200 € PVP + IVA']);

const low = calculatePotentialSavings(1, 10, 0, 0);
const high = calculatePotentialSavings(8, 25, 3, 1000);
assert.ok(high > low, 'LP-04 calculator changes estimate with inputs');

const app = await readFile(new URL('../web/src/App.tsx', import.meta.url), 'utf-8');
assert.match(app, /<PublicLanding \/>/, 'LP-01 public funnel is not Home.tsx');
assert.match(app, /<Route path="\/catalog" element={<Catalog \/>} \/>/, 'private store keeps catalog route');
assert.ok(app.indexOf('<Route element={<ProtectedRoute />}>') < app.indexOf('<Route path="/catalog" element={<Catalog />} />'), 'catalog is protected in private store');
assert.match(app, /<PublicLegal page={page} \/>/, 'public legal routes render their own component');

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
assert.match(landing, /580 € PVP \+ IVA/);
assert.match(landing, /800 € PVP \+ IVA/);
assert.match(landing, /1\.200 € PVP \+ IVA/);
assert.doesNotMatch(landing, /190 €|150 €|75 €/);
assert.match(landing, /privacyAccepted/);
assert.match(landing, /política de privacidad/);

const legal = await readFile(new URL('../web/src/pages/PublicLegal.tsx', import.meta.url), 'utf-8');
assert.match(legal, /Aviso legal/);
assert.match(legal, /Política de privacidad/);
assert.match(legal, /HorizonSmartrack/);
assert.match(legal, /27484575N/);
assert.match(legal, /Calle Félix Esteban Guerrero, nº 6, Local B-5, 30007 Murcia, España/);
assert.match(legal, /comercial@horizonst\.es/);
assert.match(legal, /contenido del sitio tiene carácter informativo/);
assert.match(legal, /Datos tratados/);
assert.match(legal, /Agencia Española de Protección de Datos/);
assert.doesNotMatch(legal, /Registro Mercantil|Teléfono/);
assert.doesNotMatch(legal, /Solicitar demo gratuita/, 'legal pages do not render only the landing content');

const css = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf-8');
assert.match(css, /@media\(max-width:860px\)/, 'responsive landing breakpoint exists');
assert.match(css, /\.lp-grid\.three/);
assert.match(css, /\.lp-calculator/);
