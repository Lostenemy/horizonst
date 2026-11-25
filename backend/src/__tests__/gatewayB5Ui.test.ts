import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('B5 panel separates read, proposal, diagnostic capture and warns of non-correlated data', () => {
  const html = readFileSync(path.resolve('public/gateways.html'), 'utf8');
  const js = readFileSync(path.resolve('public/js/gateways.js'), 'utf8');
  assert.match(html, /data-config-read="ble_report_interval"/);
  assert.match(html, /data-config-read="bxp_button_filter"/);
  assert.match(html, /Intervalo de reporte BLE propuesto en segundos/);
  assert.match(html, /no confirma una pulsación ni un SOS/);
  assert.match(html, /no envía comandos/);
  assert.match(js, /!v2 \|\| !b5FilterObserved/);
  assert.match(js, /b5-double-press-filter/);
  assert.match(js, /result\.status === 'response_observed'/);
  assert.match(js, /b5CaptureRefresh\.disabled = true/);
  assert.match(js, /selectedGateway\?\.id !== gateway\.id/);
});
