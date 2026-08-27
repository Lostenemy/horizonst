import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import express from 'express';

import { distributorBrochureFilename, distributorBrochurePath } from '../src/resources/distributor-brochure.js';
import { distributorResourcesRouter } from '../src/modules/distributor/resources.routes.js';
import { resolveDistributorResourcePath } from '../src/resources/distributor-resource-documents.js';
import { sendDistributorWelcomeEmail } from '../src/modules/shared/mail.js';
import type { MailContent } from '../src/modules/shared/mail.js';

const brochure = await readFile(distributorBrochurePath);
assert.equal(distributorBrochureFilename, 'HorizonST_Frio.pdf');
assert.ok((await stat(distributorBrochurePath)).size > 100_000, 'the distributor brochure is not empty');
assert.match(brochure.subarray(0, 8).toString('ascii'), /^%PDF-1\.[0-9]$/, 'the distributor brochure has a valid PDF signature');

let delivered: MailContent | undefined;
await sendDistributorWelcomeEmail({ email: 'distribuidor@example.test', fullName: 'Distribuidor', verificationUrl: 'https://tienda.horizonst.es/verify-email?token=test-token', expiresInSeconds: 3600 }, async (mail) => { delivered = mail; });
assert.equal(delivered?.attachments?.[0]?.filename, distributorBrochureFilename);
assert.deepEqual(delivered?.attachments?.[0]?.content, brochure, 'the welcome email attaches the published brochure bytes');

const authRoutes = await readFile(new URL('../src/modules/auth/auth.routes.ts', import.meta.url), 'utf8');
assert.match(authRoutes, /sendDistributorWelcomeEmail/, 'distributor registration sends the dedicated welcome email');
assert.match(authRoutes, /role IN \('customer', 'distributor'\)/, 'distributors can request another verification and welcome email');

const distributorRoutes = await readFile(new URL('../src/modules/distributor/resources.routes.ts', import.meta.url), 'utf8');
assert.match(distributorRoutes, /authMiddleware \?\? requireAuth/); assert.match(distributorRoutes, /roleMiddleware \?\? requireRole\('distributor'\)/, 'resource routes are protected for distributors');
assert.match(distributorRoutes, /resources\/:id\/download/, 'the brochure is downloaded through the protected document centre');
assert.match(distributorRoutes, /d\.visibility = 'global'.*distributor_resource_assignments/s, 'listing and download enforce global or assigned visibility');
assert.equal(resolveDistributorResourcePath({ storage_kind: 'bundled', storage_key: 'distributors/HorizonST_Frio.pdf' }), distributorBrochurePath, 'the seeded resource resolves to the canonical brochure without duplication');

const migration = await readFile(new URL('../migrations/014_distributor_resources.sql', import.meta.url), 'utf8');
assert.match(migration, /Dossier HorizonST · Soluciones de frío/);
assert.match(migration, /distributors\/HorizonST_Frio\.pdf/);
assert.match(migration, /'global', 'commercial', true/, 'the dossier is seeded as an active global commercial resource');

const app = express();
app.use('/api/distributor', distributorResourcesRouter);
const server = app.listen(0);
try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/distributor/resources`);
  assert.equal(response.status, 401, 'the document centre cannot be listed without authentication');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const profilePage = await readFile(new URL('../web/src/pages/DistributorProfile.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(profilePage, /Descargar dossier de frío/, 'the isolated brochure button is removed');
assert.match(profilePage, /Documentación HorizonST/);
const resourcesPage = await readFile(new URL('../web/src/pages/DistributorResources.tsx', import.meta.url), 'utf8');
assert.match(resourcesPage, /downloadFile\(`\/api\/distributor\/resources\/\$\{resource\.id\}\/download`/, 'the document centre uses authenticated downloads');

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
assert.match(dockerfile, /COPY resources \.\/resources/, 'the production image includes the brochure');
