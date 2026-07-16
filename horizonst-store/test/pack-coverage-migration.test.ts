import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/010_hardware_pack_coverage.sql', import.meta.url), 'utf8');
assert.match(migration, /ADD COLUMN IF NOT EXISTS coverage_square_meters INTEGER/);
assert.match(migration, /WHEN 'starter' THEN 500/);
assert.match(migration, /WHEN 'professional' THEN 1000/);
assert.match(migration, /WHEN 'enterprise' THEN 2000/);
assert.match(migration, /CHECK \(coverage_square_meters IS NULL OR coverage_square_meters > 0\)/);
assert.doesNotMatch(migration, /DELETE FROM store\.products|DROP TABLE store\.products/, 'internal products and historical data are preserved');
