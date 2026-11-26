import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('2053 and format writes accept separate observation/journal timestamps and reject intervening writes', () => {
  const source = readFileSync(path.resolve('src/services/gatewayCommands.ts'), 'utf8');
  const b5 = source.split('export async function enableB5DoublePressFromObservation')[1].split('export async function updateGatewayBleFormatFromObservation')[0];
  const format = source.split('export async function updateGatewayBleFormatFromObservation')[1].split('export async function executeGatewayMqttConfigurationSequence')[0];
  for (const operation of [b5, format]) {
    assert.match(operation, /s\.observed_at BETWEEN r\.created_at AND r\.response_observed_at/);
    assert.doesNotMatch(operation, /s\.observed_at\s*=\s*r\.response_observed_at/);
    assert.match(operation, /NOT EXISTS \(SELECT 1 FROM hardware_gateway_commands c/);
    assert.match(operation, /s\.observed_value\s*=\s*r\.response_payload->'data'/);
  }
});
