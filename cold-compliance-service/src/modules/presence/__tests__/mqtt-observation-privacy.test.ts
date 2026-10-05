import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGatewayPayload, parseManualEmergencyPayload } from '../payload-parser';

test('2030 cannot create presence or emergency events carrying gateway credentials', () => {
  const packet = Buffer.from(JSON.stringify({ msg_id: 2030, device_info: { mac: '142b2fe271b4' },
    data: { passwd: 'fake-trace-2030', mac: 'fd9d4f8ae226', type: 'bxp-button', frame_type: 1, alarm_status: 1 } }));
  const topic = 'gw/142b2fe271b4/publish'; const now = new Date();
  assert.deepEqual(parseGatewayPayload(topic, packet, now), []);
  assert.deepEqual(parseManualEmergencyPayload(topic, packet, now), []);
});
