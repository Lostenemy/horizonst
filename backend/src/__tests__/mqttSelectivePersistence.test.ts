import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { pool } from '../db/pool';
import { OFFICIAL_TOPICS, processMqttMessage } from '../services/mqttService';

const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);

afterEach(() => { (pool as any).query = originalQuery; (pool as any).connect = originalConnect; });

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
  (pool as any).connect = async () => ({
    query: async (sql: string) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('SELECT id, company_id FROM gateways')) {
        return { rows: [{ id: 41, company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] };
      }
      if (sql.includes('INSERT INTO hardware_gateway_observed_settings')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO hardware_gateway_ble_snapshots')) return { rows: [], rowCount: 1 };
      if (sql.includes('DELETE FROM hardware_gateway_ble_snapshot_items')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO hardware_gateway_ble_snapshot_items')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release: () => undefined
  });
  await processMqttMessage('gw/2805a55efb68/publish', Buffer.from(JSON.stringify({
    msg_id: 2011, device_info: { mac: '2805a55efb68' },
    data: { net_led: 1, sys_led: 1, server_led: 1 }
  })), { qos: 1, retain: false } as any);
  assert.equal(inserts.length, 0);
  await processMqttMessage('gw/2805a55efb68/publish', Buffer.from(JSON.stringify({
    msg_id: 2201, device_info: { mac: '2805a55efb68' },
    data: { ble_conn_list: [{ mac: 'fd9d4f8ae226', type: 2 }] }
  })), { qos: 1, retain: false } as any);
  assert.equal(inserts.length, 0, '2201 is normalized but never persisted as raw MQTT');
});

test('MK4 remains decoded while retired model decoders are not wired into MQTT ingestion', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src', 'services', 'mqttService.ts'), 'utf8');
  assert.match(source, /topic === 'devices\/MK4'[\s\S]*decodeMk2\(messageBuffer\)/);
  assert.doesNotMatch(source, /decodeMk1|decodeMk3|topic === 'devices\/MK[123]'/);
  assert.match(source, /handleGatewayIdentityReport\(topic, payloadText\)/);
  assert.match(source, /handleGatewayConfigurationReport\(topic, payloadText\)/);
  assert.match(source, /handleHardwareGatewayAck\(topic, payloadText\)/);
});
