import { randomUUID } from 'crypto';
import { normalizeInventoryMac } from '../utils/mac';

type DiagnosticItem = { receivedAt: string; frameType: number | null; alarmStatus: number | null; subAlarmStatus: number | null; triggerCount: number | null; comparison: string };
type Capture = { id: string; actor: number; gatewayId: number; companyId: string; gatewayMac: string; deviceId: number; tagMac: string; expiresAt: number; items: DiagnosticItem[]; lastCount: number | null; timer: NodeJS.Timeout };
const captures = new Map<string, Capture>();
const MAX_CAPTURES = 50;
const MAX_ITEMS = 100;
const CAPTURE_MS = 5 * 60_000;

function prune(now: number) {
  for (const [id, capture] of captures) if (capture.expiresAt <= now) { clearTimeout(capture.timer); captures.delete(id); }
}

export function startB5DiagnosticCapture(input: Omit<Capture, 'id' | 'expiresAt' | 'items' | 'lastCount' | 'timer'>, now = Date.now()) {
  prune(now);
  for (const [id, capture] of captures) {
    if (capture.actor === input.actor && capture.gatewayId === input.gatewayId) {
      clearTimeout(capture.timer);
      captures.delete(id);
    }
  }
  if (captures.size >= MAX_CAPTURES) throw new Error('Capture capacity reached');
  const id = randomUUID();
  const timer = setTimeout(() => captures.delete(id), CAPTURE_MS);
  timer.unref();
  captures.set(id, { ...input, id, expiresAt: now + CAPTURE_MS, items: [], lastCount: null, timer });
  return { id, expiresAt: new Date(now + CAPTURE_MS).toISOString() };
}

export function getB5DiagnosticCapture(id: string, actor: number, gatewayId: number, companyId: string, deviceId: number, now = Date.now(), current?: { gatewayMac: string; tagMac: string }) {
  prune(now);
  const c = captures.get(id);
  if (!c || c.actor !== actor || c.gatewayId !== gatewayId || c.companyId !== companyId || c.deviceId !== deviceId ||
      (current && (c.gatewayMac !== current.gatewayMac || c.tagMac !== current.tagMac))) return null;
  return { expiresAt: new Date(c.expiresAt).toISOString(), items: c.items.map((item) => ({ ...item })) };
}

const integer = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;

// Solo datos mínimos en memoria; nunca se conserva el paquete ni la identidad del tag en los resultados.
export function recordB5DiagnosticMessage(topic: string, payload: unknown, now = Date.now()): void {
  if (!captures.size) return;
  prune(now);
  const match = /^gw\/([0-9a-f]{12})\/publish$/i.exec(topic);
  if (!match || !payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const root = payload as Record<string, any>;
  const gatewayMac = normalizeInventoryMac(match[1], 'gateway');
  if (root.msg_id !== 3070 || !gatewayMac || normalizeInventoryMac(root.device_info?.mac, 'gateway') !== gatewayMac || !Array.isArray(root.data)) return;
  for (const c of captures.values()) {
    if (c.gatewayMac !== gatewayMac) continue;
    for (const item of root.data.slice(0, 1000)) {
      if (!item || typeof item !== 'object' || item.type !== 'bxp-button' || normalizeInventoryMac(item.mac, 'device')?.toLowerCase() !== c.tagMac) continue;
      const triggerCount = integer(item.trigger_count, 0, 65535);
      const comparison = triggerCount === null ? 'contador no válido o ausente'
        : c.lastCount === null ? 'primera observación'
          : triggerCount === c.lastCount ? 'contador repetido' : 'contador diferente; evento no verificado';
      c.items.push({ receivedAt: new Date(now).toISOString(), frameType: integer(item.frame_type, 0, 255),
        alarmStatus: integer(item.alarm_status, 0, 255), subAlarmStatus: integer(item.sub_alarm_status, 0, 255), triggerCount, comparison });
      if (triggerCount !== null) c.lastCount = triggerCount;
      if (c.items.length > MAX_ITEMS) c.items.shift();
    }
  }
}

export function clearB5DiagnosticCapturesForTests() { for (const capture of captures.values()) clearTimeout(capture.timer); captures.clear(); }
