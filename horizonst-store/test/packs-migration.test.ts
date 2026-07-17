import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/007_hardware_packs.sql', import.meta.url), 'utf-8');

assert.match(migration, /CREATE TABLE IF NOT EXISTS store\.packs/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS store\.pack_items/);
assert.match(migration, /pack_id UUID REFERENCES store\.packs\(id\) ON DELETE RESTRICT/);
assert.match(migration, /'starter', 'PACK Starter'.*325000/s);
assert.match(migration, /'professional', 'PACK Professional'.*650000/s);
assert.match(migration, /'enterprise', 'PACK Enterprise'.*1299500/s);
assert.match(migration, /'starter', 'gateway_ble', 5, 1/);
assert.match(migration, /'starter', 'gateway_antenna', 5, 2/);
assert.match(migration, /'starter', 'poe_power_supply', 1, 3/);
assert.match(migration, /'starter', 'tag_ble', 10, 4/);
assert.match(migration, /'professional', 'gateway_ble', 10, 1/);
assert.match(migration, /'professional', 'gateway_antenna', 10, 2/);
assert.match(migration, /'professional', 'poe_power_supply', 2, 3/);
assert.match(migration, /'professional', 'tag_ble', 20, 4/);
assert.match(migration, /'enterprise', 'gateway_ble', 20, 1/);
assert.match(migration, /'enterprise', 'gateway_antenna', 20, 2/);
assert.match(migration, /'enterprise', 'poe_power_supply', 4, 3/);
assert.match(migration, /'enterprise', 'tag_ble', 40, 4/);
assert.match(migration, /privacy_accepted BOOLEAN NOT NULL DEFAULT false/);
assert.match(migration, /ON CONFLICT \(pack_id, product_id\) DO UPDATE/);
