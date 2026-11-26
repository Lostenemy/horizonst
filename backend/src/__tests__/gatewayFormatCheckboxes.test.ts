import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

test('observed BLE values create checked and unchecked controls without publishing', () => {
  const source = readFileSync(path.resolve('public/js/gateways.js'), 'utf8');
  const start = source.indexOf('const renderFormatObservation =');
  const end = source.indexOf('let b5FilterObserved', start);
  assert.ok(start >= 0 && end > start);
  const controls: any[] = [];
  const group = { querySelectorAll: () => [], appendChild: (label: any) => controls.push(label) };
  const document = { createElement: (tag: string) => tag === 'input' ? {} : { children: [] as any[], append(...items: any[]) { this.children.push(...items); } },
    createTextNode: (text: string) => text };
  vm.runInNewContext(source.slice(start, end) + '\nrenderFormatObservation("ble_parsing_options", {bxp_button_switch: 1, mk_pir_switch: 0});',
    { document, formatGroups: { ble_parsing_options: group } });
  assert.equal(controls.length, 2);
  assert.equal(controls[0].children[0].name, 'bxp_button_switch');
  assert.equal(controls[0].children[0].checked, true);
  assert.equal(controls[1].children[0].name, 'mk_pir_switch');
  assert.equal(controls[1].children[0].checked, false);
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
  assert.match(html, /styles\.css\?v=20261126-2/);
  assert.match(html, /gateways\.js\?v=20261126-2/);
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
