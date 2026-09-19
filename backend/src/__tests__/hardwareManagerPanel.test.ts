import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

test('technical gateway panel uses existing central command endpoints and never publishes MQTT in the browser', () => {
  const html = source('public/gateways.html');
  const ui = source('public/js/gateways.js');
  assert.match(html, /gatewayTechnicalPanel/);
  assert.match(html, /gatewayCommandsTable/);
  assert.match(html, /gatewayAuditTable/);
  assert.match(html, /gatewayDevicesTable/);
  assert.match(ui, /last_gateway_id/);
  assert.match(ui, /confirmAction\(\{ title: 'Configurar doble pulsación B5'/);
  assert.match(ui, /confirmAction\(\{ title: 'Aplicar filtro BLE'/);
  assert.match(ui, /\/configure-emergency-button/);
  assert.match(ui, /\/apply-rssi/);
  assert.match(html, /gatewayRecordFirmware/);
  assert.match(html, /gatewayReadIdentity/);
  assert.match(html, /gatewayReportedIdentity/);
  assert.match(html, /gatewayReadsTable/);
  assert.match(ui, /refreshFirmwareControls\(gateway\)/);
  assert.match(ui, /data-ble-command/);
  assert.match(ui, /\/firmware/);
  assert.match(ui, /\/read-identity/);
  assert.match(ui, /renderReportedIdentity/);
  const renderer = ui.split('const renderReportedIdentity')[1].split('const selectGateway')[0];
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(ui, /mqtt\.publish|gw\/\$\{.*\}\/subscribe/);
});

test('gateway audit endpoint checks the scoped gateway before returning metadata', () => {
  const route = source('src/routes/gateways.ts');
  const audit = route.split("router.get('/:gatewayId/audit'")[1].split("router.post('/:gatewayId/configure-emergency-button'")[0];
  assert.match(audit, /resolveHardwareAccess\(req\.user!, 'read'\)/);
  assert.match(audit, /scopedHardwarePredicate/);
  assert.match(audit, /Gateway not found/);
  assert.doesNotMatch(audit, /before_state|after_state/);
});

test('Bluetooth mutations require technician role, scoped active gateway, validation and central journal execution', () => {
  const route = source('src/routes/gateways.ts');
  const command = route.split("router.post('/:gatewayId/bluetooth/:operation'")[1].split("router.post('/', authenticate")[0];
  assert.match(command, /authorizeHardware\('technician'\)/);
  assert.match(command, /gatewayForCommand\(req, gatewayId\)/);
  assert.match(command, /buildBluetoothGatewayCommand/);
  assert.match(command, /executeManagedGatewayCommand/);
  assert.match(command, /appendTechnicalAudit/);
  assert.doesNotMatch(command, /publishMqttJson|mqtt\.publish/);
});
