import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalog = await readFile(new URL('../web/src/pages/Catalog.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../web/src/components/Layout.tsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/015_distributor_verification_and_catalog.sql', import.meta.url), 'utf8');
const quotesPage = await readFile(new URL('../web/src/pages/Quotes.tsx', import.meta.url), 'utf8');
const adminQuotePage = await readFile(new URL('../web/src/pages/admin/AdminQuoteDetail.tsx', import.meta.url), 'utf8');
const apiClient = await readFile(new URL('../web/src/lib/api.ts', import.meta.url), 'utf8');
const adminQuoteRoutes = await readFile(new URL('../src/modules/admin/quotes.routes.ts', import.meta.url), 'utf8');

assert.match(catalog, /Promise\.all\(\[api<\{ packs: Pack\[\] \}>\('\/api\/catalog\/packs'\), api<\{ saasPlans: SaasPlan\[\] \}>\('\/api\/catalog\/saas-plans'\)\]\)/, 'one catalog loads hardware and web data from the API');
assert.match(catalog, /const tiers = \['starter', 'professional', 'enterprise'\]/, 'tiers use the commercial order');
assert.match(catalog, /catalog-pair/); assert.match(catalog, /Hardware \{tierLabels\[tier\]\}/); assert.match(catalog, /Web \{tierLabels\[tier\]\}/);
assert.doesNotMatch(catalog, /Sin descripción/);
assert.match(app, /path="\/saas-plans" element=\{<Navigate to="\/catalog" replace \/>\}/, 'old route redirects instead of returning 404');
assert.doesNotMatch(layout, /to="\/saas-plans"/, 'independent web plans navigation is removed');
assert.match(layout, /Documentación HorizonST/); assert.match(layout, /Mis documentos/); assert.match(layout, />Perfil</);
assert.match(migration, /WHEN 'starter' THEN 10/);
assert.match(migration, /WHEN 'enterprise' THEN 40/); assert.match(migration, /WHEN 'enterprise' THEN 20/);
assert.match(catalog, /\+\{enterpriseExtraTags\} tags · \+\{enterpriseExtraGateways\} gateways respecto a Professional/, 'Enterprise shows the truthful +20/+10 delta from database capacities');
assert.match(quotesPage, /downloadFile\(`\/api\/quotes\/\$\{detail\.quote\.id\}\/pdf`/, 'quote PDF uses authenticated blob download');
assert.doesNotMatch(quotesPage, /href=\{`\/api\/quotes\/.*\/pdf/);
assert.match(adminQuotePage, /downloadFile\(`\/api\/admin\/quotes\/\$\{id\}\/pdf`/, 'admin PDF uses the same authenticated pattern');
assert.match(apiClient, /error\.status !== 401 \|\| !\(await refreshAccessToken\(\)\)/, 'blob download retries once after refreshing a 401 token');
assert.match(adminQuoteRoutes, /requireRole\('admin'\)/); assert.match(adminQuoteRoutes, /router\.get\('\/quotes\/:id\/pdf'/, 'admin keeps protected access to every quote PDF');

const styles = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
assert.match(styles, /\.catalog-pair\{display:grid;grid-template-columns:repeat\(2/);
assert.match(styles, /@media\(max-width:680px\).*\.catalog-pair\{grid-template-columns:1fr\}/s, 'catalog stacks on mobile');
assert.match(styles, /\.quotes-page th\{background:#08233f;color:#fff\}/, 'quote headers have strong HorizonST contrast');
