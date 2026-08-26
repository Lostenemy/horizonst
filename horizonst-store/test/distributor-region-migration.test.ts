import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/013_distributor_region.sql', import.meta.url), 'utf8');
assert.match(migration, /ALTER TABLE store\.distributor_profiles/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS region TEXT/);
assert.doesNotMatch(migration, /UPDATE|DELETE|DROP/, 'the migration is additive and compatible with existing distributor data');
