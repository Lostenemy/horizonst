import { pool } from '../db/pool';
import { normalizeGatewayMac } from '../utils/mac';
import { redactHardwarePayload } from './hardwarePayloadRedaction';

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
  receivedSequence?: number;
}

type Waiter = {
  resolve: (ack: HardwareGatewayAck) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const waiters = new Map<string, Waiter[]>();
let receivedSequence = 0;

const keyFor = (gatewayMac: string, msgId: number): string => `${gatewayMac}:${msgId}`;

function removeWaiter(keys: string[], target: Waiter): void {
  for (const key of keys) {
    const remaining = (waiters.get(key) ?? []).filter((item) => item !== target);
    if (remaining.length) waiters.set(key, remaining);
    else waiters.delete(key);
  }
  if (target.signal && target.onAbort) target.signal.removeEventListener('abort', target.onAbort);
}

export function waitForHardwareGatewayAck(params: {
  gatewayMac: string;
  msgIds: number[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<HardwareGatewayAck> {
  const gatewayMac = normalizeGatewayMac(params.gatewayMac);
  const msgIds = [...new Set(params.msgIds.filter(Number.isInteger))];
  if (!gatewayMac || !msgIds.length) return Promise.reject(new Error('Invalid gateway ACK waiter'));
  if (params.signal?.aborted) return Promise.reject(new Error('gateway ACK waiter cancelled'));
  const keys = msgIds.map((msgId) => keyFor(gatewayMac, msgId));

  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      resolve: (ack) => {
        clearTimeout(waiter.timer);
        removeWaiter(keys, waiter);
        resolve(ack);
      },
      reject,
      signal: params.signal,
      timer: setTimeout(() => {
        removeWaiter(keys, waiter);
        reject(new Error(`timeout waiting gateway reply msg_ids=${msgIds.join(',')}`));
      }, params.timeoutMs)
    };
    waiter.onAbort = () => {
      clearTimeout(waiter.timer);
      removeWaiter(keys, waiter);
      reject(new Error('gateway ACK waiter cancelled'));
    };
    waiter.timer.unref();
    for (const key of keys) waiters.set(key, [...(waiters.get(key) ?? []), waiter]);
    params.signal?.addEventListener('abort', waiter.onAbort, { once: true });
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
  const topicMac = normalizeGatewayMac(topic.match(/^gw\/([^/]+)\/publish$/i)?.[1]);
  if (!topicMac) return null;
  const payloadMacValue = data.device_info?.mac;
  if (payloadMacValue !== undefined && normalizeGatewayMac(payloadMacValue) !== topicMac) return null;
  return {
    gatewayMac: topicMac,
    msgId,
    resultCode,
    resultMessage: String(data.result_msg ?? data.data?.result_msg ?? resultMessages[resultCode] ?? ''),
    payload: data,
    receivedSequence: ++receivedSequence
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
       SET status = CASE WHEN $3 <> 0 THEN 'ack_error'
         WHEN EXISTS (
             SELECT 1 FROM hardware_gateway_commands prior
             WHERE prior.gateway_id = c.gateway_id AND prior.msg_id = c.msg_id
               AND (prior.status = 'timed_out' OR prior.connection_state = 'timed_out') AND prior.id <> c.id
           ) THEN 'ack_ambiguous' ELSE 'ack_success' END,
           ack_at = NOW(), ack_msg_id = $2, result_code = $3,
           result_message = CASE WHEN $3 = 0 AND EXISTS (
             SELECT 1 FROM hardware_gateway_commands prior
             WHERE prior.gateway_id = c.gateway_id AND prior.msg_id = c.msg_id
               AND (prior.status = 'timed_out' OR prior.connection_state = 'timed_out') AND prior.id <> c.id
           ) THEN 'ACK correlation ambiguous after previous timeout' ELSE $4 END,
           response_payload = $5::jsonb
       FROM gateways g
       WHERE c.gateway_id = g.id
         AND regexp_replace(lower(g.mac_address), '[^0-9a-f]', '', 'g') = $1
         AND $2 IN (c.msg_id, c.msg_id + 2000, c.msg_id + 2001)
         AND NOT (c.msg_id = 1150 AND $2 = 3151)
         AND c.status IN ('pending', 'published')`,
      [ack.gatewayMac, ack.msgId, ack.resultCode, ack.resultMessage ?? null, JSON.stringify(redactHardwarePayload(ack.payload))]
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
