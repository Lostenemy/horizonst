import crypto from 'node:crypto';
import { ParsedPresenceEvent } from './types';

function inferEventType(payload: any): ParsedPresenceEvent['eventType'] {
  if (payload.eventType && ['enter', 'exit', 'heartbeat', 'movement', 'telemetry'].includes(payload.eventType)) {
    return payload.eventType;
  }
  if (payload.inZone === true || payload.zoneEvent === 'enter') return 'enter';
  if (payload.inZone === false || payload.zoneEvent === 'exit') return 'exit';
  if (payload.motion === true) return 'movement';
  return 'heartbeat';
}

export function parseGatewayPayload(topic: string, payloadRaw: Buffer): ParsedPresenceEvent[] {
  const [, gatewayMac] = topic.split('/');
  const payload = JSON.parse(payloadRaw.toString('utf8'));
  const list = Array.isArray(payload) ? payload : payload.tags ?? payload.events ?? [payload];

  return list.map((item: any, idx: number) => {
    const timestamp = item.timestamp ?? item.ts ?? new Date().toISOString();
    const tagId = item.tagId ?? item.mac ?? item.ble_mac ?? item.deviceId;
    if (!tagId) {
      throw new Error('payload without tag identifier');
    }

    const fingerprint = JSON.stringify({ gatewayMac, tagId, timestamp, idx, ev: item.eventType ?? item.zoneEvent });

    return {
      eventId: item.eventId ?? crypto.createHash('sha256').update(fingerprint).digest('hex'),
      gatewayMac,
      tagId: String(tagId).toLowerCase(),
      cameraCode: item.cameraCode ?? item.zoneId,
      eventType: inferEventType(item),
      timestamp,
      rssi: typeof item.rssi === 'number' ? item.rssi : undefined,
      battery: typeof item.battery === 'number' ? item.battery : undefined,
      rawPayload: item
    };
  });
}
