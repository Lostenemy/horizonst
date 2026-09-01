import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { requireRoles } from '../../../middleware/auth';

test('tag-control HTTP routes require authentication and technical mutations require superadministrador', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/modules/tag-control/tag-control.routes.ts'), 'utf8');
  assert.match(source, /tagControlRouter\.use\(requireAuth\)/);
  for (const route of ['led', 'buzzer', 'vibration', 'custom', 'custom-alert', 'templates']) {
    assert.match(source, new RegExp(`post\\('/${route}'.*requireTechnicalAdmin`));
  }
  assert.match(source, /patch\('\/templates\/:id', requireTechnicalAdmin/);
});

test('non-superadmin cannot pass technical mutation role guard', () => {
  const guard = requireRoles(['superadministrador']);
  let statusCode = 0;
  let nextCalled = false;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json() { return this; }
  } as any;

  guard({ authUser: { id: 'a', role: 'supervisor', email: 'a@example.test' } } as any, response, () => { nextCalled = true; });
  assert.equal(statusCode, 403);
  assert.equal(nextCalled, false);

  statusCode = 0;
  guard({ authUser: { id: 'b', role: 'superadministrador', email: 'b@example.test' } } as any, response, () => { nextCalled = true; });
  assert.equal(statusCode, 0);
  assert.equal(nextCalled, true);
});
