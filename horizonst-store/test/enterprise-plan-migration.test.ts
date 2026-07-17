import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort();
const migration = await readFile(new URL('../migrations/011_restore_enterprise_saas_plan.sql', import.meta.url), 'utf-8');

assert.equal(migrationFiles.at(-1), '011_restore_enterprise_saas_plan.sql', 'Enterprise repair is the next migration');
assert.match(migration, /UPDATE store\.saas_plans/);
assert.match(migration, /annual_price_cents = NULL/);
assert.match(migration, /is_enterprise = true/);
assert.match(migration, /WHERE code = 'enterprise'/);
assert.match(migration, /annual_price_cents IS NOT NULL OR is_enterprise IS DISTINCT FROM true/, 'rerunning the repair leaves an already-correct row untouched');
assert.doesNotMatch(migration, /starter|professional/, 'Starter and Professional prices are unchanged');
assert.doesNotMatch(migration, /store\.packs|store\.pack_items/, 'the Enterprise hardware pack and its price are unchanged');
assert.doesNotMatch(migration, /store\.public_prereservations|store\.quote_items|store\.order_items/, 'historical commercial records are not rewritten');
