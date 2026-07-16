import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/009_public_prereservation_emails.sql', import.meta.url), 'utf8');
assert.match(migration, /ALTER TABLE store\.public_prereservations/);
assert.match(migration, /confirmation_email_sent_at TIMESTAMPTZ/);
assert.match(migration, /confirmation_email_last_error_at TIMESTAMPTZ/);
assert.match(migration, /confirmation_email_attempts INTEGER NOT NULL DEFAULT 0/);
assert.match(migration, /commercial_email_sent_at TIMESTAMPTZ/);
assert.match(migration, /commercial_email_last_error_at TIMESTAMPTZ/);
assert.match(migration, /commercial_email_attempts INTEGER NOT NULL DEFAULT 0/);
assert.match(migration, /CHECK \(confirmation_email_attempts >= 0\)/);
assert.match(migration, /CHECK \(commercial_email_attempts >= 0\)/);
assert.doesNotMatch(migration, /008_public_prereservations|access_token_hash/, 'email delivery state does not alter prior migration or token storage');
