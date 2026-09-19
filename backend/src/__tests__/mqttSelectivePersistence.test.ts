import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { pool } from '../db/pool';
import { OFFICIAL_TOPICS, processMqttMessage } from '../services/mqttService';

const originalQuery = pool.query.bind(pool);

afterEach(() => { (pool as any).query = originalQuery; });

test('backend subscriptions are exactly MK4 and the canonical MKGW3 publish wildcard', () => {
  assert.deepEqual(OFFICIAL_TOPICS, ['devices/MK4', 'gw/+/publish']);
  for (const retired of ['devices/MK1', 'devices/MK2', 'devices/MK3', 'devices/MK3/+/send']) {
    assert.equal(OFFICIAL_TOPICS.includes(retired), false);
  }
});

test('app persistence stores MK4 raw input but never raw gw traffic including 3070', async () => {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    inserts.push({ sql, params });
    return { rows: [] };
  };
  await processMqttMessage('devices/MK4', Buffer.from('not-a-valid-record'), { qos: 1, retain: false } as any);
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].sql, /INSERT INTO mqtt_messages/);
  assert.equal(inserts[0].params[0], 'devices/MK4');
  inserts.length = 0;
  await processMqttMessage('gw/2805a55efb68/publish', Buffer.from(JSON.stringify({
    msg_id: 3070, device_info: { mac: '2805a55efb68' }, data: []
  })), { qos: 1, retain: false } as any);
  assert.equal(inserts.length, 0);
});

test('MK4 remains decoded while retired model decoders are not wired into MQTT ingestion', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src', 'services', 'mqttService.ts'), 'utf8');
  assert.match(source, /topic === 'devices\/MK4'[\s\S]*decodeMk2\(messageBuffer\)/);
  assert.doesNotMatch(source, /decodeMk1|decodeMk3|topic === 'devices\/MK[123]'/);
  assert.match(source, /handleGatewayIdentityReport\(topic, payloadText\)/);
  assert.match(source, /handleHardwareGatewayAck\(topic, payloadText\)/);
});
