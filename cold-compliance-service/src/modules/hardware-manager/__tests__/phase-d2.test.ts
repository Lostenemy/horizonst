import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildCentralGatewayPublishTopics } from '../../mqtt/mqtt.service';
import {
  executeHardwareB5Command,
  executeHardwareGatewayManagementCommand,
  hardwareManagementTimeoutMs
} from '../hardware-command.client';
import { env } from '../../../config/env';
import { connectTagSession } from '../../tag-control/application/tag-physical-alarm.service';

test('five active central gateways become five exact publish topics without wildcard', () => {
  const gateways = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1, name: null, mac_address: `2805A55EFB${String(60 + index)}`,
    description: null, company_id: 'horneo', rssi_threshold: -70, active: true
  }));
  const topics = buildCentralGatewayPublishTopics([...gateways, { ...gateways[0], id: 99 }, { ...gateways[0], id: 100, active: false }]);
  assert.equal(topics.length, 5);
  assert.ok(topics.every((topic) => /^gw\/[0-9a-f]{12}\/publish$/.test(topic)));
  assert.ok(topics.every((topic) => !topic.includes('+') && !topic.includes('#')));
});

test('clean MQTT reconnect rebuilds exact subscriptions and never restores a wildcard', () => {
  const source = readFileSync(join(process.cwd(), 'src/modules/mqtt/mqtt.service.ts'), 'utf8');
  assert.match(source, /client\.on\('connect',[\s\S]*subscribedTopics\.clear\(\)[\s\S]*refreshMqttSubscriptions/);
  assert.match(source, /!topic\.includes\('\+'\) && !topic\.includes\('#'\)/);
  assert.doesNotMatch(source, /gw\/\+\/publish/);
});

test('Horneo sends only central ids, command and duration; never MQTT topic, MAC or B5 password', async () => {
  const originalEnabled = env.HARDWARE_MANAGER_ENABLED;
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  let request: { url: string; init?: RequestInit } | undefined;
  try {
    await executeHardwareB5Command({
      hardwareGatewayId: 41,
      hardwareDeviceId: 31,
      command: 'buzzer',
      durationMs: 2500,
      fetchImpl: async (input, init) => {
        request = { url: String(input), init };
        return new Response('{}', { status: 200 });
      }
    });
  } finally {
    (env as any).HARDWARE_MANAGER_ENABLED = originalEnabled;
  }
  assert.match(request!.url, /\/gateways\/41\/b5-command$/);
  assert.deepEqual(JSON.parse(String(request!.init?.body)), { deviceId: 31, command: 'buzzer', durationMs: 2500 });
  assert.doesNotMatch(String(request!.init?.body), /password|passwd|subscribe|publish|[0-9A-F]{12}/i);
});

test('legacy Horneo RSSI/B5 endpoints delegate their central id to Hardware Manager', async () => {
  const originalEnabled = env.HARDWARE_MANAGER_ENABLED;
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  let body: unknown;
  try {
    const result = await executeHardwareGatewayManagementCommand({
      hardwareGatewayId: 41,
      action: 'apply-rssi',
      body: { rssi: -72 },
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    });
    assert.equal(result.status, 200);
  } finally {
    (env as any).HARDWARE_MANAGER_ENABLED = originalEnabled;
  }
  assert.deepEqual(body, { rssi: -72 });
});

test('B5 sequential configuration remains alive beyond 20s within its independent full-sequence budget', async () => {
  const originalEnabled = env.HARDWARE_MANAGER_ENABLED;
  const originalIndividual = env.HARDWARE_MANAGER_COMMAND_TIMEOUT_MS;
  const originalSequence = env.HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS;
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  (env as any).HARDWARE_MANAGER_COMMAND_TIMEOUT_MS = 20000;
  (env as any).HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS = 45000;
  let scheduledAbortMs = 0;
  const virtualElapsedMs = 21000;
  try {
    const result = await executeHardwareGatewayManagementCommand({
      hardwareGatewayId: 41,
      action: 'configure-emergency-button',
      timer: {
        set: ((_callback: () => void, timeoutMs?: number) => {
          scheduledAbortMs = timeoutMs ?? 0;
          return { unref: () => undefined } as unknown as NodeJS.Timeout;
        }) as typeof setTimeout,
        clear: (() => undefined) as typeof clearTimeout
      },
      fetchImpl: async (_input, init) => {
        assert.equal(init?.signal instanceof AbortSignal && init.signal.aborted, false);
        assert.ok(virtualElapsedMs > env.HARDWARE_MANAGER_COMMAND_TIMEOUT_MS);
        assert.ok(virtualElapsedMs < scheduledAbortMs);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    });
    assert.equal(result.status, 200);
    assert.equal(scheduledAbortMs, 45000);
    assert.equal(hardwareManagementTimeoutMs('apply-rssi'), 20000);
  } finally {
    (env as any).HARDWARE_MANAGER_ENABLED = originalEnabled;
    (env as any).HARDWARE_MANAGER_COMMAND_TIMEOUT_MS = originalIndividual;
    (env as any).HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS = originalSequence;
  }
});

test('physical alarm orchestration has no direct MQTT execution and keeps fallback, finally disconnect and timing semantics', () => {
  const source = readFileSync(join(process.cwd(), 'src/modules/tag-control/application/tag-physical-alarm.service.ts'), 'utf8');
  assert.doesNotMatch(source, /mqttPublish|waitForGatewayReplyMulti|TAG_SESSION_PASSWORD/);
  assert.match(source, /for \(const candidate of params\.candidates\)/);
  assert.match(source, /continue;/);
  assert.match(source, /finally/);
  assert.match(source, /deps\.disconnect/);
  assert.match(source, /TAG_ALARM_POST_CONNECT_DELAY_MS/);
  assert.match(source, /TAG_ALARM_BETWEEN_ACTION_DELAY_MS/);
});

test('connect preserves two retries after the initial attempt', async () => {
  const originalRetries = env.TAG_ALARM_CONNECT_MAX_RETRIES;
  (env as any).TAG_ALARM_CONNECT_MAX_RETRIES = 2;
  let attempts = 0;
  try {
    await connectTagSession({ gatewayMac: '2805a55efb68', tagUid: 'fd9d4f8ae226', hardwareGatewayId: 41, hardwareDeviceId: 31 }, {
      execute: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('temporary connect failure');
      },
      wait: async () => undefined
    });
  } finally {
    (env as any).TAG_ALARM_CONNECT_MAX_RETRIES = originalRetries;
  }
  assert.equal(attempts, 3);
});

test('manual emergency invariants and no physical feedback remain exact', () => {
  const parser = readFileSync(join(process.cwd(), 'src/modules/presence/payload-parser.ts'), 'utf8');
  const service = readFileSync(join(process.cwd(), 'src/modules/alerts/manual-emergency.service.ts'), 'utf8');
  assert.match(parser, /numericValue\(payload\?\.msg_id\) !== 3070/);
  assert.match(parser, /typeText === 'bxp-button'/);
  assert.match(parser, /frameType === 1/);
  assert.match(parser, /alarmStatus === 1/);
  assert.match(service, /manualEmergencyDeduplicationKey\(hardwareDeviceId, event\.triggerCount\)/);
  assert.match(service, /dispatchPhysicalAlarm: false/);
});
