import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { ZodError } from 'zod';
import { createDistributorRegistrationHandler } from '../src/modules/auth/auth.routes.js';
import { registerDistributorSchema } from '../src/modules/auth/distributor-registration.js';
import { changeDistributorCountry, changeDistributorRegion, distributorCountries, distributorFieldErrorsFromApi, distributorGeography, distributorProvinces, distributorRegions, emptyDistributorRegistration, validateDistributorRegistration } from '../web/src/lib/distributorRegistration.js';
import { normalizeWebsiteUrl } from '../src/resources/distributor-registration-rules.js';

const validRegistration = {
  fullName: 'Ana Pérez', email: 'ana@empresa.es', phone: '+34 612 345 678', password: 'segura-2026', company_name: 'Frío Seguro SL', tax_id: 'B12345678', billing_address: 'Calle Mayor 1', city: 'Murcia', country: 'ES', region: 'Región de Murcia', province: 'Murcia', postal_code: '30001', website: '', contact_person: ''
};

const parsed = registerDistributorSchema.parse(validRegistration);
assert.equal(parsed.country, 'ES', 'a valid Spanish distributor registration passes backend validation');
assert.equal(parsed.website, undefined, 'an empty optional website is not rejected as an invalid URL');
assert.equal(parsed.contact_person, undefined, 'an empty optional contact is normalized away');
for (const [input, expected] of [['empresa.es', 'https://empresa.es'], ['www.empresa.es', 'https://www.empresa.es'], ['https://empresa.es', 'https://empresa.es'], ['http://empresa.es', 'http://empresa.es']] as const) {
  assert.equal(normalizeWebsiteUrl(input), expected, `${input} is normalized consistently`);
  assert.equal(registerDistributorSchema.parse({ ...validRegistration, website: input }).website, expected, `${input} is persisted normalized`);
}
for (const invalidWebsite of ['empresa', 'http://', 'https://', 'empresa..es']) assert.equal(registerDistributorSchema.safeParse({ ...validRegistration, website: invalidWebsite }).success, false, `${invalidWebsite} is rejected`);

const emptyErrors = validateDistributorRegistration({ ...emptyDistributorRegistration });
assert.match(emptyErrors.company_name ?? '', /obligatoria/, 'an empty required field has a specific Spanish message');
assert.match(validateDistributorRegistration({ ...validRegistration, email: 'correo-invalido' }).email ?? '', /nombre@empresa\.es/, 'invalid email feedback includes an example');
assert.match(validateDistributorRegistration({ ...validRegistration, postal_code: '99999' }).postal_code ?? '', /30001/, 'invalid postal-code feedback includes an example');

const regions = distributorRegions('ES');
for (const code of ['GB', 'ES', 'FR', 'DE', 'IT', 'PT', 'IE', 'NL', 'BE', 'LU', 'AT', 'CH', 'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI', 'EE', 'LV', 'LT', 'CY', 'MT']) assert.ok(distributorCountries.some((country) => country.code === code), `${code} is supported`);
assert.ok(regions.some((region) => region.name === 'Andalucía'), 'selecting Spain loads its autonomous communities');
assert.deepEqual(distributorProvinces('ES', 'Región de Murcia').map((province) => province.name), ['Murcia'], 'selecting a region loads only its provinces');
assert.deepEqual(changeDistributorCountry('ES'), { country: 'ES', region: '', province: '' }, 'changing country clears region and province');
assert.deepEqual(changeDistributorRegion({ country: 'ES', region: 'Andalucía', province: 'Sevilla' }, 'Aragón'), { country: 'ES', region: 'Aragón', province: '' }, 'changing region clears province');
assert.equal(distributorGeography('ES')?.regionLabel, 'Comunidad Autónoma');
assert.equal(distributorGeography('GB')?.regionLabel, 'Nación / Región');
assert.equal(distributorGeography('GB')?.provinceLabel, 'Condado / área administrativa');
assert.equal(distributorGeography('FR')?.provinceLabel, 'Departamento');
assert.equal(distributorGeography('DE')?.regionLabel, 'Estado federado');
assert.ok(distributorProvinces('GB', 'England').some((county) => county.name === 'Greater London'), 'England exposes coherent counties');
assert.ok(distributorProvinces('FR', 'Île-de-France').some((department) => department.name === 'Paris'), 'France exposes departments by region');

