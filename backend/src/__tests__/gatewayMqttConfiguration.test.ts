import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGatewayMqttConfiguration,
  buildHorizonstMqttPreset,
  MQTT_CONFIGURATION_KEYS
} from '../services/gatewayMqttConfiguration';
import { normalizeHardwareGatewayAck } from '../services/gatewayAck';
import { buildGatewayResetCommand } from '../services/gatewayCommands';

const MAC = '2805a55efb68';
const TEST_PASSWORD = 'test-only-secret-not-real';

const validData = () => ({ ...buildHorizonstMqttPreset(MAC), passwd: TEST_PASSWORD });

test('1030 HorizonST preset produces the exact observed wire payload and a separately redacted journal payload', () => {
  const { wirePayload, persistedPayload } = buildGatewayMqttConfiguration(MAC, validData());
  assert.deepEqual(wirePayload, {
    msg_id: 1030,
    device_info: { mac: MAC },
    data: {
      security_type: 1, host: 'mqtt.horizonst.com.es', port: 8883, client_id: MAC, username: MAC,
      passwd: TEST_PASSWORD, sub_topic: `gw/${MAC}/subscribe`, pub_topic: `gw/${MAC}/publish`,
      qos: 0, clean_session: 1, keepalive: 60, lwt_en: 1, lwt_qos: 1, lwt_retain: 0,
      lwt_topic: `gw/${MAC}/publish`,
      lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac: MAC }, data: {} })
    }
  });
  assert.equal(persistedPayload.data.passwd, '[REDACTED]');
  assert.equal(JSON.stringify(persistedPayload).includes(TEST_PASSWORD), false);
});

test('all editable 1030 fields survive strict validation without allowing server-owned envelope fields', () => {
  const edited = {
    security_type: 0, host: '192.0.2.10', port: 1883, client_id: 'controlled-test-client',
    username: 'controlled-test-user', passwd: ` ${TEST_PASSWORD} `, sub_topic: 'tests/+/receive',
    pub_topic: 'tests/device/publish', qos: 1, clean_session: 0, keepalive: 0, lwt_en: 0,
    lwt_qos: 0, lwt_retain: 1, lwt_topic: 'tests/device/status',
    lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac: MAC.toUpperCase() }, data: {} })
  };
  const result = buildGatewayMqttConfiguration('28:05:A5:5E:FB:68', edited);
  assert.deepEqual(result.wirePayload.data, edited);
  assert.equal(result.wirePayload.msg_id, 1030);
  assert.deepEqual(result.wirePayload.device_info, { mac: MAC });
  assert.equal(result.wirePayload.data.passwd, ` ${TEST_PASSWORD} `);
});

test('1030 validation rejects missing/extra keys, coercions, invalid ranges, hosts, topics and LWT contracts', () => {
  const invalid: unknown[] = [];
  const missing = validData() as Record<string, unknown>;
  delete missing.username;
  invalid.push(missing, { ...validData(), extra: 1 });
  for (const [key, value] of [
    ['security_type', 2], ['port', '8883'], ['port', 1.5], ['port', 65536], ['qos', 2],
    ['clean_session', true], ['keepalive', -1], ['keepalive', Infinity], ['lwt_en', 3],
    ['lwt_qos', 2], ['lwt_retain', false], ['host', 'mqtts://broker.test'], ['host', 'broker.test/path'],
    ['host', 'bad host'], ['client_id', ''], ['client_id', '   '], ['username', ''], ['username', '\t'], ['passwd', ''],
    ['pub_topic', 'gw/+/publish'], ['lwt_topic', 'gw/#'], ['sub_topic', 'bad\u0000topic']
  ] as const) invalid.push({ ...validData(), [key]: value });
  invalid.push(
    { ...validData(), lwt_payload: 'not-json' },
    { ...validData(), lwt_payload: JSON.stringify({ msg_id: 3998, device_info: { mac: MAC }, data: {} }) },
    { ...validData(), lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac: 'ffffffffffff' }, data: {} }) },
    { ...validData(), lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac: MAC }, data: {}, extra: true }) },
    { ...validData(), lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac: MAC }, data: { extra: true } }) }
  );
  for (const candidate of invalid) assert.throws(() => buildGatewayMqttConfiguration(MAC, candidate), /Invalid MQTT configuration/);
  assert.deepEqual(Object.keys(validData()), [...MQTT_CONFIGURATION_KEYS]);
});

test('1000 reset payload is server-owned and exactly matches the observed manufacturer contract', () => {
  assert.deepEqual(buildGatewayResetCommand('28:05:A5:5E:FB:68'), {
    msg_id: 1000,
    device_info: { mac: MAC },
    data: { reset: 0 }
  });
});

test('1000 and 1030 ACKs require exact topic MAC, payload MAC, known result code and documented result message', () => {
  const ack = (msgId: 1000 | 1030, overrides: Record<string, unknown> = {}) => ({
    msg_id: msgId, device_info: { mac: MAC }, result_code: 0, result_msg: 'success', ...overrides
  });
  for (const msgId of [1000, 1030] as const) {
    assert.equal(normalizeHardwareGatewayAck(`gw/${MAC}/publish`, ack(msgId))?.resultCode, 0);
    assert.equal(normalizeHardwareGatewayAck(`gw/${MAC}/publish`, ack(msgId, {
      result_code: 4, result_msg: 'no object error'
    }))?.resultCode, 4);
    assert.equal(normalizeHardwareGatewayAck(`gw/${MAC}/publish`, ack(msgId, { result_msg: 'accepted' })), null);
    assert.equal(normalizeHardwareGatewayAck(`gw/${MAC}/publish`, ack(msgId, {
      result_code: 5, result_msg: 'unknown'
    })), null);
    assert.equal(normalizeHardwareGatewayAck(`gw/${MAC}/publish`, ack(msgId, {
      device_info: { mac: 'ffffffffffff' }
    })), null);
    assert.equal(normalizeHardwareGatewayAck('gw/ffffffffffff/publish', ack(msgId)), null);
  }
  assert.equal(normalizeHardwareGatewayAck(`gw/${MAC}/publish`, {
    msg_id: 1030, device_info: { mac: MAC }, data: { result_code: 0, result_msg: 'success' }
  }), null);
});
