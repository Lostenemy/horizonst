import assert from 'node:assert/strict';
import test from 'node:test';
import { redactHardwarePayload } from '../services/hardwarePayloadRedaction';

test('MQTT request and response journaling redacts nested credentials and signed certificate URLs', () => {
  const payload = {
    msg_id: 2030,
    data: {
      host: 'broker.example.test',
      passwd: 'mqtt-secret',
      eap_passwd: 'wifi-secret',
      client_key_url: 'https://example.test/key?token=secret',
      nested: [{ authorization: 'Bearer secret', security_type: 1 }]
    }
  };
  assert.deepEqual(redactHardwarePayload(payload), {
    msg_id: 2030,
    data: {
      host: 'broker.example.test',
      passwd: '[REDACTED]',
      eap_passwd: '[REDACTED]',
      client_key_url: '[REDACTED]',
      nested: [{ authorization: '[REDACTED]', security_type: 1 }]
    }
  });
});
