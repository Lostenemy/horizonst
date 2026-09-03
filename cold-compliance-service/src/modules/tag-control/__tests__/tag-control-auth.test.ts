import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('Horneo no monta ni conserva el router HTTP /tag-control', () => {
  const app = readFileSync(path.resolve(process.cwd(), 'src/app.ts'), 'utf8');
  const routes = path.resolve(process.cwd(), 'src/modules/tag-control/tag-control.routes.ts');

  assert.doesNotMatch(app, /tagControlRouter|app\.use\(['"]\/tag-control/);
  assert.equal(existsSync(routes), false);
});
