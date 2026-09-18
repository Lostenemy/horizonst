import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

test('Horneo displays central gateway and device names while keeping the local model separate', () => {
  const gatewayRoute = source('src/modules/gateways/gateways.routes.ts');
  const deviceRoute = source('src/modules/tags/tags.routes.ts');
  const ui = source('web/app.js');

  assert.match(gatewayRoute, /hardware_name: hardware\.name/);
  assert.match(gatewayRoute, /hardware_place_name: hardware\.place_name/);
  assert.match(deviceRoute, /hardware_name: hardware\.name/);
  assert.doesNotMatch(deviceRoute, /model: hardware\.name/);
  assert.match(ui, /g\.hardware_name \|\| g\.description/);
  assert.match(ui, /t\.hardware_name \|\| t\.model/);
});

test('Horneo inventory only exposes operational alarm timing edits', () => {
  const ui = source('web/app.js');
  const inventory = ui.split('async function renderInventory() {')[1].split('async function createTag()')[0];
  const saveTag = ui.split('async function saveTagInlineEdit(id) {')[1].split('async function beginGatewayInlineEdit')[0];

  assert.doesNotMatch(inventory, /onclick="(?:createTag|createGateway|applyGatewayRssi|configureEmergencyButton|deleteTag|deleteGateway)/);
  assert.match(inventory, /administracion\/gateways\.html/);
  assert.doesNotMatch(saveTag, /mac: d\.mac|descripcion: d\.descripcion|active: d\.active/);
  assert.match(saveTag, /physicalAlarmBuzzerDurationMs/);
});
