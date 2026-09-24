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
  for (const readType of ['led_state', 'ble_scan_switch', 'filter_relation', 'duplicate_rule']) {
    assert.match(html, new RegExp(`data-config-read="${readType}"`));
  }
  assert.match(html, /gatewayObservedSettingsTable/);
  assert.match(html, /gatewayReadBleConnections/);
  assert.match(html, /gatewayBleSnapshotTable/);
  assert.match(html, /No confirma una conexión B5/);
  assert.match(ui, /\/read-configuration\/\$\{readType\}/);
  assert.match(ui, /\/read-ble-connected-devices/);
  assert.match(ui, /\/ble-connected-devices/);
  const observedRenderer = ui.split('renderHistory\(observedSettingsBody')[1].split('\]\);')[0];
  assert.doesNotMatch(observedRenderer, /innerHTML|insertAdjacentHTML/);
  assert.match(ui, /cell\.textContent/);
  const bleRenderer = ui.split('bleSnapshotBody.replaceChildren')[1].split("} catch (error)")[0];
  assert.doesNotMatch(bleRenderer, /innerHTML|insertAdjacentHTML/);
  assert.match(bleRenderer, /textContent|renderHistory/);
  assert.doesNotMatch(ui, /innerHTML\s*=\s*`[^`]*\$\{/);
  assert.doesNotMatch(ui, /read-configuration\/all|Promise\.all\([^)]*read-configuration/);
  const renderer = ui.split('const renderReportedIdentity')[1].split('const selectGateway')[0];
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(ui, /mqtt\.publish/);
});

test('MQTT 1030 UI keeps the secret ephemeral, restores the preset and explains unverified connectivity', () => {
  const html = source('public/gateways.html');
  const ui = source('public/js/gateways.js');
  assert.match(html, /Configurar conexión MQTT \(1030\)/);
  assert.match(html, /name="passwd" type="password"[^>]*autocomplete="new-password"/);
  assert.match(html, /no existe rollback remoto garantizado/);
  assert.match(html, /recibirá una orden de reinicio/);
  assert.match(html, /Enviar configuración y reiniciar/);
  assert.match(html, /<th>Paso<\/th>/);
  assert.doesNotMatch(html, /name="reset"/);
  assert.match(html, /gatewayMqttRestorePreset/);
  assert.match(html, /gatewayMqttHistoryTable/);
  assert.match(ui, /horizonstMqttPreset/);
  assert.match(ui, /confirmationMac.*!== mac/);
  assert.match(ui, /passwordInput\.value = ''/);
  assert.match(ui, /\/configure-mqtt/);
  assert.match(ui, /item\.msg_id === 1030 \|\| item\.msg_id === 1000/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
  const mqttUi = ui.split('const mqttIntegerFields')[1].split('const normalizeMac')[0];
  assert.doesNotMatch(mqttUi, /innerHTML|insertAdjacentHTML/);
  assert.match(ui, /result\.message/);
});

test('gateway onboarding remains fail-closed until an initial credential policy is authorized', () => {
  const docs = source('../docs/hardware-manager-mqtt-1030.md');
  const routes = source('src/routes/gateways.ts');
  assert.match(docs, /decisión pendiente/i);
  assert.match(docs, /no añade\s+la acción \*\*Dar de alta gateway\*\*/);
  assert.match(docs, /no aprovisiona credenciales\/ACL/);
  assert.doesNotMatch(routes, /INSERT INTO vmq_auth_acl/);
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
