import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { commercialCopy } from '../web/src/lib/commercial-copy.js';
import { collaborationPaths, publicMarketingPage } from '../web/src/lib/domains.js';
import { PublicCollaborations } from '../web/src/pages/CommercialContent.js';
import ConsultationForm, { consultationPurpose } from '../web/src/components/ConsultationForm.js';
import { contactSchema } from '../src/modules/contact/contact.routes.js';
import express from 'express';
import { pool } from '../src/db/pool.js';
import { createDistributorResourcesRouter } from '../src/modules/distributor/resources.routes.js';
import { credentialVersion, signAccessToken } from '../src/modules/auth/token.js';
import { randomBytes } from 'node:crypto';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const React = require('react') as typeof import('react');
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
assert.equal(Object.keys(commercialCopy).length, 8);
for (const path of collaborationPaths) {
  assert.equal(publicMarketingPage(path), 'collaborations');
  const html = renderToStaticMarkup(React.createElement(PublicCollaborations, { path }));
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /id="consulta"/);
  assert.match(html, /name="fullName"/); assert.match(html, /name="companyName"/);
  assert.doesNotMatch(html.match(/<input[^>]*name="companyName"[^>]*>/)?.[0] ?? '', /required/);
  assert.doesNotMatch(html, /type="password"|comisi[oó]n|remuneraci[oó]n|liquidaciones|C:\\|Formulario:|Integración:|SEO title:/i);
  const nav = html.slice(html.indexOf('class="lp-nav-links"'), html.indexOf('Tienda B2B'));
  const labels = ['Inicio', 'Planes', 'Cómo funciona', 'Colaboraciones', 'Contacto'];
  for (let i = 1; i < labels.length; i++) assert.ok(nav.indexOf(labels[i-1]) < nav.indexOf(labels[i]));
  if (path !== '/colaboraciones') { assert.match(html, /Consulta sobre:/); assert.doesNotMatch(html, /id="contact-profile"/); }
}
for (const path of ['/colaboraciones/falsa', '/colaboraciones/instaladores-extra', '/colaboraciones/../admin']) assert.equal(publicMarketingPage(path), 'not-found');
for (const value of ['instalacion', 'presupuesto', 'colaboracion']) assert.equal(consultationPurpose('?motivo=' + value), value);
assert.equal(consultationPurpose('?motivo=https://evil.test&email=x'), '');
const ordinary = renderToStaticMarkup(React.createElement(ConsultationForm));
assert.match(ordinary, /Empresa \(opcional\)/);
assert.match(ordinary, /Mensaje \(opcional\)/);
assert.doesNotMatch(ordinary.match(/<textarea[^>]*>/)?.[0] ?? '', /required/);
for (const companyName of [undefined, '']) {
  assert.equal(contactSchema.safeParse({ fullName: 'Ficticio', email: 'test@example.test', companyName, purpose: 'presupuesto', profile: 'gerencia', message: '', privacyAccepted: true }).success, true);
}
const serialized = JSON.stringify(commercialCopy);
assert.doesNotMatch(serialized, /comisi[oó]n|remuneraci[oó]n|liquidaci[oó]n|Integración:|Formulario:|Recurso:|C:\\|600,00|900,00|1200,00/i);
assert.equal(commercialCopy['/colaboraciones/instaladores'].sections[0].title, 'Una pregunta que puede abrir la valoración');
assert.equal(commercialCopy['/colaboraciones/asesorias-prl'].sections[0].title, 'De las pautas preventivas a su seguimiento diario');
assert.equal(commercialCopy['/colaboraciones/ingenierias-frio'].sections[0].title, 'Proyectar la cámara teniendo en cuenta cómo se trabajará dentro');
const privacy = await readFile(new URL('../web/src/pages/PublicLegal.tsx', import.meta.url), 'utf8');
assert.match(privacy, /empresa y el mensaje son opcionales/);
assert.match(privacy, /Solicitar información no autoriza/);
console.log('Commercial v3: eight pages, exact routes, distinct profiles, optional company, safe public copy and privacy passed');
// Real authentication and role middleware, isolated PostgreSQL double, ephemeral test credentials.
const originalQuery = pool.query;
const passwordHash = randomBytes(32).toString('hex');
let role: 'customer' | 'distributor' = 'customer'; let resourceQueries = 0;
const app = express();
app.use('/api/distributor', createDistributorResourcesRouter({ query: async () => { resourceQueries++; return { rows: [{ title: 'PRIVATE_TEST_RESOURCE' }] }; } }));
const server = app.listen(0, '127.0.0.1');
try {
  await new Promise<void>(resolve => server.once('listening', resolve));
  pool.query = (async () => ({ rows: [{ id: 'fixture-user', role, status: 'active', password_hash: passwordHash }] })) as any;
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/distributor/resources`;
  assert.equal((await fetch(url)).status, 401);
  for (const current of ['customer', 'distributor'] as const) {
    role = current;
    const token = signAccessToken({ sub: 'fixture-user', role, status: 'active', email: 'role@example.test', credentialVersion: credentialVersion(passwordHash) });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, role === 'customer' ? 403 : 200);
    if (role === 'customer') { assert.equal(resourceQueries, 0); assert.doesNotMatch(await response.text(), /PRIVATE_TEST_RESOURCE/); }
    else assert.equal((await response.json() as any).resources[0].title, 'PRIVATE_TEST_RESOURCE');
  }
  assert.equal(resourceQueries, 1);
} finally { pool.query = originalQuery; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
console.log('Commercial v3: anonymous/customer/distributor resource access exercised over HTTP, real JWT/role checks, isolated SQL');
