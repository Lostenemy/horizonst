import { env } from '../../../config/env';
import { mqttPublish } from '../../mqtt/mqtt.service';
import { resolveTagTarget } from '../infrastructure/tag-control.repository';
import { waitForGatewayReplyMulti } from '../infrastructure/gateway-reply-listener';
import { logger } from '../../../utils/logger';
import { sleep } from '../../../utils/sleep';
import { markBleSessionActive, markBleSessionDisconnected } from '../infrastructure/ble-session.repository';

export type PhysicalAlarmAction = 'led' | 'buzzer' | 'vibration';

const COMMANDS: Record<PhysicalAlarmAction | 'connect' | 'disconnect', { msgId: number; ackMsgId: number }> = {
  connect: { msgId: 1150, ackMsgId: 3151 },
  led: { msgId: 1158, ackMsgId: 3159 },
  buzzer: { msgId: 1160, ackMsgId: 3161 },
  vibration: { msgId: 1169, ackMsgId: 3170 },
  disconnect: { msgId: 1200, ackMsgId: 3201 }
};

const tagAlarmLocks = new Map<string, Promise<void>>();

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

  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, command: params.command, msgId: commandDef.msgId }, 'physical alarm command requested');
  await mqttPublish(toTopic(params.gatewayMac), payload);

  const ack = await waitForGatewayReplyMulti({
    gatewayMac: params.gatewayMac,
    msgIds: [commandDef.ackMsgId, commandDef.msgId, commandDef.msgId + 2000, commandDef.msgId + 2001],
    timeoutMs: params.timeoutMs
  });

  if (ack.resultCode !== 0) {
    throw new Error(`command ${params.command} failed result_code=${ack.resultCode} result_msg=${ack.resultMsg ?? '-'}`);
  }

  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, command: params.command, ackMsgId: ack.msgId }, 'physical alarm command ack');
}

async function withTagLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = tagAlarmLocks.get(lockKey) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  tagAlarmLocks.set(lockKey, previous.then(() => current));

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tagAlarmLocks.get(lockKey) === current) {
      tagAlarmLocks.delete(lockKey);
    }
  }
}

export async function connectTagSession(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  const maxAttempts = Math.max(1, env.TAG_ALARM_CONNECT_MAX_RETRIES + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt }, 'connect requested');
      await publishAndWaitAck({
        gatewayMac: params.gatewayMac,
        tagUid: params.tagUid,
        command: 'connect',
        data: { passwd: env.TAG_SESSION_PASSWORD },
        timeoutMs: env.TAG_ALARM_CONNECT_TIMEOUT_MS
      });
      logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt }, 'connect ack');
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      logger.warn({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt, error }, 'connect failed, retrying');
      await sleep(500);
    }
  }
}

export async function sendLedAlert(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  await publishAndWaitAck({
    gatewayMac: params.gatewayMac,
    tagUid: params.tagUid,
    command: 'led',
    data: { flash_time: 100, flash_interval: 10 },
    timeoutMs: env.TAG_ALARM_ACTION_TIMEOUT_MS
  });
}

export async function sendBuzzerAlert(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  await publishAndWaitAck({
    gatewayMac: params.gatewayMac,
    tagUid: params.tagUid,
    command: 'buzzer',
    data: { ring_time: 100, ring_interval: 10 },
    timeoutMs: env.TAG_ALARM_ACTION_TIMEOUT_MS
  });
}

export async function sendVibrationAlert(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  await publishAndWaitAck({
    gatewayMac: params.gatewayMac,
    tagUid: params.tagUid,
    command: 'vibration',
    data: { shake_time: 100, shake_interval: 10 },
    timeoutMs: env.TAG_ALARM_ACTION_TIMEOUT_MS
  });
}

export async function disconnectTagSession(params: { gatewayMac: string; tagUid: string }): Promise<void> {
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'disconnect requested');
  await publishAndWaitAck({
    gatewayMac: params.gatewayMac,
    tagUid: params.tagUid,
    command: 'disconnect',
    data: {},
    timeoutMs: env.TAG_ALARM_ACTION_TIMEOUT_MS
  });
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'disconnect ack');
}

function resolveAlarmActions(alert: { severity: string; alertType: string }): PhysicalAlarmAction[] {
  if (alert.alertType === 'low_battery') return ['led'];
  if (alert.severity === 'critical' || alert.severity === 'warning') return ['buzzer', 'vibration'];
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

  const lockKey = `${target.gatewayMac.toLowerCase()}:${target.tagId}`;
  await withTagLock(lockKey, async () => {
    logger.info({ alertId: params.alertId, gatewayMac: target.gatewayMac, tagUid: target.tagUid, actions }, 'starting physical alarm sequence');

    await connectTagSession({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
    await markBleSessionActive({ tagId: target.tagId, tagUid: target.tagUid, gatewayMac: target.gatewayMac });
    logger.info({ alertId: params.alertId, tagId: target.tagId }, 'mark tag as BLE-active');

    let disconnectAck = false;
    try {
      if (env.TAG_ALARM_POST_CONNECT_DELAY_MS > 0) {
        logger.info({ alertId: params.alertId, delayMs: env.TAG_ALARM_POST_CONNECT_DELAY_MS }, 'waiting after connect ack before first action');
        await sleep(env.TAG_ALARM_POST_CONNECT_DELAY_MS);
      }

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action === 'led') {
          await sendLedAlert({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
          logger.info({ alertId: params.alertId, step: i + 1, total: actions.length, actions }, 'led ack');
        }
        if (action === 'buzzer') {
          await sendBuzzerAlert({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
          logger.info({ alertId: params.alertId, step: i + 1, total: actions.length, actions }, 'buzzer ack');
        }
        if (action === 'vibration') {
          await sendVibrationAlert({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
          logger.info({ alertId: params.alertId, step: i + 1, total: actions.length, actions }, 'shaker ack');
        }

        if (i < actions.length - 1 && env.TAG_ALARM_BETWEEN_ACTION_DELAY_MS > 0) {
          logger.info({ alertId: params.alertId, delayMs: env.TAG_ALARM_BETWEEN_ACTION_DELAY_MS }, 'waiting before next action');
          await sleep(env.TAG_ALARM_BETWEEN_ACTION_DELAY_MS);
        }
      }
    } finally {
      try {
        await disconnectTagSession({ gatewayMac: target.gatewayMac, tagUid: target.tagUid });
        disconnectAck = true;
      } catch (error) {
        logger.error({ error, alertId: params.alertId, tagId: target.tagId }, 'disconnect failed, BLE session remains active');
      }

      if (disconnectAck) {
        await markBleSessionDisconnected({ tagId: target.tagId });
        logger.info({ alertId: params.alertId, tagId: target.tagId }, 'mark tag as BLE-disconnected');
      }

      logger.info({ alertId: params.alertId, disconnectAck }, 'physical alarm sequence finished');
    }
  });
}
