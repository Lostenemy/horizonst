import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { adminDistributorResourceUpdateSchema, adminDistributorResourceUploadSchema } from '../src/modules/admin/distributor-resources.routes.js';
import { createDistributorResourcesRouter } from '../src/modules/distributor/resources.routes.js';
import { requireRole } from '../src/modules/auth/middleware.js';
import { distributorResourceMaxBytes, resolveDistributorResourcePath, validateDistributorResourcePdf } from '../src/resources/distributor-resource-documents.js';
import { safeDownloadFilename } from '../src/modules/shared/multipart.js';

const distributorId = '11111111-1111-4111-8111-111111111111';
const otherDistributorId = '22222222-2222-4222-8222-222222222222';
const globalResourceId = '00000000-0000-4000-8000-000000000014';
const targetedResourceId = '33333333-3333-4333-8333-333333333333';
assert.equal(adminDistributorResourceUploadSchema.safeParse({ title: 'Catálogo', category: 'commercial', visibility: 'global', distributor_user_ids: [] }).success, true, 'an admin can describe a global resource');
assert.equal(adminDistributorResourceUploadSchema.safeParse({ title: 'Tarifa privada', category: 'pricing', visibility: 'targeted', distributor_user_ids: [distributorId] }).success, true, 'an admin can describe a targeted resource');
assert.equal(adminDistributorResourceUploadSchema.safeParse({ title: 'Sin destinatario', category: 'pricing', visibility: 'targeted', distributor_user_ids: [] }).success, false, 'targeted resources require a distributor');
assert.equal(adminDistributorResourceUpdateSchema.parse({ active: false }).active, false, 'a resource can be archived without physical deletion');

const pdf = { buffer: Buffer.from('%PDF-1.7\nresource'), originalFilename: 'catalogo.pdf', mimeType: 'application/pdf' };
assert.doesNotThrow(() => validateDistributorResourcePdf(pdf));
assert.throws(() => validateDistributorResourcePdf({ ...pdf, originalFilename: 'catalogo.exe' }), /PDF/);
assert.throws(() => validateDistributorResourcePdf({ ...pdf, mimeType: 'application/octet-stream' }), /PDF/);
assert.throws(() => validateDistributorResourcePdf({ ...pdf, buffer: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(distributorResourceMaxBytes)]) }), /20 MB/);
assert.equal(safeDownloadFilename('../../contrato\r\nmalicioso.pdf'), 'contrato__malicioso.pdf', 'download filenames cannot inject paths or headers');
assert.throws(() => resolveDistributorResourcePath({ storage_kind: 'uploaded', storage_key: '../private.pdf' }), /Invalid resource path/, 'path traversal is rejected');

