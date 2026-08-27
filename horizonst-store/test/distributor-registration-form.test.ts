import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { ZodError } from 'zod';
import { createDistributorRegistrationHandler } from '../src/modules/auth/auth.routes.js';
import { registerDistributorSchema } from '../src/modules/auth/distributor-registration.js';
import { changeDistributorCountry, changeDistributorRegion, distributorFieldErrorsFromApi, distributorProvinces, distributorRegions, emptyDistributorRegistration, validateDistributorRegistration } from '../web/src/lib/distributorRegistration.js';

const validRegistration = {
  fullName: 'Ana Pérez', email: 'ana@empresa.es', phone: '+34 612 345 678', password: 'segura-2026', company_name: 'Frío Seguro SL', tax_id: 'B12345678', billing_address: 'Calle Mayor 1', city: 'Murcia', country: 'ES', region: 'Región de Murcia', province: 'Murcia', postal_code: '30001', website: '', contact_person: ''
};

const parsed = registerDistributorSchema.parse(validRegistration);
assert.equal(parsed.country, 'ES', 'a valid Spanish distributor registration passes backend validation');
assert.equal(parsed.website, undefined, 'an empty optional website is not rejected as an invalid URL');
assert.equal(parsed.contact_person, undefined, 'an empty optional contact is normalized away');

const emptyErrors = validateDistributorRegistration({ ...emptyDistributorRegistration });
assert.match(emptyErrors.company_name ?? '', /obligatoria/, 'an empty required field has a specific Spanish message');
assert.match(validateDistributorRegistration({ ...validRegistration, email: 'correo-invalido' }).email ?? '', /nombre@empresa\.es/, 'invalid email feedback includes an example');
assert.match(validateDistributorRegistration({ ...validRegistration, postal_code: '99999' }).postal_code ?? '', /30001/, 'invalid postal-code feedback includes an example');

const regions = distributorRegions('ES');
assert.ok(regions.some((region) => region.name === 'Andalucía'), 'selecting Spain loads its autonomous communities');
assert.deepEqual(distributorProvinces('ES', 'Región de Murcia').map((province) => province.name), ['Murcia'], 'selecting a region loads only its provinces');
assert.deepEqual(changeDistributorCountry('ES'), { country: 'ES', region: '', province: '' }, 'changing country clears region and province');
assert.deepEqual(changeDistributorRegion({ country: 'ES', region: 'Andalucía', province: 'Sevilla' }, 'Aragón'), { country: 'ES', region: 'Aragón', province: '' }, 'changing region clears province');

const mappedErrors = distributorFieldErrorsFromApi({ fieldErrors: { email: ['Correo rechazado por el servidor.'], unknown: ['No visible'] } });
assert.equal(mappedErrors.email, 'Correo rechazado por el servidor.', 'a backend field error is mapped to its form field');
assert.equal((mappedErrors as Record<string, string>).unknown, undefined, 'unknown backend keys are not exposed as form fields');

const calls: string[] = [];
let profileValues: unknown[] = [];
let welcomeInput: any;
const client = {
  query: async (sql: string, values?: unknown[]) => {
    calls.push(sql);
    if (sql.includes('INSERT INTO store.users')) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', email: validRegistration.email, full_name: validRegistration.fullName, role: 'distributor', status: 'pending_email_verification' }] };
    if (sql.includes('INSERT INTO store.distributor_profiles')) { profileValues = values ?? []; return { rows: [{ id: '22222222-2222-4222-8222-222222222222' }] }; }
    return { rows: [] };
  },
  release: () => calls.push('RELEASE')
};
let connections = 0;
const handler = createDistributorRegistrationHandler({
  connect: async () => { connections += 1; return client; }, hash: async () => 'hashed-password', audit: async () => undefined,
  createToken: async () => 'verification-token-for-distributor',
  deliverWelcome: async (user, token) => { calls.push('WELCOME'); welcomeInput = { user, token }; return true; }, production: true
});
const app = express();
app.use(express.json()); app.post('/register-distributor', handler);
app.use((error: any, _req: any, res: any, _next: any) => error instanceof ZodError ? res.status(400).json({ error: 'Validation error', details: error.flatten() }) : res.status(500).json({ error: 'Internal server error' }));
const server = app.listen(0);
try {
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const request = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/register-distributor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await request(validRegistration);
  assert.equal(response.status, 201, 'valid distributor data completes registration');
  const body = await response.json() as any;
  assert.equal(body.welcomeEmailSent, true, 'successful registration preserves the welcome-email flow');
  assert.equal(welcomeInput.user.role, 'distributor'); assert.equal(welcomeInput.token, 'verification-token-for-distributor');
  assert.ok(calls.indexOf('COMMIT') < calls.indexOf('WELCOME'), 'welcome email is sent only after the transaction commits');
  assert.equal(calls.includes('ROLLBACK'), false, 'a committed successful registration is not rolled back');
  assert.deepEqual(profileValues.slice(5, 9), ['Región de Murcia', 'Murcia', '30001', 'ES'], 'region, province, postal code and country reach the expected SQL parameters');
  const invalid = await request({ ...validRegistration, email: 'incorrecto' });
  assert.equal(invalid.status, 400, 'backend remains the final validator for invalid email');
  const invalidBody = await invalid.json() as any;
  assert.match(invalidBody.details.fieldErrors.email[0], /nombre@empresa\.es/);
  assert.equal(connections, 1, 'invalid input is rejected before opening a database connection');
} finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

