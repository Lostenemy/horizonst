import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';
import mqtt from 'mqtt';
import app from '../app';
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
  Object.assign(config.mqtt, {
    required,
    username: 'unit-test-user',
    reconnectPeriod: 10,
    reconnectMaxPeriod: 40
  });
  const credentialField = 'password';
  (config.mqtt as any)[credentialField] = ['unit', 'test', 'credential'].join('-');
};

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for MQTT test state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const readHealth = async (): Promise<{ statusCode: number; body: any }> => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    return { statusCode: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test('a rejected subscription after reconnect is retried without restarting Backend', async () => {
  configureTestMqtt(true);
  const fakeClient = new EventEmitter() as any;
  fakeClient.options = { reconnectPeriod: 0 };
  const outcomes = [
    OFFICIAL_TOPICS.map((topic) => ({ topic, qos: 0 })),
    [],
    OFFICIAL_TOPICS.map((topic) => ({ topic, qos: 0 }))
  ];
  let subscribeCalls = 0;
  fakeClient.subscribe = (topics: string[], callback: Function) => {
    assert.deepEqual(topics, OFFICIAL_TOPICS);
    subscribeCalls += 1;
    const granted = outcomes.shift();
    setImmediate(() => callback(null, granted));
  };
  (mqtt as any).connect = (_url: string, options: any) => {
    assert.equal(options.resubscribe, false);
    return fakeClient;
  };

  const initialized = initMqtt();
  fakeClient.emit('connect');
  await initialized;
  assert.equal(getMqttStatus().connected, true);

  fakeClient.emit('close');
  fakeClient.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
  fakeClient.emit('reconnect');
  fakeClient.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
  fakeClient.emit('connect');

  await waitFor(() => subscribeCalls === 3 && getMqttStatus().connected);
  assert.equal(getMqttStatus().lastError, null);
  assert.equal(subscribeCalls, 3);
});

test('a partial QoS 128 grant recovers and health returns from degraded to ok', async () => {
  configureTestMqtt(true);
  config.mqtt.reconnectPeriod = 100;
  const fakeClient = new EventEmitter() as any;
  fakeClient.options = { reconnectPeriod: 0 };
  const outcomes = [
    OFFICIAL_TOPICS.map((topic) => ({ topic, qos: 0 })),
    [
      { topic: 'devices/MK4', qos: 0 },
      { topic: 'gw/+/publish', qos: 128 }
    ],
    OFFICIAL_TOPICS.map((topic) => ({ topic, qos: 0 }))
  ];
  let subscribeCalls = 0;
  fakeClient.subscribe = (_topics: string[], callback: Function) => {
    subscribeCalls += 1;
    setImmediate(() => callback(null, outcomes.shift()));
  };
  (mqtt as any).connect = () => fakeClient;

  const initialized = initMqtt();
  fakeClient.emit('connect');
  await initialized;
  fakeClient.emit('close');
  fakeClient.emit('reconnect');
  fakeClient.emit('connect');
  await waitFor(() => subscribeCalls === 2 && !getMqttStatus().connected);

  const degraded = await readHealth();
  assert.equal(degraded.statusCode, 503);
  assert.equal(degraded.body.status, 'degraded');
  assert.match(degraded.body.mqtt.lastError, /gw\/\+\/publish/);

  await waitFor(() => subscribeCalls === 3 && getMqttStatus().connected);
  const healthy = await readHealth();
  assert.equal(healthy.statusCode, 200);
  assert.equal(healthy.body.status, 'ok');
  assert.equal(healthy.body.mqtt.lastError, null);
  assert.equal(healthy.body.mqtt.reconnectDelay, config.mqtt.reconnectPeriod);
});

test('a general subscription error is retried and does not duplicate listeners or timers', async () => {
  configureTestMqtt(false);
  const fakeClient = new EventEmitter() as any;
  fakeClient.options = { reconnectPeriod: 0 };
  const outcomes = [
    { error: new Error('broker not ready') },
    { granted: OFFICIAL_TOPICS.map((topic) => ({ topic, qos: 0 })) }
  ];
  let subscribeCalls = 0;
  let connectCalls = 0;
  fakeClient.subscribe = (_topics: string[], callback: Function) => {
    subscribeCalls += 1;
    const outcome = outcomes.shift()!;
    setImmediate(() => callback(outcome.error ?? null, outcome.granted));
  };
  (mqtt as any).connect = () => {
    connectCalls += 1;
    return fakeClient;
  };

  await initMqtt();
  fakeClient.emit('connect');
  await waitFor(() => subscribeCalls === 2 && getMqttStatus().connected);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(subscribeCalls, 2, 'a successful retry must cancel further timers');
  assert.equal(connectCalls, 1, 'subscription retries must reuse the single MQTT client');
  for (const event of ['connect', 'close', 'reconnect', 'error', 'message']) {
    assert.equal(fakeClient.listenerCount(event), 1, `${event} listener must not be duplicated`);
  }
});

test('a stale subscription callback cannot degrade a newer successful connection', async () => {
  configureTestMqtt(false);
  const fakeClient = new EventEmitter() as any;
  fakeClient.options = { reconnectPeriod: 0 };
  const callbacks: Function[] = [];
  let subscribeCalls = 0;
  fakeClient.subscribe = (_topics: string[], callback: Function) => {
    subscribeCalls += 1;
    callbacks.push(callback);
  };
  (mqtt as any).connect = () => fakeClient;

  await initMqtt();
  fakeClient.emit('connect');
  assert.equal(subscribeCalls, 1);
  const staleCallback = callbacks[0];

  fakeClient.emit('close');
  fakeClient.emit('reconnect');
  fakeClient.emit('connect');
  assert.equal(subscribeCalls, 2);
  callbacks[1](null, OFFICIAL_TOPICS.map((topic) => ({ topic, qos: 0 })));
  assert.equal(getMqttStatus().connected, true);

  staleCallback(null, [{ topic: 'devices/MK4', qos: 0 }]);
  assert.equal(getMqttStatus().connected, true);
  assert.equal(getMqttStatus().lastError, null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(subscribeCalls, 2);
});

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
