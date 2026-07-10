import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'web', 'public');
const guide = path.join(publicRoot, 'recursos', 'guia-appcc-2026.pdf');
const source = await readFile(path.join(root, 'resources', 'appcc-guide', 'guia-appcc-2026.md'), 'utf8');
const bytes = await readFile(guide);
assert.ok((await stat(guide)).size > 10_000, 'the guide is not empty');
assert.match(bytes.subarray(0, 8).toString('ascii'), /^%PDF-1\.[0-9]$/, 'the guide has a valid PDF signature');
const documentText = bytes.toString('latin1');
const pageCount = (documentText.match(/\/Type \/Page\b/g) ?? []).length;
assert.ok(pageCount >= 14 && pageCount <= 24, 'the guide has the expected page count');
assert.ok(documentText.includes('HorizonST') && documentText.includes('APPCC'), 'PDF has selectable guide text');
assert.equal(documentText.includes('Javier Baraza'), false, 'PDF does not include developer metadata');
for (const expected of ['Guía APPCC 2026 para cámaras frigoríficas', 'HorizonST', 'carácter informativo y orientativo', 'trazabilidad', 'acciones correctivas', 'calibración', 'exposición al frío', 'Checklist', 'Bibliografía', 'https://horizonst.com.es/planes', 'comercial@horizonst.es']) assert.ok(source.includes(expected), `source includes ${expected}`);
for (const forbidden of ['garantiza el cumplimiento', 'evita sanciones', 'riesgo cero', '3.250 €', '6.500 €', '12.995 €', 'Gateway BLE', 'Tag BLE']) assert.equal(source.includes(forbidden), false, `source omits ${forbidden}`);

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
