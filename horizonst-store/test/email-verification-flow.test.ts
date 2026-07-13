import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const auth = await readFile(new URL('../src/modules/auth/auth.routes.ts', import.meta.url), 'utf8');
assert.match(auth, /sendEmailVerificationEmail/, 'registration attempts to send verification email');
assert.match(auth, /hashToken\(token\)/, 'verification tokens are stored hashed');
assert.match(auth, /resend-verification/, 'public resend endpoint exists');
assert.match(auth, /Si existe una cuenta pendiente/, 'public resend response is generic');
assert.match(auth, /interval '1 hour'/, 'resend has an hourly limit');
assert.match(auth, /60_000/, 'resend has a minimum interval');
assert.match(auth, /customer_email_verified/, 'successful verification is audited');
assert.match(auth, /SET used_at = now\(\), revoked_at = now\(\) WHERE user_id/, 'verification revokes all pending tokens');
assert.doesNotMatch(auth, /console\.log\([^)]*token/, 'tokens are not logged');

const customers = await readFile(new URL('../src/modules/admin/customers.routes.ts', import.meta.url), 'utf8');
assert.match(customers, /resend-verification/, 'admin resend endpoint exists');
assert.match(customers, /customer_verification_email_resent/, 'admin resend is audited');
assert.match(customers, /verification_last_sent_at/, 'admin responses include verification metadata');
assert.doesNotMatch(customers, /SELECT[^\n]*token_hash/, 'admin customer responses do not expose token hashes');

const verifyPage = await readFile(new URL('../web/src/pages/VerifyEmail.tsx', import.meta.url), 'utf8');
assert.match(verifyPage, /useSearchParams/);
assert.match(verifyPage, /\/api\/auth\/verify-email/);
assert.doesNotMatch(verifyPage, /localStorage/);
const login = await readFile(new URL('../web/src/pages/Login.tsx', import.meta.url), 'utf8');
assert.match(login, /resend-verification/);
assert.match(login, /Si existe una cuenta pendiente, recibirás un nuevo correo de verificación\./);
