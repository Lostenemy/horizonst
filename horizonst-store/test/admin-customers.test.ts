import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canChangeCustomerStatus } from '../src/modules/admin/customers.routes.js';

assert.equal(canChangeCustomerStatus('pending_email_verification', 'active'), true);
assert.equal(canChangeCustomerStatus('pending_email_verification', 'closed'), true);
assert.equal(canChangeCustomerStatus('active', 'suspended'), true);
assert.equal(canChangeCustomerStatus('suspended', 'active'), true);
assert.equal(canChangeCustomerStatus('active', 'closed'), true);
assert.equal(canChangeCustomerStatus('suspended', 'closed'), true);
assert.equal(canChangeCustomerStatus('closed', 'active'), false, 'closed is final');
assert.equal(canChangeCustomerStatus('pending_email_verification', 'suspended'), false, 'pending customers cannot be suspended directly');
assert.equal(canChangeCustomerStatus('admin', 'active'), false, 'roles are not statuses');

const router = await readFile(new URL('../src/modules/admin/customers.routes.ts', import.meta.url), 'utf8');
assert.match(router, /adminCustomersRouter\.use\(requireAuth, requireRole\('admin'\)\)/, 'customers require an authenticated administrator');
assert.match(router, /\.strict\(\)/, 'query and body schemas are strict');
assert.match(router, /role = 'customer'/g, 'all customer queries exclude administrators and distributors');
assert.doesNotMatch(router, /password_hash/, 'customer responses never select password hashes');
assert.match(router, /FOR UPDATE/, 'status changes lock the customer row');
assert.match(router, /UPDATE store\.email_verification_tokens SET revoked_at = now\(\)/, 'manual activation revokes verification tokens');
assert.match(router, /UPDATE store\.refresh_tokens SET revoked_at = now\(\)/, 'suspension and closure revoke refresh tokens');
assert.match(router, /entityType: 'customer'/, 'status changes are audited as customers');
assert.match(router, /previous_status: customer\.status, status: input\.status/, 'audit records both status values');

const auth = await readFile(new URL('../src/modules/auth/auth.routes.ts', import.meta.url), 'utf8');
assert.match(auth, /user\.status !== 'active'/, 'suspended customers cannot log in');
assert.match(auth, /u\.status = 'active'/, 'suspended customers cannot refresh sessions');

const customersPage = await readFile(new URL('../web/src/pages/admin/AdminCustomers.tsx', import.meta.url), 'utf8');
assert.match(customersPage, /Activar/);
assert.match(customersPage, /Suspender/);
assert.match(customersPage, /Reactivar/);
assert.match(customersPage, /cerrar definitivamente esta cuenta/);
assert.match(customersPage, /\/api\/admin\/customers\/\$\{customer\.id\}\/status/);

const app = await readFile(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /path="\/admin\/customers" element=\{<AdminCustomers \/>\}/);
const shell = await readFile(new URL('../web/src/pages/admin/AdminShell.tsx', import.meta.url), 'utf8');
assert.match(shell, /\['\/admin\/customers', 'Clientes'\]/);
