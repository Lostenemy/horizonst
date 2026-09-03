import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGatewayPayload, parseManualEmergencyPayload } from '../../presence/payload-parser';
import { manualEmergencyDeduplicationKey } from '../manual-emergency.service';

const topic = 'gateway/aabbccddeeff/publish';
const receivedAt = new Date('2026-08-10T07:48:23.000Z');

function payload(item: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ msg_id: 3070, data: [item] }), 'utf8');
}

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

test('3070 BXP-Button alarm is parsed as manual emergency and not as presence', () => {
  const raw = payload({
    type: 'bxp-button',
    type_code: 7,
    frame_type: 1,
    mac: '11:22:33:44:55:66',
    alarm_status: 1,
    trigger_count: 15,
    rssi: -62
  });

  const emergencies = parseManualEmergencyPayload(topic, raw, receivedAt);
  assert.deepEqual(emergencies, [{
    gatewayMac: 'aabbccddeeff',
    tagUid: '112233445566',
    alarmStatus: 1,
    triggerCount: 15,
    receivedAt: receivedAt.toISOString(),
    rawPayload: {
      type: 'bxp-button',
      type_code: 7,
      frame_type: 1,
      mac: '11:22:33:44:55:66',
      alarm_status: 1,
      trigger_count: 15,
      rssi: -62
    }
  }]);
  assert.equal(parseGatewayPayload(topic, raw, receivedAt).length, 0);
});

test('non-alarming BXP-Button remains a normal presence heartbeat', () => {
  const raw = payload({ type: 'bxp-button', type_code: 7, frame_type: 1, mac: '11-22-33-44-55-66', alarm_status: 0, trigger_count: 16 });
  assert.equal(parseManualEmergencyPayload(topic, raw, receivedAt).length, 0);
  const presence = parseGatewayPayload(topic, raw, receivedAt);
  assert.equal(presence.length, 1);
  assert.equal(presence[0].tagId, '112233445566');
  assert.equal(presence[0].eventType, 'heartbeat');
});

test('only msg_id 3070 can enter the manual emergency path', () => {
  const raw = Buffer.from(JSON.stringify({ msg_id: 3173, data: [{ type: 'bxp-button', frame_type: 1, mac: '11:22:33:44:55:66', alarm_status: 1 }] }));
  assert.equal(parseManualEmergencyPayload(topic, raw, receivedAt).length, 0);
  assert.equal(parseGatewayPayload(topic, raw, receivedAt).length, 1);
});

test('manual emergency requires frame_type 1 and alarm_status 1', () => {
  const cases = [
    { frame_type: 0, alarm_status: 1, expected: 0 },
    { frame_type: 1, alarm_status: 1, expected: 1 },
    { frame_type: 2, alarm_status: 1, expected: 0 },
    { frame_type: 1, alarm_status: 0, expected: 0 }
  ];

  for (const item of cases) {
    const raw = payload({ type: 'bxp-button', mac: 'FD9D4F8AE226', trigger_count: 24, ...item });
    assert.equal(parseManualEmergencyPayload('gw/2805a55efb68/publish', raw, receivedAt).length, item.expected);
  }
});

test('manual emergency service requires central identity and preserves ordered camera resolution', () => {
  const service = source('src/modules/alerts/manual-emergency.service.ts');
  assert.match(service, /resolveEventTechnicalIdentity/);
  assert.match(service, /t\.hardware_device_id = \$1/);
  assert.match(service, /g\.hardware_gateway_id = \$2/);
  assert.match(service, /identity\.source !== 'central'/);
  assert.doesNotMatch(service, /hardware_device_id IS NULL|tagClause|gatewayClause/);
  assert.match(service, /wta\.active = TRUE/);
  assert.match(service, /context\.worker_name \?\? 'Sin trabajador asignado'/);
  assert.match(service, /COALESCE\(pos\.cold_room_id, session\.cold_room_id, gateway\.cold_room_id\)/);
  assert.match(service, /crs\.ended_at IS NULL/);
});

test('deduplication is transactional across gateways and scoped by trigger count and time', () => {
  const service = source('src/modules/alerts/manual-emergency.service.ts');
  assert.match(service, /BEGIN/);
  assert.match(service, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(service, /event\.tagUid.*event\.triggerCount/s);
  assert.match(service, /metadata ->> 'triggerCount' IS NOT DISTINCT FROM/);
  assert.match(service, /DEDUPLICATION_WINDOW_SECONDS = 60/);
  assert.match(service, /manual emergency duplicate ignored/);
});

test('same trigger count deduplicates across gateways while a new trigger count creates a new identity', () => {
  const alerts = new Set<string>();
  const ingest = (_gatewayMac: string, triggerCount: number) => {
    alerts.add(manualEmergencyDeduplicationKey(31, triggerCount));
  };
  ingest('2805a55efb68', 24);
  ingest('007007e0c804', 24);
  assert.equal(alerts.size, 1);
  ingest('2805a55efb68', 25);
  assert.equal(alerts.size, 2);
});

test('manual emergency disables physical dispatch while existing alerts keep default dispatch', () => {
  const service = source('src/modules/alerts/manual-emergency.service.ts');
  const alerts = source('src/modules/alerts/alerts.service.ts');
  assert.match(service, /dispatchPhysicalAlarm: false/);
  assert.match(alerts, /params\.dispatchPhysicalAlarm !== false/);
  assert.match(alerts, /executeAlarmSequence\(/);
});

test('realtime snapshot enriches active alerts for the global emergency banner', () => {
  const realtime = source('src/modules/realtime/realtime.routes.ts');
  for (const field of ['worker_name', 'worker_dni', 'tag_uid', 'cold_room_name', 'severity', 'alert_type', 'message', 'created_at']) {
    assert.match(realtime, new RegExp(field));
  }
  assert.match(realtime, /LEFT JOIN workers/);
  assert.match(realtime, /LEFT JOIN tags/);
  assert.match(realtime, /LEFT JOIN cold_rooms/);
});

test('UI labels and persistently renders every active manual emergency until archived', () => {
  const html = source('web/index.html');
  const app = source('web/app.js');
  assert.match(html, /manualEmergencyBanner[\s\S]*role="alert"[\s\S]*aria-live="assertive"/);
  assert.match(app, /manual_emergency: 'Emergencia manual'/);
  assert.match(app, /activeAlerts\.filter\(\(alert\) => alert\.alert_type === 'manual_emergency'\)/);
  assert.match(app, /emergencies\.map/);
  assert.match(app, /Reconocer y archivar/);
  assert.match(app, /banner\.hidden = emergencies\.length === 0/);
  assert.match(app, /lastSnapshot\.activeAlerts\.filter\(\(alert\) => alert\.id !== id\)/);
  assert.doesNotMatch(app, /setTimeout\([^)]*manualEmergencyBanner/);
});
