import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ApiError } from '../web/src/lib/api.js';
import { apiMessage } from '../web/src/pages/admin/adminUtils.js';
import { readPlan, readProduct } from '../web/src/pages/admin/CatalogForm.js';

const planId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const planData = new FormData();
planData.set('code', 'starter'); planData.set('name', 'Starter'); planData.set('annual_price_cents', '58000'); planData.set('tax_rate', '21'); planData.set('is_active', 'on');
assert.equal(readPlan(planData, planId).id, planId, 'editing a plan preserves its id');
assert.equal(readPlan(planData).id, undefined, 'creating a plan has no id');

const productData = new FormData();
productData.set('sku', 'STARTER-TAG'); productData.set('name', 'Tag'); productData.set('category', 'hardware'); productData.set('price_cents', '1200'); productData.set('tax_rate', '21'); productData.set('is_active', 'on');
assert.equal(readProduct(productData, productId).id, productId, 'editing a product preserves its id');

assert.equal(apiMessage(new ApiError('Resource already exists', 409), 'Ya existe un plan con ese código.'), 'Ya existe un plan con ese código.');

const register = await readFile(new URL('../web/src/pages/Register.tsx', import.meta.url), 'utf8');
assert.match(register, /const form = event\.currentTarget;/, 'registration retains the form before awaiting');
assert.match(register, /new FormData\(form\)/, 'registration reads the retained form');
assert.match(register, /form\.reset\(\)/, 'successful registration resets the retained form');

const plans = await readFile(new URL('../web/src/pages/admin/AdminSaasPlans.tsx', import.meta.url), 'utf8');
assert.match(plans, /const \{ id, \.\.\.payload \} = value;/, 'plan save separates the id from its payload');
assert.match(plans, /if \(id\) await patchJson\(`\/api\/admin\/saas-plans\/\$\{id\}`, payload\)/, 'editing Starter uses PATCH without id in its body');
assert.match(plans, /else await postJson\('\/api\/admin\/saas-plans', payload\)/, 'creating a plan uses POST without an id');
assert.match(plans, /Ya existe un plan con ese código\./, 'plan conflicts have a clear message');

const products = await readFile(new URL('../web/src/pages/admin/AdminProducts.tsx', import.meta.url), 'utf8');
assert.match(products, /const \{ id, \.\.\.payload \} = value;/, 'product save separates the id from its payload');
assert.match(products, /if \(id\) await patchJson\(`\/api\/admin\/products\/\$\{id\}`, payload\)/, 'editing a product uses PATCH without id in its body');
assert.match(products, /else await postJson\('\/api\/admin\/products', payload\)/, 'creating a product uses POST without an id');

const landing = await readFile(new URL('../web/src/pages/PublicLanding.tsx', import.meta.url), 'utf8');
assert.match(landing, /Planes de servicios Web/);
assert.match(landing, /Planes de hardware/);

const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
assert.match(server, /error\.code === '23505'.*status\(409\)/, 'duplicate database codes still map to HTTP 409');