assert.equal(registerDistributorSchema.safeParse({ ...validRegistration, country: 'España' }).success, false, 'backend rejects a country name where the API requires its ISO code');
assert.equal(registerDistributorSchema.safeParse({ ...validRegistration, website: 'empresa.es' }).success, false, 'backend rejects a website without an absolute http(s) URL');

const formSource = await readFile(new URL('../web/src/pages/RegisterDistributor.tsx', import.meta.url), 'utf8');
for (const label of ['Nombre y apellidos', 'Correo electrónico', 'Teléfono', 'Razón social', 'Dirección fiscal', 'Región / Comunidad Autónoma', 'Código postal']) assert.match(formSource, new RegExp(label), `form includes the Spanish label ${label}`);
for (const oldPlaceholder of ['fullName', 'company_name', 'tax_id', 'billing_address', 'postal_code', 'contact_person']) assert.doesNotMatch(formSource, new RegExp(`placeholder=["']${oldPlaceholder}["']`), `form does not expose the backend field name ${oldPlaceholder}`);
assert.match(formSource, /htmlFor=\{name\}/, 'every reusable field label is associated with its control');
assert.match(formSource, /aria-invalid/, 'invalid controls expose their state to assistive technology');
assert.match(formSource, /aria-describedby/, 'field hints and errors are associated with their controls');
assert.match(formSource, /distributorFieldErrorsFromApi\(caught\.details\)/, 'backend field errors are rendered through the field-error state');
assert.match(formSource, /const form = event\.currentTarget;/, 'the form reference is retained before asynchronous registration');
assert.match(formSource, /form\.reset\(\)/, 'successful registration resets the retained form safely');
for (const section of ['Datos de contacto', 'Datos de empresa', 'Ubicación fiscal']) assert.match(formSource, new RegExp(`<legend>${section}</legend>`), `form groups fields under ${section}`);
assert.match(formSource, /className="registration-actions"><button/, 'submit action closes the form outside the field grids');
assert.doesNotMatch(formSource, /label="Correo electrónico"[^>]+hint=/, 'email example is not duplicated as placeholder and helper');
assert.doesNotMatch(formSource, /label="Teléfono"[^>]+hint=/, 'phone example is not duplicated as placeholder and helper');
assert.doesNotMatch(formSource, /label="Código postal"[^>]+hint=/, 'postal-code example is not duplicated as placeholder and helper');

const styles = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
assert.match(styles, /\.distributor-registration-container\{[^}]*max-width:1400px/, 'registration route receives a wider dedicated container');
assert.match(styles, /\.registration-fields\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'desktop layout uses at most three columns');
assert.match(styles, /@media\(max-width:1199px\)\{\.registration-fields\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'tablet layout uses two columns');
assert.match(styles, /@media\(max-width:767px\)[\s\S]*?\.registration-fields\{grid-template-columns:1fr/, 'mobile layout uses one column');
assert.match(styles, /\.form-field>label\{display:flex/, 'label text and required marker remain on the same line');
assert.match(styles, /\.form-field input,\.form-field select\{width:100%;height:52px/, 'controls remain uniform and cannot overflow their columns');
assert.match(styles, /\.registration-actions button\{width:min\(100%,260px\)/, 'desktop submit action has a deliberate width');

const layout = await readFile(new URL('../web/src/components/Layout.tsx', import.meta.url), 'utf8');
assert.match(layout, /location\.pathname === '\/register-distributor'/, 'only the distributor-registration route widens the shared container');

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
assert.match(dockerfile, /COPY resources \.\/resources/, 'the Docker image still includes the distributor brochure');
