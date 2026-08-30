import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort();
const migration011 = await readFile(new URL('../migrations/011_restore_enterprise_saas_plan.sql', import.meta.url), 'utf-8');
const migration012 = await readFile(new URL('../migrations/012_restore_current_commercial_pricing.sql', import.meta.url), 'utf-8');
const packMigration = await readFile(new URL('../migrations/007_hardware_packs.sql', import.meta.url), 'utf-8');

assert.ok(migrationFiles.indexOf('012_restore_current_commercial_pricing.sql') < migrationFiles.indexOf('013_distributor_region.sql'), 'current pricing correction remains ordered before later migrations');
assert.match(migration011, /annual_price_cents = NULL/);
assert.match(migration011, /is_enterprise = true/, 'published migration 011 remains unchanged');
assert.match(migration012, /\('starter', 60000\)/);
assert.match(migration012, /\('professional', 90000\)/);
assert.match(migration012, /\('enterprise', 120000\)/, '012 overwrites the state left by 011');
assert.match(migration012, /is_enterprise = false/);
assert.match(migration012, /IS DISTINCT FROM current_pricing\.annual_price_cents/);
assert.match(migration012, /is_enterprise IS DISTINCT FROM false/, 'rerunning 012 leaves correct rows untouched');
assert.doesNotMatch(migration012, /store\.packs|store\.pack_items/, '012 does not change hardware packs');
assert.match(packMigration, /'starter', 'PACK Starter'.*325000/s);
assert.match(packMigration, /'professional', 'PACK Professional'.*650000/s);
assert.match(packMigration, /'enterprise', 'PACK Enterprise'.*1299500/s);
