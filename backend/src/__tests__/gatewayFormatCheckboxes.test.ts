import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

test('all observed BLE options render, including groups with every value zero', () => {
  const source = readFileSync(path.resolve('public/js/gateways.js'), 'utf8');
  const start = source.indexOf('const formatOptionLabels =');
  const end = source.indexOf('let b5FilterObserved', start);
  assert.ok(start >= 0 && end > start);
  const controls: any[] = [];
  const group = { querySelectorAll: () => [], appendChild: (label: any) => controls.push(label) };
  const document = { createElement: (tag: string) => tag === 'input' ? {} : { children: [] as any[], append(...items: any[]) { this.children.push(...items); } },
    createTextNode: (text: string) => text };
  const context = vm.createContext({ document, formatGroups: { ble_report_fields: group, ble_parsing_options: group } });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('renderFormatObservation("ble_report_fields", { timestamp: 1, adv_data: 0 })', context);
  assert.deepEqual(controls.splice(0).map(label => [label.children[0].name, label.children[0].checked]), [['timestamp', true], ['adv_data', false]]);
  vm.runInContext(`renderFormatObservation("ble_parsing_options", {
    iBeacon_switch: 0, eddystone_uid_switch: 0, eddystone_tlm_switch: 0, eddystone_url_switch: 0,
    bxp_acc_switch: 0, bxp_th_switch: 0, bxp_devinfo_switch: 0, bxp_button_switch: 0,
    "bxp_tag&sensor_switch": 0, mk_pir_switch: 0, mk_tof_switch: 0, nanobeacon_info_switch: 0
  })`, context);
  assert.equal(controls.length, 12);
  assert.ok(controls.every(label => label.className === 'gateway-format-option' && label.children[0].checked === false && !label.children[0].disabled));
});

test('checkbox changes send the complete reviewed group once', async () => {
  const source = readFileSync(path.resolve('public/js/gateways.js'), 'utf8');
  const start = source.indexOf('for (const button of formatButtons) button.addEventListener');
  const end = source.indexOf('firmwareClearButton.addEventListener', start);
  assert.ok(start >= 0 && end > start);
  let click: () => Promise<void> = async () => {};
  const button = { dataset: { formatApply: 'ble_report_fields' }, addEventListener: (_: string, handler: () => Promise<void>) => { click = handler; } };
  const observation = { readId: 'fictional-read', gatewayId: 1, receivedAt: Date.now(), data: { timestamp: 0, adv_data: 1 } };
  const requests: any[] = [];
  const context = { formatButtons: [button], selectedGateway: { id: 1, mac_address: 'synthetic' }, formatObservations: { ble_report_fields: observation },
    formatGroups: { ble_report_fields: { querySelectorAll: () => [{ name: 'timestamp', checked: true }, { name: 'adv_data', checked: false }] } },
    formatSubmitting: false, formatStatus: { textContent: '' }, updateFormatAvailability() {},
    confirmAction: async () => true, apiPost: async (url: string, body: unknown) => { requests.push({ url, body }); return { message: 'mock' }; },
    refreshTechnicalHistory: async () => {} };
  vm.runInNewContext(source.slice(start, end), context);
  await click();
  assert.equal(requests.length, 1);
  assert.equal(JSON.stringify(requests[0].body.values), '{"timestamp":1,"adv_data":0}');
  assert.equal(requests[0].body.readId, 'fictional-read');
  assert.equal(requests[0].body.uiContract, '20261126-2');
});

test('new HTML versions resources and incompatible old HTML stops before initialization', () => {
  const html = readFileSync(path.resolve('public/gateways.html'), 'utf8');
  assert.match(html, /gatewayUiContract[^>]*content="20261126-2"/);
  assert.match(html, /styles\.css\?v=20261126-3/);
  assert.match(html, /gateways\.js\?v=20261126-3/);
  const source = readFileSync(path.resolve('public/js/gateways.js'), 'utf8');
  const start = source.indexOf('if (document.getElementById(\'gatewayUiContract\')');
  const end = source.indexOf('const { user,', start);
  assert.ok(start >= 0 && end > start);
  const warnings: any[] = [];
  const document = { getElementById: () => null, createElement: () => ({ setAttribute() {}, textContent: '' }), body: { prepend: (message: unknown) => warnings.push(message) } };
  assert.throws(() => vm.runInNewContext(source.slice(start, end), { document }), /contract mismatch/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].textContent, /Recarga/);
});