const validUkRegistration = { ...validRegistration, email: 'partner@example.co.uk', phone: '+44 20 7946 0958', company_name: 'Cold Partner Ltd', tax_id: 'GB123456789', city: 'London', country: 'GB', region: 'England', province: 'Greater London', postal_code: 'SW1A 1AA', website: 'partner.co.uk' };
const validFrenchRegistration = { ...validRegistration, email: 'partner@example.fr', tax_id: 'FR12345678901', city: 'Paris', country: 'FR', region: 'Île-de-France', province: 'Paris', postal_code: '75001' };
const validGermanRegistration = { ...validRegistration, email: 'partner@example.de', tax_id: 'DE123456789', city: 'Berlin', country: 'DE', region: 'Berlin', province: '', postal_code: '10115' };
assert.equal(registerDistributorSchema.safeParse(validUkRegistration).success, true, 'a complete UK registration is valid');
assert.equal(registerDistributorSchema.safeParse(validFrenchRegistration).success, true, 'a complete French registration is valid');
assert.equal(registerDistributorSchema.safeParse(validGermanRegistration).success, true, 'a country without a required second level is valid');
assert.equal(registerDistributorSchema.safeParse({ ...validUkRegistration, region: 'Île-de-France' }).success, false, 'a region from another country is rejected');
assert.equal(registerDistributorSchema.safeParse({ ...validUkRegistration, province: 'Paris' }).success, false, 'a subdivision from another region is rejected');
assert.equal(registerDistributorSchema.safeParse({ ...validUkRegistration, postal_code: '30001' }).success, false, 'the Spanish postcode rule is not applied to the UK');
assert.equal(registerDistributorSchema.safeParse({ ...validGermanRegistration, tax_id: 'ACME-DE-2026' }).success, true, 'foreign companies are not forced through the Spanish CIF rule');

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
  const foreignResponse = await request(validUkRegistration);
  assert.equal(foreignResponse.status, 201, 'a complete foreign distributor registration reaches persistence');
  assert.deepEqual(profileValues.slice(5, 9), ['England', 'Greater London', 'SW1A 1AA', 'GB'], 'foreign geography reaches the existing profile columns');
  assert.equal(profileValues[9], 'https://partner.co.uk', 'the website reaches persistence in normalized form');
  const invalid = await request({ ...validRegistration, email: 'incorrecto' });
  assert.equal(invalid.status, 400, 'backend remains the final validator for invalid email');
  const invalidBody = await invalid.json() as any;
  assert.match(invalidBody.details.fieldErrors.email[0], /nombre@empresa\.es/);
  assert.equal(connections, 2, 'invalid input is rejected before opening a database connection');
} finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

assert.equal(registerDistributorSchema.safeParse({ ...validRegistration, country: 'España' }).success, false, 'backend rejects a country name where the API requires its ISO code');
assert.equal(registerDistributorSchema.parse({ ...validRegistration, website: 'empresa.es' }).website, 'https://empresa.es', 'backend accepts and normalizes a website without protocol');

const formSource = await readFile(new URL('../web/src/pages/RegisterDistributor.tsx', import.meta.url), 'utf8');
for (const label of ['Nombre y apellidos', 'Correo electrónico', 'Teléfono', 'Razón social', 'Dirección fiscal', 'Identificador fiscal / VAT', 'Código postal']) assert.match(formSource, new RegExp(label), `form includes the Spanish label ${label}`);
assert.match(formSource, /label=\{geography\.regionLabel\}/, 'the regional label follows the selected country');
assert.match(formSource, /label=\{geography\.provinceLabel\}/, 'the subdivision label follows the selected country');
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
assert.match(formSource, /geography\.postalCodeExample/, 'postal-code guidance follows the selected country');

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
