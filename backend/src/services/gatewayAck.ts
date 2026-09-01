import { pool } from '../db/pool';
import { normalizeGatewayMac } from '../utils/mac';

const resultMessages: Record<number, string> = {
  0: 'success',
  1: 'length error',
  2: 'type error',
  3: 'range error',
  4: 'no object error'
};

export interface HardwareGatewayAck {
  gatewayMac: string;
  msgId: number;
  resultCode: number;
  resultMessage?: string;
  payload: Record<string, unknown>;
}

type Waiter = {
  resolve: (ack: HardwareGatewayAck) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const waiters = new Map<string, Waiter[]>();

const keyFor = (gatewayMac: string, msgId: number): string => `${gatewayMac}:${msgId}`;

function removeWaiter(keys: string[], target: Waiter): void {
  for (const key of keys) {
    const remaining = (waiters.get(key) ?? []).filter((item) => item !== target);
    if (remaining.length) waiters.set(key, remaining);
    else waiters.delete(key);
  }
}

export function waitForHardwareGatewayAck(params: {
  gatewayMac: string;
  msgIds: number[];
  timeoutMs: number;
}): Promise<HardwareGatewayAck> {
  const gatewayMac = normalizeGatewayMac(params.gatewayMac);
  const msgIds = [...new Set(params.msgIds.filter(Number.isInteger))];
  if (!gatewayMac || !msgIds.length) return Promise.reject(new Error('Invalid gateway ACK waiter'));
  const keys = msgIds.map((msgId) => keyFor(gatewayMac, msgId));

  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      resolve: (ack) => {
        clearTimeout(waiter.timer);
        removeWaiter(keys, waiter);
        resolve(ack);
      },
      reject,
      timer: setTimeout(() => {
        removeWaiter(keys, waiter);
        reject(new Error(`timeout waiting gateway reply msg_ids=${msgIds.join(',')}`));
      }, params.timeoutMs)
    };
    waiter.timer.unref();
    for (const key of keys) waiters.set(key, [...(waiters.get(key) ?? []), waiter]);
  });
}

export function normalizeHardwareGatewayAck(
  topic: string,
  payload: unknown
): HardwareGatewayAck | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, any>;
  const msgId = data.msg_id;
  const resultCode = data.result_code ?? data.data?.result_code;
  if (!Number.isInteger(msgId) || !Number.isInteger(resultCode)) return null;
  const topicMac = topic.match(/^gw\/([^/]+)\/publish$/i)?.[1];
  const gatewayMac = normalizeGatewayMac(data.device_info?.mac ?? topicMac);
  if (!gatewayMac) return null;
  return {
    gatewayMac,
    msgId,
    resultCode,
    resultMessage: String(data.result_msg ?? data.data?.result_msg ?? resultMessages[resultCode] ?? ''),
    payload: data
  };
}

export async function handleHardwareGatewayAck(topic: string, payloadText: string): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return;
  }
  const ack = normalizeHardwareGatewayAck(topic, payload);
  if (!ack) return;

  const key = keyFor(ack.gatewayMac, ack.msgId);
  for (const waiter of [...(waiters.get(key) ?? [])]) waiter.resolve(ack);

  try {
    await pool.query(
      `UPDATE hardware_gateway_commands c
       SET status = CASE WHEN $3 = 0 THEN 'ack_success' ELSE 'ack_error' END,
           ack_at = NOW(), ack_msg_id = $2, result_code = $3,
           result_message = $4, response_payload = $5::jsonb
       FROM gateways g
       WHERE c.gateway_id = g.id
         AND regexp_replace(lower(g.mac_address), '[^0-9a-f]', '', 'g') = $1
         AND $2 IN (c.msg_id, c.msg_id + 2000, c.msg_id + 2001)
         AND c.status IN ('pending', 'published')`,
      [ack.gatewayMac, ack.msgId, ack.resultCode, ack.resultMessage ?? null, JSON.stringify(ack.payload)]
    );
  } catch (error) {
    console.error('Failed to persist hardware gateway ACK', error);
  }
}

export function resetHardwareGatewayAckWaitersForTests(): void {
  for (const list of waiters.values()) {
    for (const waiter of list) clearTimeout(waiter.timer);
  }
  waiters.clear();
}
