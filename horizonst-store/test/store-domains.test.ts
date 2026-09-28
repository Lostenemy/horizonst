import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domainEnvironment } from '../src/resources/store-domains.js';
import { customerAccessUrl, marketingAccessUrl, isPublicMarketingHost, publicMarketingPage } from '../web/src/lib/domains.js';
import { buildAppccGuideEmail } from '../src/modules/shared/mail.js';
import { env } from '../src/config/env.js';

const cases = [
  ['horizonst.es', true, 'https://horizonst.es', 'https://tienda.horizonst.es'],
  ['www.horizonst.es', true, 'https://horizonst.es', 'https://tienda.horizonst.es'],
  ['horizonst.com.es', true, 'https://horizonst.com.es', 'https://tienda.horizonst.com.es'],
  ['www.horizonst.com.es', true, 'https://horizonst.com.es', 'https://tienda.horizonst.com.es'],
  ['tienda.horizonst.es', false, 'https://horizonst.es', 'https://tienda.horizonst.es'],
  ['tienda.horizonst.com.es', false, 'https://horizonst.com.es', 'https://tienda.horizonst.com.es']
] as const;
for (const [host, commercial, marketing, store] of cases) {
  for (const input of [host, host.toUpperCase()]) {
    assert.equal(isPublicMarketingHost(input), commercial);
    assert.equal(customerAccessUrl(input), store);
    assert.equal(marketingAccessUrl(input), marketing);
  }
}
for (const host of ['horizonst.es.evil.test', 'www.horizonst.com.es.evil.test', 'fakehorizonst.es', 'tienda.horizonst.com.es.evil.test',
  'horizonst-com.es', 'horizonst.com', 'evil.test', '__proto__', 'constructor', 'horizonst.es.', 'https://horizonst.es', 'horizonst.es:443', ' horizonst.es', 'localhost', '127.0.0.1', '']) {
  assert.equal(isPublicMarketingHost(host), false, host);
  assert.equal(domainEnvironment(host), undefined, host);
  assert.equal(customerAccessUrl(host), '/', 'unknown/local hosts never create an external shop URL');
  assert.equal(marketingAccessUrl(host), '/');
}
assert.equal(publicMarketingPage('/'), 'home');
assert.equal(publicMarketingPage('/planes'), 'plans');
assert.equal(publicMarketingPage('/info-faqs'), 'info-faqs');
const landing = await readFile(new URL('../web/src/pages/PublicLanding.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(landing, /href=\{customerAccessUrl\}/);
assert.match(landing, /href=\{customerAccessUrl\(\)\}/);
const originalBase = env.publicBaseUrl;
try {
  for (const [, , marketing, store] of cases) {
    env.publicBaseUrl = store;
    const mail = buildAppccGuideEmail({ email: 'fixture@example.test' }, `${store}/recursos/guia-appcc-2026.pdf`);
    assert.ok(mail.text.includes(`${marketing}/planes`));
    assert.ok(mail.html.includes(`href="${marketing}/privacidad"`));
    if (store.endsWith('.com.es')) assert.doesNotMatch(mail.text + mail.html, /https:\/\/(?:tienda\.)?horizonst\.es\//);
  }
} finally { env.publicBaseUrl = originalBase; }
console.log('Store domain parity: six hosts, case normalization, exact allowlist, local fallback and simulated email links OK');
