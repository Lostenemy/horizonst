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
  tagMac?: string;
  payload: Record<string, unknown>;
}

type NormalizedGatewayAck = Omit<GatewayAck, 'topic' | 'gatewayMac'>;

export function normalizeGatewayAckPayload(payload: any): NormalizedGatewayAck | null {
  const msgId = payload?.msg_id;
  const resultCode = payload?.result_code ?? payload?.data?.result_code;

  if (typeof msgId !== 'number' || typeof resultCode !== 'number') return null;

  const resultMsg = payload?.result_msg ?? payload?.data?.result_msg ?? resultMap[resultCode];
  const tagMac = typeof payload?.data?.mac === 'string' ? payload.data.mac : undefined;

  return {
    msgId,
    resultCode,
    resultMsg,
    tagMac,
    payload
  };
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

    const normalized = normalizeGatewayAckPayload(payload);
    if (!normalized) {
      logger.debug({
        topic,
        payload,
        reason: typeof payload?.msg_id !== 'number' ? 'missing_or_invalid_msg_id' : 'missing_or_invalid_result_code'
      }, 'discarded gateway publish payload without ACK fields');
      return;
    }

    const gatewayMacFromTopic = topic.split('/')[1]?.toLowerCase();
    const gatewayMac = String(payload?.device_info?.mac ?? gatewayMacFromTopic ?? '').toLowerCase();
    if (!gatewayMac) {
      logger.debug({ topic, payload, reason: 'missing_gateway_mac' }, 'discarded gateway publish payload without gateway mac');
      return;
    }

    const ack: GatewayAck = {
      topic,
      gatewayMac,
      ...normalized
    };

    logger.info({
      gatewayMac,
      msgId: ack.msgId,
      resultCode: ack.resultCode,
      resultMsg: ack.resultMsg,
      tagMac: ack.tagMac
    }, 'gateway ACK received');

    emitAckToWaiters(ack);

    const cmd = await findOpenCommandByGatewayAndMsgId(gatewayMac, ack.msgId);
    if (!cmd) return;

    await appendResponse({
      tagCommandId: cmd.id,
      gatewayMac,
      msgId: ack.msgId,
      resultCode: ack.resultCode,
      resultMsg: ack.resultMsg,
      payload: ack.payload
    });

    const ok = ack.resultCode === 0;
    await updateCommandStatus(cmd.id, ok ? 'ack_ok' : 'ack_error', { completed: true, lastError: ok ? undefined : ack.resultMsg });
    await appendAuditLog({
      actorType: 'system',
      action: ok ? 'tag_command_ack_ok' : 'tag_command_ack_error',
      entityType: 'tag_command',
      entityId: cmd.id,
      payload: {
        gatewayMac,
        msgId: ack.msgId,
        resultCode: ack.resultCode,
        resultMsg: ack.resultMsg,
        tagMac: ack.tagMac
      }
    });
  });

  logger.info('gateway reply listener initialized');
}
