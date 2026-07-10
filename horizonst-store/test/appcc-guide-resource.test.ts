import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const publicRoot = path.join(root, 'web', 'public');
const guide = path.join(publicRoot, 'recursos', 'guia-appcc-2026.pdf');
const source = await readFile(path.join(root, 'resources', 'appcc-guide', 'guia-appcc-2026.md'), 'utf8');
const bytes = await readFile(guide);
assert.ok((await stat(guide)).size > 10_000, 'the guide is not empty');
assert.match(bytes.subarray(0, 8).toString('ascii'), /^%PDF-1\.[0-9]$/, 'the guide has a valid PDF signature');
const documentText = bytes.toString('latin1');
const pageCount = (documentText.match(/\/Type \/Page\b/g) ?? []).length;
assert.ok(pageCount >= 6 && pageCount <= 10, 'the guide has the expected page count');
assert.ok(documentText.includes('HorizonST') && documentText.includes('seguridad'), 'PDF has selectable guide text');
assert.equal(documentText.includes('Javier Baraza'), false, 'PDF does not include developer metadata');
for (const expected of ['Guía 2026 para la seguridad de trabajadores en cámaras congeladoras', 'HorizonST', 'carácter informativo y orientativo', 'trazabilidad', 'incidencias', 'Checklist', 'Ley 31/1995', 'Real Decreto 486/1997', 'INSST', 'BOE']) assert.ok(source.includes(expected), `source includes ${expected}`);
for (const forbidden of ['garantiza el cumplimiento', 'evita sanciones', 'riesgo cero', '3.250 €', '6.500 €', '12.995 €', 'Gateway BLE', 'Tag BLE', 'BLE']) assert.equal(source.includes(forbidden), false, `source omits ${forbidden}`);

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
await run(process.execPath, ['scripts/generate-appcc-guide.mjs'], { cwd: root });
const firstBuild = await readFile(guide);
await run(process.execPath, ['scripts/generate-appcc-guide.mjs'], { cwd: root });
assert.equal(sha256(await readFile(guide)), sha256(firstBuild), 'the guide is deterministic across consecutive builds');

const app = createServer(publicRoot);
const server = app.listen(0);
try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/recursos/guia-appcc-2026.pdf`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition') ?? '', /inline; filename="guia-appcc-2026-horizonst.pdf"/);
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/recursos/inexistente.pdf`)).status, 404);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
