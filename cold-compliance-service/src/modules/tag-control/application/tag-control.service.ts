import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { appendAuditLog } from '../../audit/audit.service';
import { mqttPublish } from '../../mqtt/mqtt.service';
import { sleep } from '../../../utils/sleep';
import { buildCommandPayload, commandMsgId } from '../domain/command-builder';
import { nextMsgId } from '../domain/msg-id.service';
import { SendTagCommandInput } from '../domain/types';
import { findRecentByDedupKey, createAttempt, createTagCommand, getCommand, listActiveCommands, listCommands, markAttemptResult, updateCommandStatus } from '../infrastructure/tag-command.repository';
import { createTemplate, findTemplate, listTemplates, resolveTagTarget, updateTemplate } from '../infrastructure/tag-control.repository';

function toTopic(gatewayMac: string): string {
  return env.MQTT_COMMAND_TOPIC_TEMPLATE.replace('{gatewayMac}', gatewayMac.toLowerCase());
}

function dedupKeyOf(input: SendTagCommandInput, gatewayMac: string, commandType: string): string {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({ workerId: input.workerId, tagId: input.tagId, tagUid: input.tagUid, gatewayMac, commandType, triggerReason: input.triggerReason }))
    .digest('hex');
}

async function waitForCompletion(commandId: string, timeoutMs: number): Promise<'ack_ok' | 'ack_error' | 'timeout'> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const cmd = await getCommand(commandId);
    if (!cmd) return 'timeout';
    if (cmd.status === 'ack_ok' || cmd.status === 'ack_error') return cmd.status;
    await sleep(200);
  }
  return 'timeout';
}

export async function sendTagCommand(input: SendTagCommandInput) {
  if (!env.TAG_CONTROL_ENABLED) throw new Error('tag-control disabled by configuration');

  const resolved = await resolveTagTarget({
    workerId: input.workerId,
    tagId: input.tagId,
    tagUid: input.tagUid,
    gatewayMac: input.gatewayMac,
    strategy: env.TAG_CONTROL_GATEWAY_STRATEGY
  });

  let commandType: string;
  let payload: Record<string, unknown>;

  if (input.templateCode) {
    const tpl = await findTemplate(input.templateCode);
    if (!tpl) throw new Error(`template not found: ${input.templateCode}`);
    commandType = `template:${input.templateCode}`;
    const msgId = await nextMsgId();
    payload = {
      msg_id: msgId,
      device_info: { mac: resolved.gatewayMac.toUpperCase() },
      data: { mac: resolved.tagUid.toUpperCase() },
      channels: tpl.channels
    };
  } else {
    if (!input.commandKind || !input.commandData) throw new Error('commandKind and commandData are required');
    const msgId = commandMsgId(input.commandKind);
    commandType = input.commandKind;
    payload = buildCommandPayload({
      msgId,
      gatewayMac: resolved.gatewayMac,
      tagMac: resolved.tagUid,
      kind: input.commandKind,
      data: input.commandData as any
    });
  }

  const timeoutMs = input.timeoutMs ?? env.TAG_CONTROL_DEFAULT_TIMEOUT_MS;
  const dedupKey = dedupKeyOf(input, resolved.gatewayMac, commandType);
  const existing = await findRecentByDedupKey(dedupKey, env.TAG_CONTROL_DEDUP_WINDOW_MS);
  if (existing) return existing;

  const cmd = await createTagCommand({
    workerId: resolved.workerId,
    tagId: resolved.tagId,
    gatewayId: resolved.gatewayId,
    commandType,
    templateCode: input.templateCode,
    triggerSource: input.triggerSource,
    triggerReason: input.triggerReason,
    msgId: Number(payload.msg_id),
    topic: toTopic(resolved.gatewayMac),
    payload,
    timeoutMs,
    dedupKey
  });

  for (let attempt = 1; attempt <= env.TAG_CONTROL_MAX_RETRIES + 1; attempt++) {
    const createdAttempt = await createAttempt(cmd.id, attempt, cmd.topic, payload);

    try {
      await mqttPublish(cmd.topic, payload);
      await updateCommandStatus(cmd.id, 'sent', { sent: true, retriesCount: attempt - 1 });
      const result = env.TAG_CONTROL_REQUIRE_REPLY ? await waitForCompletion(cmd.id, timeoutMs) : 'ack_ok';
      if (result === 'ack_ok') {
        await appendAuditLog({ actorType: 'system', action: 'tag_command_sent_ok', entityType: 'tag_command', entityId: cmd.id, payload: { attempt, commandType, gatewayMac: resolved.gatewayMac, tagUid: resolved.tagUid } });
        return await getCommand(cmd.id);
      }
      if (result === 'ack_error') {
        return await getCommand(cmd.id);
      }

      await updateCommandStatus(cmd.id, 'timeout', { retriesCount: attempt, lastError: 'ack timeout' });
      if (attempt > env.TAG_CONTROL_MAX_RETRIES) {
        await updateCommandStatus(cmd.id, 'failed', { completed: true, retriesCount: attempt, lastError: 'max retries exhausted' });
      }
    } catch (error: any) {
      await updateCommandStatus(cmd.id, 'failed', { completed: true, retriesCount: attempt, lastError: String(error?.message ?? error) });
      throw error;
    } finally {
      const latest = await getCommand(cmd.id);
      const status = latest?.status ?? 'failed';
      await markAttemptResult(createdAttempt.id, status, latest?.last_error ?? undefined);
    }
  }

  return await getCommand(cmd.id);
}

export async function sendPreLimitAlert(args: { workerId?: string; tagId?: string; tagUid?: string; reason?: string }) {
  return sendTagCommand({ ...args, templateCode: 'pre_limit', triggerSource: 'compliance', triggerReason: args.reason ?? 'T+40 pre-limit alert' });
}

export async function sendCriticalExposureAlert(args: { workerId?: string; tagId?: string; tagUid?: string; reason?: string }) {
  return sendTagCommand({ ...args, templateCode: 'critical', triggerSource: 'compliance', triggerReason: args.reason ?? 'T+45 critical exposure' });
}

export async function sendEarlyReentryBlockedAlert(args: { workerId?: string; tagId?: string; tagUid?: string; reason?: string }) {
  return sendTagCommand({ ...args, templateCode: 'early_reentry_blocked', triggerSource: 'compliance', triggerReason: args.reason ?? 'Early reentry blocked' });
}

export async function sendManDownAlert(args: { workerId?: string; tagId?: string; tagUid?: string; reason?: string }) {
  return sendTagCommand({ ...args, templateCode: 'man_down', triggerSource: 'compliance', triggerReason: args.reason ?? 'Man down alert' });
}

export { listCommands, getCommand, listActiveCommands, listTemplates, createTemplate, updateTemplate };
