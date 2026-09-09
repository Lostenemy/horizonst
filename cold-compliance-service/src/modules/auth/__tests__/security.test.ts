import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { resetPasswordWithToken, validPassword } from '../password-reset';
import { db } from '../../../db/pool';
import { requireAuth } from '../../../middleware/auth';
import { errorHandler } from '../../../middleware/error-handler';

const { resetFixture } = require(path.resolve(process.cwd(), '../scripts/reset-transaction-fixture.cjs'));
const originalQuery = db.query;
afterEach(() => { db.query = originalQuery; });

test('password policy rejects missing, short and bcrypt-truncated passwords', () => {
  for (const password of [undefined, '', 'short', 'a'.repeat(73), 'é'.repeat(37)]) assert.equal(validPassword(password), false);
  assert.equal(validPassword('a'.repeat(10)), true);
  assert.equal(validPassword('é'.repeat(36)), true);
});

test('concurrent Horneo resets have one winner and revoke all prior sessions', async () => {
  const fixture = resetFixture();
  const results = await Promise.all([resetPasswordWithToken(fixture.pool, 'fixture', 'valid-password'), resetPasswordWithToken(fixture.pool, 'fixture', 'other-password')]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(fixture.state.sessions, 0);
  assert.equal(fixture.state.revoked, true);
  assert.equal(fixture.released, 2);
});

test('reset failure rolls back password, token consumption and session deletion', async () => {
  const fixture = resetFixture(true);
  await assert.rejects(resetPasswordWithToken(fixture.pool, 'fixture', 'valid-password'), /injected/);
  assert.deepEqual(fixture.state, { consumed: false, password: 'before', sessions: 2, revoked: false });
  assert.equal(fixture.released, 1);
});

test('query tokens do not authenticate; revoked sessions fail closed', async () => {
  let queries = 0;
  (db as any).query = async () => { queries++; return { rows: [] }; };
  const res: any = { code: 200, status(code: number) { this.code = code; return this; }, json() { return this; } };
  let passed = false;
  await requireAuth({ header: () => undefined, query: { access_token: 'fixture' } } as any, res, () => { passed = true; });
  assert.equal(res.code, 401);
  assert.equal(queries, 0);
  await requireAuth({ header: () => 'Bearer revoked', query: {} } as any, res, () => { passed = true; });
  assert.equal(res.code, 401);
  assert.equal(passed, false);
});

test('500 responses do not expose exception details and include correlation', () => {
  const res: any = { headers: {} as any, setHeader(key: string, value: string) { this.headers[key] = value; }, status() { return this; }, json(body: any) { this.body = body; } };
  errorHandler(new Error('SELECT secret FROM private_table'), {} as any, res, () => {});
  assert.doesNotMatch(JSON.stringify(res.body), /secret|private_table|SELECT/);
  assert.equal(res.body.error, 'internal_error');
  assert.equal(res.body.requestId, res.headers['X-Request-Id']);
});

test('worker and user views escape stored markup and retain audited controls', async () => {
  const source = readFileSync(path.resolve(process.cwd(), 'web/app.js'), 'utf8');
  const elements: Record<string, any> = {};
  const context = vm.createContext({
    localStorage: { getItem: () => '' },
    document: { getElementById: (id: string) => elements[id] ||= { innerHTML: '', value: '', hidden: false }, querySelectorAll: () => [] },
    window: { innerWidth: 1200 }, console
  });
  vm.runInContext(source.slice(0, source.indexOf('(function wireLoginForm()')), context);
  const bad = '<img src=x onerror="alert(1)">';
  const worker = { id: 'worker-1', full_name: bad, dni: bad, current_tag_uid: bad, role: bad, active: true };
  context.fixture = worker;
  vm.runInContext("api = async (url) => url === '/workers' ? [fixture] : []; currentUser = { email: fixture.full_name, role: 'administrador' };", context);
  await vm.runInContext('renderAssignments()', context);
  assert.ok(elements.assignments.innerHTML.includes('&lt;img'));
  assert.ok(!elements.assignments.innerHTML.includes('<img'));
  assert.ok(elements.assignments.innerHTML.includes('<button'));
  vm.runInContext('setSessionText()', context);
  assert.ok(!elements.sessionBox.innerHTML.includes('<img'));
  vm.runInContext('setSessionText(3, 2)', context);
  assert.match(elements.sessionBox.innerHTML, /dentro: 3/);
  assert.match(elements.sessionBox.innerHTML, /<a class="header-alert-badge"/);
  const output = vm.runInContext("table(['Nombre'], [[fixture.full_name], [htmlCell('<button>Editar</button>')], [{html: fixture.full_name}]])", context);
  assert.match(output, /<button>Editar<\/button>/);
  assert.ok(!output.includes('<img'));
  assert.equal(vm.runInContext("actionId(\"');alert(1);//\")", context), '');
  assert.match(source, /fetch\('\/realtime\/stream', \{ headers: \{ Authorization:/);
  assert.doesNotMatch(source, /stream\?access_token/);
});
