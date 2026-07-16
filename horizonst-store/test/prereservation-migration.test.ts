import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/008_public_prereservations.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS store\.public_prereservations/);
assert.match(migration, /offer_code IN \('starter', 'professional', 'enterprise'\)/);
assert.match(migration, /UNIQUE \(email, campaign_code, offer_code\)/);
assert.match(migration, /access_token_hash TEXT NOT NULL UNIQUE/);
assert.match(migration, /privacy_accepted BOOLEAN NOT NULL CHECK \(privacy_accepted = true\)/);
assert.doesNotMatch(migration, /325000|650000|1299500|58000|80000|120000/, 'the campaign migration does not invent commercial prices');
