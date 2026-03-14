import crypto from 'node:crypto';
import { ParsedPresenceEvent } from './types';

function inferEventType(payload: any): ParsedPresenceEvent['eventType'] {
  const explicit = payload.eventType ?? payload.event_type ?? payload.type ?? payload.zoneEvent;
  if (typeof explicit === 'string') {
    const normalized = explicit.toLowerCase();
    if (['enter', 'entry', 'in', 'inside', 'zone_enter'].includes(normalized)) return 'enter';
    if (['exit', 'out', 'outside', 'zone_exit'].includes(normalized)) return 'exit';
    if (['movement', 'motion'].includes(normalized)) return 'movement';
    if (['heartbeat', 'keepalive', 'presence'].includes(normalized)) return 'heartbeat';
  }

  if (payload.inZone === true || payload.inside === true || payload.zoneEvent === 'enter') return 'enter';
  if (payload.inZone === false || payload.inside === false || payload.zoneEvent === 'exit') return 'exit';
  if (payload.motion === true) return 'movement';
  return 'heartbeat';
}

function normalizeMac(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;
  const normalized = v.replace(/[:-]/g, '').toLowerCase();
  return /^[0-9a-f]{12}$/.test(normalized) ? normalized : null;
}

function toItems(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.tags)) return payload.tags;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.devices)) return payload.devices;
  if (Array.isArray(payload.data?.tags)) return payload.data.tags;
  if (Array.isArray(payload.data?.devices)) return payload.data.devices;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return [payload.data];
  return [payload];
}

function pickTagIdentifier(item: any, gatewayMac: string): string | null {
  const preferredCandidates = [
    item.tagId,
    item.tag_id,
    item.tagUid,
    item.tag_uid,
    item.tagMac,
    item.tag_mac,
    item.ble_mac,
    item.bleMac,
    item.deviceAddress,
    item.device_address,
    item.addr,
    item.address,
    item?.data?.tagId,
    item?.data?.tag_id,
    item?.data?.tag_uid,
    item?.data?.tag_mac,
    item?.data?.ble_mac,
    item?.beacon?.mac,
    item?.beacon?.address,
    item?.adv?.mac,
    item?.payload?.tagId,
    item?.payload?.tag_uid,
    item?.payload?.ble_mac
  ];

  for (const candidate of preferredCandidates) {
    const normalized = normalizeMac(candidate);
    if (normalized && normalized !== gatewayMac) return normalized;
  }

  const genericCandidates = [
    item.mac,
    item.deviceId,
    item.device_id,
    item?.data?.mac,
    item?.payload?.mac
  ];

  for (const candidate of genericCandidates) {
    const normalized = normalizeMac(candidate);
    if (normalized && normalized !== gatewayMac) return normalized;
  }

  return null;
}

export function parseGatewayPayload(topic: string, payloadRaw: Buffer): ParsedPresenceEvent[] {
  const [, gatewayMacRaw] = topic.split('/');
  const gatewayMac = normalizeMac(gatewayMacRaw) ?? String(gatewayMacRaw ?? '').toLowerCase();

  const payload = JSON.parse(payloadRaw.toString('utf8'));
  const list = toItems(payload);
  const events: ParsedPresenceEvent[] = [];

  list.forEach((item: any, idx: number) => {
    const timestamp = item.timestamp ?? item.ts ?? item.created_at ?? new Date().toISOString();
    const tagId = pickTagIdentifier(item, gatewayMac);
    if (!tagId) return;

    const fingerprint = JSON.stringify({ gatewayMac, tagId, timestamp, idx, ev: item.eventType ?? item.zoneEvent ?? item.type });

    events.push({
      eventId: item.eventId ?? item.event_id ?? crypto.createHash('sha256').update(fingerprint).digest('hex'),
      gatewayMac,
      tagId,
      cameraCode: item.cameraCode ?? item.zoneId ?? item.zone_id,
      eventType: inferEventType(item),
      timestamp,
      rssi: typeof item.rssi === 'number' ? item.rssi : typeof item?.data?.rssi === 'number' ? item.data.rssi : undefined,
      battery: typeof item.battery === 'number' ? item.battery : typeof item?.data?.battery === 'number' ? item.data.battery : undefined,
      rawPayload: item
    });
  });

  return events;
}
