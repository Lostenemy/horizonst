import { addMqttMessageHandler } from '../../mqtt/mqtt.service';
import { logger } from '../../../utils/logger';
import { appendAuditLog } from '../../audit/audit.service';
import { appendResponse, findOpenCommandByGatewayAndMsgId, updateCommandStatus } from './tag-command.repository';

const resultMap: Record<number, string> = {
  0: 'success',
  1: 'length error',
  2: 'type error',
  3: 'range error',
  4: 'no object error'
};

export interface GatewayAck {
  topic: string;
  gatewayMac: string;
  msgId: number;
  resultCode: number;
  resultMsg?: string;
  payload: Record<string, unknown>;
}

type PendingWaiter = {
  resolve: (ack: GatewayAck) => void;
  timer: NodeJS.Timeout;
};

const pendingWaiters = new Map<string, PendingWaiter[]>();

function waiterKey(gatewayMac: string, msgId: number): string {
  return `${gatewayMac.toLowerCase()}:${msgId}`;
}

function popWaitersForKey(key: string): PendingWaiter[] {
  const waiters = pendingWaiters.get(key) ?? [];
  pendingWaiters.delete(key);
  return waiters;
}

function emitAckToWaiters(ack: GatewayAck): void {
  const key = waiterKey(ack.gatewayMac, ack.msgId);
  const waiters = popWaitersForKey(key);
  if (!waiters.length) return;

  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(ack);
  }
}

function removeWaiter(key: string, resolveRef: (ack: GatewayAck) => void): void {
  const list = pendingWaiters.get(key) ?? [];
  const remaining = list.filter((item) => item.resolve !== resolveRef);
  if (remaining.length) pendingWaiters.set(key, remaining);
  else pendingWaiters.delete(key);
}

export function waitForGatewayReply(params: { gatewayMac: string; msgId: number; timeoutMs: number }): Promise<GatewayAck> {
  return waitForGatewayReplyMulti({ gatewayMac: params.gatewayMac, msgIds: [params.msgId], timeoutMs: params.timeoutMs });
}

export function waitForGatewayReplyMulti(params: { gatewayMac: string; msgIds: number[]; timeoutMs: number }): Promise<GatewayAck> {
  const msgIds = [...new Set(params.msgIds.filter((id) => Number.isFinite(id)))];
  if (!msgIds.length) return Promise.reject(new Error('waitForGatewayReplyMulti requires msgIds'));

  return new Promise((resolve, reject) => {
    let settled = false;
    const timers: NodeJS.Timeout[] = [];

    const wrappedResolve = (ack: GatewayAck) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      for (const msgId of msgIds) removeWaiter(waiterKey(params.gatewayMac, msgId), wrappedResolve);
      resolve(ack);
    };

    for (const msgId of msgIds) {
      const key = waiterKey(params.gatewayMac, msgId);
      const timer = setTimeout(() => {
        removeWaiter(key, wrappedResolve);
        if (settled) return;

        const stillWaiting = msgIds.some((id) => (pendingWaiters.get(waiterKey(params.gatewayMac, id)) ?? []).some((w) => w.resolve === wrappedResolve));
        if (!stillWaiting) {
          settled = true;
          reject(new Error(`timeout waiting gateway reply msg_ids=${msgIds.join(',')}`));
        }
      }, params.timeoutMs);
      timer.unref();
      timers.push(timer);

      const list = pendingWaiters.get(key) ?? [];
      list.push({ resolve: wrappedResolve, timer });
      pendingWaiters.set(key, list);
    }
  });
}

export function startGatewayReplyListener(): void {
  addMqttMessageHandler(async (topic, payloadBuf) => {
    if (!topic.endsWith('/publish')) return;

    let payload: any;
    try {
      payload = JSON.parse(payloadBuf.toString('utf8'));
    } catch {
      return;
    }

    if (typeof payload?.msg_id !== 'number' || typeof payload?.result_code !== 'number') return;

    const gatewayMacFromTopic = topic.split('/')[1]?.toLowerCase();
    const gatewayMac = String(payload?.device_info?.mac ?? gatewayMacFromTopic ?? '').toLowerCase();
    if (!gatewayMac) return;

    const ack: GatewayAck = {
      topic,
      gatewayMac,
      msgId: payload.msg_id,
      resultCode: payload.result_code,
      resultMsg: payload.result_msg ?? resultMap[payload.result_code],
      payload
    };

    emitAckToWaiters(ack);

    const cmd = await findOpenCommandByGatewayAndMsgId(gatewayMac, payload.msg_id);
    if (!cmd) return;

    await appendResponse({
      tagCommandId: cmd.id,
      gatewayMac,
      msgId: payload.msg_id,
      resultCode: payload.result_code,
      resultMsg: payload.result_msg ?? resultMap[payload.result_code],
      payload
    });

    const ok = payload.result_code === 0;
    await updateCommandStatus(cmd.id, ok ? 'ack_ok' : 'ack_error', { completed: true, lastError: ok ? undefined : (payload.result_msg ?? resultMap[payload.result_code]) });
    await appendAuditLog({
      actorType: 'system',
      action: ok ? 'tag_command_ack_ok' : 'tag_command_ack_error',
      entityType: 'tag_command',
      entityId: cmd.id,
      payload: {
        gatewayMac,
        msgId: payload.msg_id,
        resultCode: payload.result_code,
        resultMsg: payload.result_msg ?? resultMap[payload.result_code]
      }
    });
  });

  logger.info('gateway reply listener initialized');
}
