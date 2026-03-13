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

function normalizeTagId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;
  return v.replace(/[:-]/g, '').toLowerCase();
}

function isLikelyMac(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/[:-]/g, '').toLowerCase();
  return /^[0-9a-f]{12}$/.test(normalized);
}

function deepFindTagIdentifier(node: unknown, depth = 0): string | null {
  if (depth > 5 || node === null || node === undefined) return null;
  if (typeof node === 'string' && isLikelyMac(node)) return normalizeTagId(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindTagIdentifier(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase();
      if ((lk.includes('tag') || lk.includes('ble') || lk.includes('mac') || lk.includes('address') || lk.includes('addr')) && typeof v === 'string') {
        const normalized = normalizeTagId(v);
        if (normalized) return normalized;
      }
    }
    for (const v of Object.values(obj)) {
      const found = deepFindTagIdentifier(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function pickTagIdentifier(item: any): string | null {
  const candidates = [
    item.tagId,
    item.tag_id,
    item.tagUid,
    item.tag_uid,
    item.tagMac,
    item.tag_mac,
    item.mac,
    item.ble_mac,
    item.bleMac,
    item.deviceId,
    item.device_id,
    item.deviceAddress,
    item.device_address,
    item.addr,
    item.address,
    item?.data?.mac,
    item?.data?.ble_mac,
    item?.data?.tag_mac,
    item?.data?.tag_uid,
    item?.device_info?.mac,
    item?.device?.mac,
    item?.beacon?.mac,
    item?.beacon?.address,
    item?.adv?.mac,
    item?.payload?.mac,
    item?.payload?.tagId,
    item?.payload?.tag_uid
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTagId(candidate);
    if (normalized) return normalized;
  }

  return deepFindTagIdentifier(item);
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

export function parseGatewayPayload(topic: string, payloadRaw: Buffer): ParsedPresenceEvent[] {
  const [, gatewayMacRaw] = topic.split('/');
  const gatewayMac = normalizeTagId(gatewayMacRaw) ?? gatewayMacRaw?.toLowerCase() ?? '';

  const payload = JSON.parse(payloadRaw.toString('utf8'));
  const list = toItems(payload);
  const events: ParsedPresenceEvent[] = [];

  list.forEach((item: any, idx: number) => {
    const timestamp = item.timestamp ?? item.ts ?? item.created_at ?? new Date().toISOString();
    const tagId = pickTagIdentifier(item);
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