const migration = await readFile(new URL('../migrations/014_distributor_resources.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS store\.distributor_resource_documents/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS store\.distributor_resource_assignments/);
assert.match(migration, /document_id UUID NOT NULL REFERENCES store\.distributor_resource_documents\(id\) ON DELETE CASCADE/);
assert.match(migration, /distributor_user_id UUID NOT NULL REFERENCES store\.users\(id\) ON DELETE RESTRICT/);
assert.match(migration, /file_size_bytes BIGINT NOT NULL CHECK \(file_size_bytes > 0 AND file_size_bytes <= 20971520\)/);
assert.match(migration, /PRIMARY KEY \(document_id, distributor_user_id\)/, 'duplicate assignments are impossible');

const adminRoutes = await readFile(new URL('../src/modules/admin/distributor-resources.routes.ts', import.meta.url), 'utf8');
assert.match(adminRoutes, /use\(requireAuth, requireRole\('admin'\)\)/, 'only administrators reach resource management');
for (const route of [/\.get\('\/distributor-resources'/, /\.post\('\/distributor-resources'/, /\.patch\('\/distributor-resources\/:id'/, /\.delete\('\/distributor-resources\/:id'/, /\.get\('\/distributor-resources\/:id\/download'/]) assert.match(adminRoutes, route);
assert.match(adminRoutes, /randomUUID\(\).*\.pdf/, 'physical filenames are generated internally');
assert.match(adminRoutes, /writeFile\(storedPath, multipart\.file\.buffer, \{ flag: 'wx' \}\)/, 'uploads cannot overwrite an existing file');
assert.match(adminRoutes, /ensureDistributorUsers/, 'target assignments are restricted to real distributor users');
for (const action of ['distributor_resource_uploaded', 'distributor_resource_updated', 'distributor_resource_archived']) assert.match(adminRoutes, new RegExp(action), `${action} is audited`);

const distributorRoutes = await readFile(new URL('../src/modules/distributor/resources.routes.ts', import.meta.url), 'utf8');
assert.match(distributorRoutes, /roleMiddleware \?\? requireRole\('distributor'\)/, 'resource endpoints require the distributor role');
assert.match(distributorRoutes, /d\.active = true/, 'inactive documents are never listed or downloaded');
assert.match(distributorRoutes, /a\.distributor_user_id = \$1/, 'listing filters targeted resources by the authenticated distributor');
assert.match(distributorRoutes, /a\.distributor_user_id = \$2/, 'download prevents IDOR with the authenticated distributor id');
assert.match(distributorRoutes, /res\.status\(404\)/, 'inaccessible document ids do not reveal documents owned by another distributor');
assert.match(distributorRoutes, /safeDownloadFilename/, 'Content-Disposition uses a sanitized filename');

const brochurePath = resolveDistributorResourcePath({ storage_kind: 'bundled', storage_key: 'distributors/HorizonST_Frio.pdf' });
const resourceRow = (id: string, visibility: 'global' | 'targeted') => ({ id, title: visibility === 'global' ? 'Dossier global' : 'Tarifa privada', description: null, original_filename: 'HorizonST_Frio.pdf', mime_type: 'application/pdf', file_size_bytes: 1042254, visibility, category: 'commercial', published_at: new Date().toISOString(), created_at: new Date().toISOString(), storage_kind: 'bundled', storage_key: 'distributors/HorizonST_Frio.pdf' });
const resourceApp = express();
resourceApp.use((req: any, _res, next) => { req.user = { sub: String(req.headers['x-test-user'] ?? distributorId), role: 'distributor' }; next(); });
resourceApp.use(createDistributorResourcesRouter({
  authMiddleware: (_req, _res, next) => next(), roleMiddleware: (_req, _res, next) => next(), audit: async () => undefined,
  resolvePath: () => brochurePath,
  query: async (sql, values = []) => {
    const userId = String(values.at(-1));
    if (sql.includes('d.title')) return { rows: [resourceRow(globalResourceId, 'global'), ...(userId === distributorId ? [resourceRow(targetedResourceId, 'targeted')] : [])] };
    const documentId = String(values[0]);
    if (documentId === globalResourceId || (documentId === targetedResourceId && userId === distributorId)) return { rows: [resourceRow(documentId, documentId === globalResourceId ? 'global' : 'targeted')] };
    return { rows: [] };
  }
}));
const resourceServer = resourceApp.listen(0);
try {
  const address = resourceServer.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const ownList = await fetch(`${base}/resources`, { headers: { 'x-test-user': distributorId } });
  assert.deepEqual((await ownList.json() as any).resources.map((item: any) => item.id), [globalResourceId, targetedResourceId], 'a distributor lists global and specifically assigned resources');
  const otherList = await fetch(`${base}/resources`, { headers: { 'x-test-user': otherDistributorId } });
  assert.deepEqual((await otherList.json() as any).resources.map((item: any) => item.id), [globalResourceId], 'a distributor cannot list another distributor’s targeted resource');
  const globalDownload = await fetch(`${base}/resources/${globalResourceId}/download`, { headers: { 'x-test-user': otherDistributorId } });
  assert.equal(globalDownload.status, 200); assert.equal(globalDownload.headers.get('content-type'), 'application/pdf'); assert.match(globalDownload.headers.get('content-disposition') ?? '', /HorizonST_Frio\.pdf/);
  assert.equal((await globalDownload.arrayBuffer()).byteLength, 1042254, 'the dossier downloads effectively from the new centre');
  assert.equal((await fetch(`${base}/resources/${targetedResourceId}/download`, { headers: { 'x-test-user': otherDistributorId } })).status, 404, 'knowing another distributor’s document id does not bypass assignment');
} finally { await new Promise<void>((resolve, reject) => resourceServer.close((error) => error ? reject(error) : resolve())); }

const roleApp = express();
roleApp.post('/admin-upload', (req: any, _res, next) => { req.user = { sub: distributorId, role: 'distributor' }; next(); }, requireRole('admin'), (_req, res) => res.sendStatus(201));
const roleServer = roleApp.listen(0);
try {
  const address = roleServer.address(); assert.ok(address && typeof address === 'object');
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/admin-upload`, { method: 'POST' })).status, 403, 'a non-admin cannot upload resources');
} finally { await new Promise<void>((resolve, reject) => roleServer.close((error) => error ? reject(error) : resolve())); }

const compose = await readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
assert.match(compose, /STORE_DOCUMENTS_PATH=\/opt\/horizonst\/store-data\/documents/);
assert.match(compose, /\/opt\/horizonst\/store-data\/documents:\/opt\/horizonst\/store-data\/documents/, 'uploaded resources persist outside container rebuilds');

const profile = await readFile(new URL('../web/src/pages/DistributorProfile.tsx', import.meta.url), 'utf8');
const resourceUi = await readFile(new URL('../web/src/pages/DistributorResources.tsx', import.meta.url), 'utf8');
const adminUi = await readFile(new URL('../web/src/pages/admin/AdminDistributorResources.tsx', import.meta.url), 'utf8');
assert.match(profile, /Documentación HorizonST/); assert.match(profile, /Mis documentos/);
assert.match(resourceUi, /No hay documentación disponible en este momento/); assert.match(resourceUi, /Descargar/);
assert.match(adminUi, /Todos los distribuidores/); assert.match(adminUi, /Distribuidores específicos/); assert.match(adminUi, /PDF, máximo 20 MB/);
