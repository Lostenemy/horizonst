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
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.tags)) return payload.tags;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.devices)) return payload.devices;
  if (Array.isArray(payload.data?.tags)) return payload.data.tags;
  if (Array.isArray(payload.data?.devices)) return payload.data.devices;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return [payload.data];
  return [payload];
}

function numericValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isManualEmergencyItem(item: any): boolean {
  const typeCode = numericValue(item?.type_code ?? item?.typeCode);
  const typeText = String(item?.type ?? '').toLowerCase();
  const alarmStatus = numericValue(item?.alarm_status ?? item?.alarmStatus ?? item?.data?.alarm_status);
  return (typeText === 'bxp-button' || typeCode === 7) && alarmStatus !== null && alarmStatus > 0;
}

function isGatewaySelfDescription(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  const hasGatewayDescriptor = Boolean(
    item.device_name ||
      item.company_name ||
      item.product_model ||
      item.firmware_version ||
      item.hardware_version ||
      item.software_version
  );
  const hasGatewayMacFields = Boolean(item.ble_mac || item.eth_mac);
  const hasTagHint = Boolean(item.tagId || item.tag_uid || item.tag_mac || item.mac || item.type_code === 7 || String(item.type ?? '').toLowerCase().includes('bxp'));
  return hasGatewayDescriptor && hasGatewayMacFields && !hasTagHint;
}

function pickTagIdentifier(item: any, gatewayMac: string): string | null {
  const typeCode = Number(item?.type_code ?? item?.typeCode ?? -1);
  const typeText = String(item?.type ?? '').toLowerCase();

  const explicitTagCandidates = [
    item.tagId,
    item.tag_id,
    item.tagUid,
    item.tag_uid,
    item.tagMac,
    item.tag_mac,
    item?.data?.tagId,
    item?.data?.tag_id,
    item?.data?.tag_uid,
    item?.data?.tag_mac,
    item?.payload?.tagId,
    item?.payload?.tag_uid
  ];

  for (const candidate of explicitTagCandidates) {
    const normalized = normalizeMac(candidate);
    if (normalized && normalized !== gatewayMac) return normalized;
  }

  const likelyBeaconCandidates = [
    item.mac,
    item?.data?.mac,
    item?.payload?.mac,
    item.beacon?.mac,
    item.adv?.mac,
    item.deviceAddress,
    item.device_address,
    item.addr,
    item.address
  ];

  const looksLikeTagEvent = typeCode === 7 || typeText.includes('bxp-button') || typeText.includes('beacon') || typeText.includes('tag');
  if (looksLikeTagEvent) {
    for (const candidate of likelyBeaconCandidates) {
      const normalized = normalizeMac(candidate);
      if (normalized && normalized !== gatewayMac) return normalized;
    }
  }

  const bleCandidates = [item.ble_mac, item.bleMac, item?.data?.ble_mac, item?.payload?.ble_mac];
  for (const candidate of bleCandidates) {
    const normalized = normalizeMac(candidate);
    if (normalized && normalized !== gatewayMac && looksLikeTagEvent) return normalized;
  }

  return null;
}

export function parseGatewayPayload(topic: string, payloadRaw: Buffer, receivedAt: Date = new Date()): ParsedPresenceEvent[] {
  const [, gatewayMacRaw] = topic.split('/');
  const gatewayMac = normalizeMac(gatewayMacRaw) ?? String(gatewayMacRaw ?? '').toLowerCase();

  const payload = JSON.parse(payloadRaw.toString('utf8'));
  const list = toItems(payload);
  const events: ParsedPresenceEvent[] = [];

  list.forEach((item: any, idx: number) => {
    if (isGatewaySelfDescription(item)) return;
    if (isManualEmergencyItem(item)) return;

    const timestamp = receivedAt.toISOString();
    const payloadTimestamp = item.timestamp ?? item.ts ?? item.created_at;
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
      payloadTimestamp,
      rssi: typeof item.rssi === 'number' ? item.rssi : typeof item?.data?.rssi === 'number' ? item.data.rssi : undefined,
      battery: typeof item.battery === 'number' ? item.battery : typeof item?.data?.battery === 'number' ? item.data.battery : undefined,
      rawPayload: item
    });
  });

  return events;
}

export interface ParsedManualEmergencyEvent {
  gatewayMac: string;
  tagUid: string;
  alarmStatus: number;
  triggerCount: number | null;
  receivedAt: string;
  rawPayload: Record<string, unknown>;
}

export function parseManualEmergencyPayload(topic: string, payloadRaw: Buffer, receivedAt: Date = new Date()): ParsedManualEmergencyEvent[] {
  const payload = JSON.parse(payloadRaw.toString('utf8'));
  if (numericValue(payload?.msg_id) !== 3070) return [];

  const [, gatewayMacRaw] = topic.split('/');
  const gatewayMac = normalizeMac(gatewayMacRaw) ?? normalizeMac(payload?.device_info?.mac) ?? String(gatewayMacRaw ?? '').toLowerCase();

  return toItems(payload).flatMap((item: any) => {
    if (!isManualEmergencyItem(item)) return [];
    const tagUid = pickTagIdentifier(item, gatewayMac);
    const alarmStatus = numericValue(item?.alarm_status ?? item?.alarmStatus ?? item?.data?.alarm_status);
    if (!tagUid || alarmStatus === null) return [];

    return [{
      gatewayMac,
      tagUid,
      alarmStatus,
      triggerCount: numericValue(item?.trigger_count ?? item?.triggerCount ?? item?.data?.trigger_count),
      receivedAt: receivedAt.toISOString(),
      rawPayload: item as Record<string, unknown>
    }];
  });
}
