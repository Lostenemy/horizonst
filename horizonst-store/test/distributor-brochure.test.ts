import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import express from 'express';

import { distributorBrochureFilename, distributorBrochurePath } from '../src/resources/distributor-brochure.js';
import { distributorRouter } from '../src/modules/distributor/distributor.routes.js';
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

const distributorRoutes = await readFile(new URL('../src/modules/distributor/distributor.routes.ts', import.meta.url), 'utf8');
assert.match(distributorRoutes, /use\(requireAuth, requireRole\('distributor'\)\)/, 'brochure routes are protected for distributors');
assert.match(distributorRoutes, /resources\/cold-brochure/, 'the distributor brochure has a download endpoint');
assert.match(distributorRoutes, /res\.download\(distributorBrochurePath/, 'the endpoint sends the canonical brochure');

const app = express();
app.use('/api/distributor', distributorRouter);
const server = app.listen(0);
try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/distributor/resources/cold-brochure`);
  assert.equal(response.status, 401, 'the brochure cannot be downloaded without authentication');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const profilePage = await readFile(new URL('../web/src/pages/DistributorProfile.tsx', import.meta.url), 'utf8');
assert.match(profilePage, /Descargar dossier de frío/);
assert.match(profilePage, /downloadFile\('\/api\/distributor\/resources\/cold-brochure'/, 'the portal uses an authenticated download');

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
assert.match(dockerfile, /COPY resources \.\/resources/, 'the production image includes the brochure');
