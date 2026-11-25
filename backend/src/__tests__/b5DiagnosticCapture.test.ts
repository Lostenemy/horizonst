import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { clearB5DiagnosticCapturesForTests, getB5DiagnosticCapture, recordB5DiagnosticMessage, startB5DiagnosticCapture } from '../services/b5DiagnosticCapture';

afterEach(clearB5DiagnosticCapturesForTests);
const setup = () => startB5DiagnosticCapture({ actor: 1, gatewayId: 12, companyId: 'company-a', gatewayMac: 'aaaaaaaaaaaa', deviceId: 22, tagMac: 'bbbbbbbbbbbb' }, 1000);
const message = (counter: unknown) => ({ msg_id: 3070, device_info: { mac: 'aaaaaaaaaaaa' }, data: [{ type: 'bxp-button', mac: 'bbbbbbbbbbbb', frame_type: 1, alarm_status: 1, trigger_count: counter, passwd: 'fictional-secret', unrelated: 'private' }] });
test('capture retains only bounded fields and compares counters without declaring an SOS', () => {
  const capture = setup();
  recordB5DiagnosticMessage('gw/aaaaaaaaaaaa/publish', message(4), 1100);
  recordB5DiagnosticMessage('gw/aaaaaaaaaaaa/publish', message(4), 1200);
  recordB5DiagnosticMessage('gw/aaaaaaaaaaaa/publish', message(5), 1300);
  recordB5DiagnosticMessage('gw/aaaaaaaaaaaa/publish', message('5'), 1400);
  const result = getB5DiagnosticCapture(capture.id, 1, 12, 'company-a', 22, 1500)!;
  assert.deepEqual(result.items.map(item => item.comparison), ['primera observación', 'contador repetido', 'contador diferente; evento no verificado', 'contador no válido o ausente']);
  assert.doesNotMatch(JSON.stringify(result), /fictional-secret|private|bbbbbbbbbbbb/);
});
test('scope, topic, identity, expiry and bounded storage are enforced', () => {
  const capture = setup();
  recordB5DiagnosticMessage('gw/cccccccccccc/publish', message(1), 1100);
  recordB5DiagnosticMessage('gw/aaaaaaaaaaaa/publish', { ...message(1), device_info: { mac: 'cccccccccccc' } }, 1100);
  assert.equal(getB5DiagnosticCapture(capture.id, 1, 12, 'company-a', 22, 1200)?.items.length, 0);
  assert.equal(getB5DiagnosticCapture(capture.id, 2, 12, 'company-a', 22, 1200), null);
  assert.equal(getB5DiagnosticCapture(capture.id, 1, 12, 'company-b', 22, 1200), null);
  for (let n = 0; n < 110; n++) recordB5DiagnosticMessage('gw/aaaaaaaaaaaa/publish', message(n), 1300 + n);
  assert.equal(getB5DiagnosticCapture(capture.id, 1, 12, 'company-a', 22, 1500)?.items.length, 100);
  assert.equal(getB5DiagnosticCapture(capture.id, 1, 12, 'company-a', 22, 301000), null);
});
