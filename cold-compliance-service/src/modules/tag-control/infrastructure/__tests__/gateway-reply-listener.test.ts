import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGatewayAckPayload } from '../gateway-reply-listener';

test('normalizes ACK with root result_code', () => {
  const payload = {
    msg_id: 3161,
    result_code: 0,
    result_msg: 'success'
  };

  const ack = normalizeGatewayAckPayload(payload);

  assert.deepEqual(ack, {
    msgId: 3161,
    resultCode: 0,
    resultMsg: 'success',
    tagMac: undefined,
    payload
  });
});

test('normalizes ACK with data.result_code and preserves full original payload', () => {
  const payload = {
    msg_id: 3161,
    device_info: { mac: '007007E0C804' },
    data: {
      mac: 'E3D5904006A9',
      result_code: 0,
      result_msg: 'success'
    }
  };

  const ack = normalizeGatewayAckPayload(payload);

  assert.equal(ack?.msgId, 3161);
  assert.equal(ack?.resultCode, 0);
  assert.equal(ack?.resultMsg, 'success');
  assert.equal(ack?.tagMac, 'E3D5904006A9');
  assert.equal(ack?.payload, payload);
});

test('returns null for payload without result_code', () => {
  const ack = normalizeGatewayAckPayload({
    msg_id: 3161,
    device_info: { mac: '007007E0C804' },
    data: { mac: 'E3D5904006A9' }
  });

  assert.equal(ack, null);
});

test('returns null for payload without numeric msg_id', () => {
  const ack = normalizeGatewayAckPayload({
    msg_id: '3161',
    data: { result_code: 0 }
  });

  assert.equal(ack, null);
});
