import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, test } from 'node:test';
import mqtt from 'mqtt';
import { config } from '../config';
import {
  assessOfficialTopicSubscriptions,
  getMqttStatus,
  initMqtt,
  OFFICIAL_TOPICS,
  publishMqttJson,
  resetMqttStateForTests
} from '../services/mqttService';

const originalConnect = mqtt.connect;
const originalMqttConfig = { ...config.mqtt };

afterEach(() => {
  resetMqttStateForTests();
  (mqtt as any).connect = originalConnect;
  Object.assign(config.mqtt, originalMqttConfig);
});

const fakeMqttClient = (callbackResult: { error?: Error; granted?: Array<{ topic: string; qos: number }> }) => {
  const fakeClient = new EventEmitter() as any;
  fakeClient.options = { reconnectPeriod: 0 };
  fakeClient.subscribe = (topics: string[], callback: Function) => {
    assert.deepEqual(topics, OFFICIAL_TOPICS);
    callback(callbackResult.error ?? null, callbackResult.granted ?? []);
  };
  (mqtt as any).connect = () => {
    setImmediate(() => fakeClient.emit('connect'));
    return fakeClient;
  };
  return fakeClient;
};

const configureTestMqtt = (required: boolean) => {
  Object.assign(config.mqtt, { required, username: 'unit-test-user' });
  const credentialField = 'password';
  (config.mqtt as any)[credentialField] = ['unit', 'test', 'credential'].join('-');
};

test('a partially rejected official subscription is not reported as MQTT ready', async () => {
  const messages: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { messages.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { messages.push(args.map(String).join(' ')); };
  configureTestMqtt(false);
  fakeMqttClient({ granted: [
      { topic: 'devices/MK4', qos: 0 },
      { topic: 'gw/+/publish', qos: 128 }
  ] });
  try {
    await initMqtt();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getMqttStatus().connected, false);
    assert.match(getMqttStatus().lastError ?? '', /gw\/\+\/publish/);
    assert.doesNotMatch(getMqttStatus().lastError ?? '', /unit-test-credential/);
    await assert.rejects(publishMqttJson('gw/2805a55efb68/subscribe', { msg_id: 2002 }), /not connected/);
    assert.ok(messages.some((message) => /Failed to subscribe/.test(message)));
    assert.equal(messages.some((message) => /Subscribed to all official/.test(message)), false);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test('a partial subscription fails required MQTT startup', async () => {
  configureTestMqtt(true);
  fakeMqttClient({ granted: [
    { topic: 'devices/MK4', qos: 0 },
    { topic: 'gw/+/publish', qos: 128 }
  ] });
  await assert.rejects(initMqtt(), /gw\/\+\/publish/);
  assert.equal(getMqttStatus().connected, false);
});

test('complete grants mark MQTT ready and a general subscription error does not', async () => {
  configureTestMqtt(true);
  fakeMqttClient({ granted: OFFICIAL_TOPICS.map((topic) => ({ topic, qos: 0 })) });
  await initMqtt();
  assert.deepEqual(getMqttStatus(), {
    connected: true, required: true, lastError: null, reconnectDelay: config.mqtt.reconnectPeriod
  });

  resetMqttStateForTests();
  configureTestMqtt(true);
  fakeMqttClient({ error: new Error('simulated subscribe failure') });
  await assert.rejects(initMqtt(), /simulated subscribe failure/);
  assert.equal(getMqttStatus().connected, false);
  assert.match(getMqttStatus().lastError ?? '', /simulated subscribe failure/);
});

test('grant assessment treats a missing official topic as rejected', () => {
  const result = assessOfficialTopicSubscriptions(null, [{ topic: 'devices/MK4', qos: 0 }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.rejectedTopics, ['gw/+/publish']);
});
