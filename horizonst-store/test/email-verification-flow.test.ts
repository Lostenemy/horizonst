import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { consumeEmailVerificationToken } from '../src/modules/auth/auth.routes.js';
import { createAdminCustomersRouter } from '../src/modules/admin/customers.routes.js';

const request = async (app: express.Express, path: string) => {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const tokenRows = [
  { id: 'used-token', userId: 'customer', usedAt: null as Date | null, revokedAt: null as Date | null },
  { id: 'pending-token', userId: 'customer', usedAt: null as Date | null, revokedAt: null as Date | null },
  { id: 'other-user-token', userId: 'other', usedAt: null as Date | null, revokedAt: null as Date | null }
];
await consumeEmailVerificationToken({
  query: async (sql: string, values: string[]) => {
    if (sql.includes('SET used_at')) {
      const row = tokenRows.find((token) => token.id === values[0]);
      if (row) { row.usedAt = new Date(); row.revokedAt = new Date(); }
    } else {
      for (const row of tokenRows) {
        if (row.userId === values[1] && row.id !== values[0] && !row.usedAt && !row.revokedAt) row.revokedAt = new Date();
      }
    }
    return { rows: [] };
  }
}, 'used-token', 'customer');
assert.ok(tokenRows[0].usedAt && tokenRows[0].revokedAt, 'the validated token is marked used and revoked');
assert.equal(tokenRows[1].usedAt, null, 'other pending tokens are not marked used');
assert.ok(tokenRows[1].revokedAt, 'other pending tokens are revoked');
assert.equal(tokenRows[2].revokedAt, null, 'tokens for other users are unchanged');

const customerId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const makeAdminApp = (mailFails: boolean) => {
  const calls: string[] = [];
  const audits: unknown[] = [];
  const logs: string[] = [];
  let deliveredToken = '';
  const client = {
    query: async (sql: string) => {
      if (sql.includes('FROM store.users WHERE id')) {
        return { rows: [{ id: customerId, email: 'customer@example.com', full_name: 'Customer', status: 'pending_email_verification' }] };
      }
      if (sql.includes('MAX(created_at)')) return { rows: [{ last_sent_at: null, sent_last_hour: 0 }] };
      return { rows: [] };
    },
    release: () => undefined
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createAdminCustomersRouter({
    pool: { connect: async () => client } as any,
    authMiddleware: (req, _res, next) => { req.user = { sub: adminId, role: 'admin', status: 'active' } as any; next(); },
    roleMiddleware: (_req, _res, next) => next(),
    publicBaseUrl: 'https://store.example.com',
    sendVerificationEmail: async ({ verificationUrl }) => {
      calls.push('smtp');
      deliveredToken = new URL(verificationUrl).searchParams.get('token') ?? '';
      if (mailFails) throw new Error(`SMTP rejected ${deliveredToken}`);
    },
    audit: async (entry) => { calls.push('audit'); audits.push(entry); },
    sanitizeEmailError: (error) => error instanceof Error ? error.message : String(error),
    logEmailError: (message, error) => logs.push(`${message}: ${error}`)
  }));
  return { app, calls, audits, logs, getDeliveredToken: () => deliveredToken };
};

const successfulResend = makeAdminApp(false);
const successfulResponse = await request(successfulResend.app, `/api/admin/customers/${customerId}/resend-verification`);
assert.equal(successfulResponse.status, 200);
assert.deepEqual(successfulResend.calls, ['smtp', 'audit'], 'admin resend is audited only after SMTP succeeds');
assert.equal(successfulResend.audits.length, 1);
assert.ok(successfulResend.getDeliveredToken());
assert.ok(!JSON.stringify(successfulResend.audits).includes(successfulResend.getDeliveredToken()), 'the verification token is absent from audit data');

const failedResend = makeAdminApp(true);
const failedResponse = await request(failedResend.app, `/api/admin/customers/${customerId}/resend-verification`);
assert.equal(failedResponse.status, 502, 'an administrative SMTP failure returns an upstream error');
assert.match(String(failedResponse.body.error), /^No se pudo enviar el correo de verificaci/);
assert.deepEqual(failedResend.calls, ['smtp'], 'failed SMTP delivery is not audited as a successful resend');
assert.equal(failedResend.audits.length, 0);
assert.ok(failedResend.getDeliveredToken());
assert.ok(!failedResend.logs.join('\n').includes(failedResend.getDeliveredToken()), 'the verification token is redacted from SMTP error logs');

const auth = await readFile(new URL('../src/modules/auth/auth.routes.ts', import.meta.url), 'utf8');
assert.match(auth, /sendEmailVerificationEmail/, 'registration attempts to send verification email');
assert.match(auth, /hashToken\(token\)/, 'verification tokens are stored hashed');
assert.match(auth, /resend-verification/, 'public resend endpoint exists');
assert.match(auth, /Si existe una cuenta pendiente/, 'public resend response is generic');
assert.match(auth, /interval '1 hour'/, 'resend has an hourly limit');
assert.match(auth, /60_000/, 'resend has a minimum interval');
assert.match(auth, /customer_email_verified/, 'successful verification is audited');
assert.match(auth, /SET used_at = now\(\), revoked_at = now\(\) WHERE id = \$1/, 'only the validated verification token is marked used');
assert.match(auth, /user_id = \$2 AND id <> \$1 AND revoked_at IS NULL AND used_at IS NULL/, 'other pending verification tokens are only revoked');
assert.doesNotMatch(auth, /console\.log\([^)]*token/, 'tokens are not logged');

const customers = await readFile(new URL('../src/modules/admin/customers.routes.ts', import.meta.url), 'utf8');
assert.match(customers, /resend-verification/, 'admin resend endpoint exists');
assert.match(customers, /customer_verification_email_resent/, 'admin resend is audited');
assert.match(customers, /status\(502\)/, 'admin SMTP failure returns an error');
assert.match(customers, /verification_last_sent_at/, 'admin responses include verification metadata');
assert.doesNotMatch(customers, /SELECT[^\n]*token_hash/, 'admin customer responses do not expose token hashes');
assert.doesNotMatch(customers, /payload:.*token/, 'admin audit data does not include verification tokens');

const verifyPage = await readFile(new URL('../web/src/pages/VerifyEmail.tsx', import.meta.url), 'utf8');
assert.match(verifyPage, /useSearchParams/);
assert.match(verifyPage, /\/api\/auth\/verify-email/);
assert.doesNotMatch(verifyPage, /localStorage/);
const login = await readFile(new URL('../web/src/pages/Login.tsx', import.meta.url), 'utf8');
assert.match(login, /resend-verification/);
assert.match(login, /Si existe una cuenta pendiente, recibir/);
const adminCustomers = await readFile(new URL('../web/src/pages/admin/AdminCustomers.tsx', import.meta.url), 'utf8');
assert.match(adminCustomers, /try[\s\S]*await postJson[\s\S]*setFeedback\('Correo de verificaci/, 'admin success feedback is only set after a successful API response');
assert.match(adminCustomers, /catch \(resendError\)/, 'admin resend errors are presented as errors');
