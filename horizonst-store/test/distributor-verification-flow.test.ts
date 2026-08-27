import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import path from 'node:path';
import { buildDistributorWelcomeEmail } from '../src/modules/shared/mail.js';
import { canApproveDistributorDocuments } from '../src/modules/admin/distributors.routes.js';
import { calculateLineTotals, getDistributorDiscountPercent } from '../src/modules/cart/cart.service.js';
import { canReplaceDistributorDocument, isAllowedDistributorDocumentType, missingApprovedDistributorDocuments, requiredDistributorDocuments } from '../src/resources/distributor-required-documents.js';
import { createDistributorRouter } from '../src/modules/distributor/distributor.routes.js';
import { distributorBrochurePath } from '../src/resources/distributor-brochure.js';

const es = requiredDistributorDocuments('ES');
const gb = requiredDistributorDocuments('GB');
const generic = requiredDistributorDocuments('DE');
assert.deepEqual(es.map((document) => document.code), ['tax_id', 'census_registration', 'business_registration']);
assert.deepEqual(gb.map((document) => document.code), ['company_registration', 'tax_id', 'business_activity']);
assert.deepEqual(generic.map((document) => document.code), ['tax_id', 'company_registration', 'business_activity']);
assert.equal(isAllowedDistributorDocumentType('ES', 'census_registration'), true);
assert.equal(isAllowedDistributorDocumentType('GB', 'census_registration'), false);

const approvedSpain = [
  { document_type: 'tax_id', status: 'approved' },
  { document_type: 'modelo_036', status: 'approved' },
  { document_type: 'escrituras', status: 'approved' }
];
assert.equal(canApproveDistributorDocuments('ES', approvedSpain), true, 'legacy Spanish documents satisfy the equivalent centralized requirements');
assert.equal(canApproveDistributorDocuments('ES', approvedSpain.slice(0, 2)), false, 'missing required document blocks approval');
assert.deepEqual(missingApprovedDistributorDocuments('GB', [{ document_type: 'company_registration', status: 'pending' }]).map((document) => document.code), ['company_registration', 'tax_id', 'business_activity']);
assert.equal(canReplaceDistributorDocument('pending'), true);
assert.equal(canReplaceDistributorDocument('rejected'), true);
assert.equal(canReplaceDistributorDocument('approved'), false);

const discountClient = (validation_status: string) => ({ query: async () => ({ rows: [{ validation_status, discount_percent: '10.00' }] }) });
assert.equal(await getDistributorDiscountPercent('user', 'distributor', discountClient('pending')), '0', 'pending distributor has no discount');
assert.equal(await getDistributorDiscountPercent('user', 'distributor', discountClient('approved')), '10.00', 'approved distributor receives configured discount');
assert.equal(calculateLineTotals({ quantity: 1, unitPriceCents: 10000, discountPercent: await getDistributorDiscountPercent('user', 'distributor', discountClient('approved')), taxRate: 21 }).line_discount_cents, 1000, 'approved discount reaches quote pricing');

const mailInput = { email: 'partner@example.test', fullName: 'Partner', verificationUrl: 'https://store.example.test/verify', expiresInSeconds: 3600 };
const esMail = buildDistributorWelcomeEmail({ ...mailInput, countryCode: 'ES' }, Buffer.from('%PDF'));
const gbMail = buildDistributorWelcomeEmail({ ...mailInput, countryCode: 'GB' }, Buffer.from('%PDF'));
assert.match(esMail.text, /modelo 036\/037/i); assert.match(gbMail.text, /Companies House/);
assert.match(esMail.text, /Portal distribuidor > Mis documentos/);
assert.equal(esMail.attachments?.[0]?.filename, 'HorizonST_Frio.pdf', 'welcome dossier remains attached');

const distributorRoutes = await readFile(new URL('../src/modules/distributor/distributor.routes.ts', import.meta.url), 'utf8');
assert.match(distributorRoutes, /readMultipartForm\(req, maxBytes\)/, 'verification upload consumes multipart PDF');
assert.match(distributorRoutes, /canReplaceDistributorDocument/, 'pending and rejected uploads can be replaced');
assert.match(distributorRoutes, /dp\.user_id = \$2 AND dd\.status <> 'replaced'/, 'private document download is owner scoped');
assert.match(distributorRoutes, /`\$\{randomUUID\(\)\}\.pdf`/, 'stored files use generated names');
assert.match(distributorRoutes, /mimeType !== 'application\/pdf'.*path\.extname.*%PDF/s, 'PDF MIME, extension and signature are validated');

const adminRoutes = await readFile(new URL('../src/modules/admin/distributors.routes.ts', import.meta.url), 'utf8');
assert.match(adminRoutes, /missingApprovedDistributorDocuments/, 'admin approval checks every country requirement');
assert.match(adminRoutes, /Cannot approve distributor before email verification/);
assert.match(adminRoutes, /input\.status === 'rejected'.*needs_more_info/s, 'rejection removes an existing approval');
assert.match(adminRoutes, /review_notes is required when rejecting/, 'rejections require a visible reason');

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const privatePool = {
  async query(_sql: string, params?: unknown[]) {
    return { rows: params?.[0] === documentId && params?.[1] === ownerId ? [{ file_path: distributorBrochurePath, file_name: 'verificacion.pdf', mime_type: 'application/pdf' }] : [] };
  },
  connect: async () => { throw new Error('not used'); }
};
const privateApp = express();
privateApp.use('/api/distributor', createDistributorRouter({
  pool: privatePool,
  authMiddleware: (req, res, next) => {
    const userId = req.header('x-test-user');
    if (!userId) { res.status(401).json({ error: 'Authentication required' }); return; }
    req.user = { sub: userId, role: 'distributor', status: 'active' } as any; next();
  },
  roleMiddleware: (_req, _res, next) => next(),
  audit: async () => undefined,
  documentsPath: path.dirname(distributorBrochurePath)
}));
const privateServer = privateApp.listen(0);
try {
  const address = privateServer.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/distributor/documents/${documentId}/download`;
  const ownDownload = await fetch(url, { headers: { 'x-test-user': ownerId } });
  assert.equal(ownDownload.status, 200); assert.equal(ownDownload.headers.get('content-type'), 'application/pdf');
  await ownDownload.arrayBuffer();
  const otherDownload = await fetch(url, { headers: { 'x-test-user': otherId } }); assert.equal(otherDownload.status, 404, 'another distributor receives 404 for a private document'); await otherDownload.text();
  const unauthenticatedDownload = await fetch(url); assert.equal(unauthenticatedDownload.status, 401, 'private documents require authentication'); await unauthenticatedDownload.text();
} finally {
  await new Promise<void>((resolve, reject) => privateServer.close((error) => error ? reject(error) : resolve()));
}

const migration = await readFile(new URL('../migrations/015_distributor_verification_and_catalog.sql', import.meta.url), 'utf8');
assert.match(migration, /DROP CONSTRAINT IF EXISTS distributor_documents_document_type_check/);
assert.match(migration, /'business_activity'/);
assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE|DROP COLUMN/, 'migration is additive and preserves data');
