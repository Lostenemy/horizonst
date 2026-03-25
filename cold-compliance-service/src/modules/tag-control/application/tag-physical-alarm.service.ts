import { env } from '../../../config/env';
import { mqttPublish } from '../../mqtt/mqtt.service';
import { resolveTagTarget } from '../infrastructure/tag-control.repository';
import { waitForGatewayReply } from '../infrastructure/gateway-reply-listener';
import { logger } from '../../../utils/logger';
import { sleep } from '../../../utils/sleep';

export type PhysicalAlarmAction = 'led' | 'buzzer' | 'vibration';

const COMMANDS: Record<PhysicalAlarmAction | 'connect' | 'disconnect', { msgId: number; ackMsgId: number }> = {
  connect: { msgId: 1150, ackMsgId: 3151 },
  led: { msgId: 1158, ackMsgId: 3159 },
  buzzer: { msgId: 1160, ackMsgId: 3161 },
  vibration: { msgId: 1169, ackMsgId: 3170 },
  disconnect: { msgId: 1200, ackMsgId: 3201 }
};

function toTopic(gatewayMac: string): string {
  return env.MQTT_COMMAND_TOPIC_TEMPLATE.replace('{gatewayMac}', gatewayMac.toLowerCase());
}

async function publishAndWaitAck(params: {
  gatewayMac: string;
  tagUid: string;
  command: 'connect' | 'disconnect' | PhysicalAlarmAction;
  data: Record<string, unknown>;
  timeoutMs: number;
}): Promise<void> {
  const commandDef = COMMANDS[params.command];
  const payload = {
    msg_id: commandDef.msgId,
    device_info: { mac: params.gatewayMac.toUpperCase() },
    data: { mac: params.tagUid.toUpperCase(), ...params.data }
  };
  await mqttPublish(toTopic(params.gatewayMac), payload);
  const ack = await waitForGatewayReply({ gatewayMac: params.gatewayMac, msgId: commandDef.ackMsgId, timeoutMs: params.timeoutMs });
  if (ack.resultCode !== 0) {
    throw new Error(`command ${params.command} failed result_code=${ack.resultCode} result_msg=${ack.resultMsg ?? '-'}`);
  }
}

export async function connectTagSession(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  const maxAttempts = Math.max(1, env.TAG_ALARM_CONNECT_MAX_RETRIES + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt }, 'tag alarm connect requested');
      await publishAndWaitAck({
        gatewayMac: params.gatewayMac,
        tagUid: params.tagUid,
        command: 'connect',
        data: { passwd: env.TAG_SESSION_PASSWORD },
        timeoutMs: env.TAG_ALARM_CONNECT_TIMEOUT_MS
      });
      logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt }, 'tag alarm connect confirmed');
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      logger.warn({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt, error }, 'tag alarm connect failed, retrying');
      await sleep(500);
    }
  }
}

export async function sendLedAlert(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'sending LED alert action');
  await publishAndWaitAck({
    gatewayMac: params.gatewayMac,
    tagUid: params.tagUid,
    command: 'led',
    data: { flash_time: 100, flash_interval: 10 },
    timeoutMs: env.TAG_ALARM_ACTION_TIMEOUT_MS
  });
}

export async function sendBuzzerAlert(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'sending buzzer alert action');
  await publishAndWaitAck({
    gatewayMac: params.gatewayMac,
    tagUid: params.tagUid,
    command: 'buzzer',
    data: { ring_time: 100, ring_interval: 10 },
    timeoutMs: env.TAG_ALARM_ACTION_TIMEOUT_MS
  });
}

export async function sendVibrationAlert(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'sending vibration alert action');
  await publishAndWaitAck({
    gatewayMac: params.gatewayMac,
    tagUid: params.tagUid,
    command: 'vibration',
    data: { shake_time: 100, shake_interval: 10 },
    timeoutMs: env.TAG_ALARM_ACTION_TIMEOUT_MS
  });
}

export async function disconnectTagSession(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'sending tag disconnect action');
  await publishAndWaitAck({
    gatewayMac: params.gatewayMac,
    tagUid: params.tagUid,
    command: 'disconnect',
    data: {},
    timeoutMs: env.TAG_ALARM_ACTION_TIMEOUT_MS
  });
}

function resolveAlarmActions(alert: { severity: string; alertType: string }): PhysicalAlarmAction[] {
  if (alert.alertType === 'low_battery') return ['led'];
  if (alert.severity === 'critical') return ['buzzer', 'vibration'];
  if (alert.severity === 'warning') return ['vibration'];
  return ['led'];
}

export async function executeAlarmSequence(params: {
  workerId?: string;
  tagId?: string;
  tagUid?: string;
  gatewayMac?: string;
  severity: string;
  alertType: string;
  alertId: string;
}): Promise<void> {
  if (!env.TAG_ALARM_PHYSICAL_ENABLED) return;

  const actions = resolveAlarmActions({ severity: params.severity, alertType: params.alertType });
  if (!actions.length) return;

  const target = await resolveTagTarget({
    workerId: params.workerId,
    tagId: params.tagId,
    tagUid: params.tagUid,
    gatewayMac: params.gatewayMac,
    strategy: env.TAG_CONTROL_GATEWAY_STRATEGY
  });

  logger.info({ alertId: params.alertId, gatewayMac: target.gatewayMac, tagUid: target.tagUid, actions }, 'starting physical alarm sequence');

  await connectTagSession({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });

  try {
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action === 'led') await sendLedAlert({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
      if (action === 'buzzer') await sendBuzzerAlert({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
      if (action === 'vibration') await sendVibrationAlert({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
      logger.info({ alertId: params.alertId, action, step: i + 1, total: actions.length }, 'physical alarm action confirmed');
    }

    if (actions.length === 2) {
      logger.info({ alertId: params.alertId, waitMs: env.TAG_ALARM_DUAL_ACTION_WAIT_MS }, 'waiting before disconnect after dual action');
      await sleep(env.TAG_ALARM_DUAL_ACTION_WAIT_MS);
    }
  } finally {
    await disconnectTagSession({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
    logger.info({ alertId: params.alertId }, 'physical alarm sequence finished');
  }
}
