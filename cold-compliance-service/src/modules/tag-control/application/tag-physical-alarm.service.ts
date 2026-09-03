import { env } from '../../../config/env';
import { ResolvedTargetCandidate, resolveTagTargets } from '../infrastructure/tag-control.repository';
import { logger } from '../../../utils/logger';
import { sleep } from '../../../utils/sleep';
import { isBleSessionActive, markBleSessionActive, markBleSessionDisconnected } from '../infrastructure/ble-session.repository';
import { db } from '../../../db/pool';
import { executeHardwareB5Command } from '../../hardware-manager/hardware-command.client';

export type PhysicalAlarmAction = 'led' | 'buzzer' | 'vibration';

const activeTagAlarms = new Set<string>();
const DEFAULT_FOLLOWUP_DELAY_MS = 45000;
const DEFAULT_ACTION_DURATION_MS = 3000;
const MIN_ACTION_DURATION_MS = 100;
const MAX_ACTION_DURATION_MS = 60000;

interface PhysicalAlarmSettings {
  followupDelayMs: number;
  buzzerDurationMs: number;
  vibrationDurationMs: number;
}

function normalizeActionDurationMs(value: unknown): number {
  const raw = Number(value ?? DEFAULT_ACTION_DURATION_MS);
  return Number.isInteger(raw) && raw >= MIN_ACTION_DURATION_MS && raw <= MAX_ACTION_DURATION_MS ? raw : DEFAULT_ACTION_DURATION_MS;
}

async function resolvePhysicalAlarmSettings(tagId: string): Promise<PhysicalAlarmSettings> {
  const result = await db.query<{
    physical_alarm_followup_delay_ms: number;
    physical_alarm_buzzer_duration_ms: number;
    physical_alarm_vibration_duration_ms: number;
  }>(
    `SELECT physical_alarm_followup_delay_ms, physical_alarm_buzzer_duration_ms, physical_alarm_vibration_duration_ms FROM tags WHERE id = $1`,
    [tagId]
  );
  const row = result.rows[0];
  const rawFollowupDelayMs = Number(row?.physical_alarm_followup_delay_ms ?? DEFAULT_FOLLOWUP_DELAY_MS);
  return {
    followupDelayMs: Number.isFinite(rawFollowupDelayMs) && rawFollowupDelayMs >= 0 ? rawFollowupDelayMs : DEFAULT_FOLLOWUP_DELAY_MS,
    buzzerDurationMs: normalizeActionDurationMs(row?.physical_alarm_buzzer_duration_ms),
    vibrationDurationMs: normalizeActionDurationMs(row?.physical_alarm_vibration_duration_ms)
  };
}

type CentralTarget = Pick<ResolvedTargetCandidate, 'gatewayMac' | 'tagUid' | 'hardwareGatewayId' | 'hardwareDeviceId'>;

export async function connectTagSession(
  params: CentralTarget,
  deps?: { execute?: typeof executeHardwareB5Command; wait?: typeof sleep }
): Promise<void> {
  const maxAttempts = Math.max(1, env.TAG_ALARM_CONNECT_MAX_RETRIES + 1);
  const execute = deps?.execute ?? executeHardwareB5Command;
  const wait = deps?.wait ?? sleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt }, 'connect requested');
      await execute({ ...params, command: 'connect' });
      logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt }, 'connect ack');
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      logger.warn({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt, error }, 'connect failed, retrying');
      await wait(500);
    }
  }
}

export async function sendLedAlert(params: CentralTarget): Promise<void> {
  await executeHardwareB5Command({ ...params, command: 'led' });
}

export async function sendBuzzerAlert(params: CentralTarget & { durationMs: number }): Promise<void> {
  await executeHardwareB5Command({ ...params, command: 'buzzer' });
}

export async function sendVibrationAlert(params: CentralTarget & { durationMs: number }): Promise<void> {
  await executeHardwareB5Command({ ...params, command: 'vibration' });
}

export async function disconnectTagSession(params: CentralTarget): Promise<void> {
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'disconnect requested');
  await executeHardwareB5Command({ ...params, command: 'disconnect' });
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'disconnect ack');
}


export interface ConnectedTagCommandResult {
  status: 'success' | 'failed_no_gateway_connected' | 'failed_action';
  selectedGatewayMac?: string;
  connectFailures: Array<{ gatewayMac: string; error: string }>;
}

export async function executeConnectedTagCommandSequence(params: {
  tagId: string;
  tagUid: string;
  candidates: ResolvedTargetCandidate[];
  context?: Record<string, unknown>;
  runActions: (target: ResolvedTargetCandidate) => Promise<void>;
  deps?: {
    connect?: typeof connectTagSession;
    disconnect?: typeof disconnectTagSession;
    markActive?: typeof markBleSessionActive;
    markDisconnected?: typeof markBleSessionDisconnected;
  };
}): Promise<ConnectedTagCommandResult> {
  const connectFailures: Array<{ gatewayMac: string; error: string }> = [];
  const deps = {
    connect: params.deps?.connect ?? connectTagSession,
    disconnect: params.deps?.disconnect ?? disconnectTagSession,
    markActive: params.deps?.markActive ?? markBleSessionActive,
    markDisconnected: params.deps?.markDisconnected ?? markBleSessionDisconnected
  };

  for (const candidate of params.candidates) {
    logger.info({ ...params.context, gatewayMac: candidate.gatewayMac, tagUid: params.tagUid, lastSeenAt: candidate.lastSeenAt, rssi: candidate.rssi, sameColdRoom: candidate.sameColdRoom }, 'trying gateway');
    try {
      await deps.connect({ ...candidate, tagUid: params.tagUid });
      logger.info({ ...params.context, gatewayMac: candidate.gatewayMac, tagUid: params.tagUid }, 'connect success');
      logger.info({ ...params.context, selectedGatewayMac: candidate.gatewayMac, tagUid: params.tagUid }, 'selected gateway');
    } catch (error: any) {
      const message = String(error?.message ?? error);
      connectFailures.push({ gatewayMac: candidate.gatewayMac, error: message });
      logger.warn({ ...params.context, gatewayMac: candidate.gatewayMac, tagUid: params.tagUid, error: message }, 'connect failed');
      continue;
    }

    await deps.markActive({
      tagId: params.tagId,
      hardwareDeviceId: candidate.hardwareDeviceId,
      tagUid: params.tagUid,
      gatewayMac: candidate.gatewayMac
    });
    logger.info({ ...params.context, tagId: params.tagId, gatewayMac: candidate.gatewayMac }, 'mark tag as BLE-active');

    let disconnectAck = false;
    let disconnectError: string | undefined;
    try {
      await params.runActions(candidate);
      return { status: 'success', selectedGatewayMac: candidate.gatewayMac, connectFailures };
    } catch (error) {
      logger.error({ ...params.context, error, tagId: params.tagId, gatewayMac: candidate.gatewayMac }, 'connected tag command sequence action failed');
      throw error;
    } finally {
      try {
        await deps.disconnect({ ...candidate, tagUid: params.tagUid });
        disconnectAck = true;
        logger.info({ ...params.context, gatewayMac: candidate.gatewayMac, tagUid: params.tagUid }, 'disconnect success');
      } catch (error) {
        disconnectError = String((error as any)?.message ?? error);
        logger.error({ ...params.context, error, tagId: params.tagId, gatewayMac: candidate.gatewayMac }, 'disconnect failed; closing internal BLE lease without physical confirmation');
      }

      await deps.markDisconnected({
        tagId: params.tagId,
        ...(Number.isInteger(candidate.hardwareDeviceId) ? { hardwareDeviceId: candidate.hardwareDeviceId } : {}),
        confirmed: disconnectAck,
        error: disconnectError
      });
      logger.info({ ...params.context, tagId: params.tagId, gatewayMac: candidate.gatewayMac, disconnectAck }, 'closed internal BLE session');

      logger.info({ ...params.context, disconnectAck, selectedGatewayMac: candidate.gatewayMac }, 'connected tag command sequence finished');
    }
  }

  logger.error({ ...params.context, tagId: params.tagId, tagUid: params.tagUid, failures: connectFailures, status: 'failed_no_gateway_connected' }, 'failed_no_gateway_connected');
  return { status: 'failed_no_gateway_connected', connectFailures };
}

function resolveAlarmActions(alert: { severity: string; alertType: string }): PhysicalAlarmAction[] {
  if (alert.alertType === 'low_battery') return ['led'];
  if (alert.severity === 'critical' || alert.severity === 'warning') return ['buzzer', 'vibration'];
  return ['led'];
}

export async function executeAlarmSequence(params: {
  workerId?: string;
  tagId?: string;
  hardwareDeviceId?: number;
  tagUid?: string;
  gatewayMac?: string;
  severity: string;
  alertType: string;
  alertId: string;
}): Promise<void> {
  if (!env.TAG_ALARM_PHYSICAL_ENABLED) return;

  const actions = resolveAlarmActions({ severity: params.severity, alertType: params.alertType });
  if (!actions.length) return;

  const candidates = await resolveTagTargets({
    workerId: params.workerId,
    tagId: params.tagId,
    hardwareDeviceId: params.hardwareDeviceId,
    tagUid: params.tagUid,
    gatewayMac: params.gatewayMac,
    strategy: env.TAG_CONTROL_GATEWAY_STRATEGY
  });

  if (!candidates.length) throw new Error('unable to resolve gateway/tag target');
  const target = candidates[0];

  if (activeTagAlarms.has(target.tagId)) {
    logger.info({ alertId: params.alertId, tagId: target.tagId }, 'skipped duplicate physical alarm (tag already running)');
    return;
  }

  const bleActive = await isBleSessionActive({ tagId: target.tagId, hardwareDeviceId: target.hardwareDeviceId });
  if (bleActive) {
    logger.info({ alertId: params.alertId, tagId: target.tagId }, 'skipped duplicate physical alarm (BLE session already active)');
    return;
  }

  activeTagAlarms.add(target.tagId);
  try {
    const alarmSettings = await resolvePhysicalAlarmSettings(target.tagId);
    logger.info({ alertId: params.alertId, tagId: target.tagId, tagUid: target.tagUid, candidateGateways: candidates.map((candidate) => ({ gatewayMac: candidate.gatewayMac, lastSeenAt: candidate.lastSeenAt, rssi: candidate.rssi, sameColdRoom: candidate.sameColdRoom })), actions, ...alarmSettings }, 'starting physical alarm sequence');

    const result = await executeConnectedTagCommandSequence({
      tagId: target.tagId,
      tagUid: target.tagUid,
      candidates,
      context: { alertId: params.alertId, actions },
      runActions: async (selectedTarget) => {
        if (env.TAG_ALARM_POST_CONNECT_DELAY_MS > 0) {
          logger.info({ alertId: params.alertId, delayMs: env.TAG_ALARM_POST_CONNECT_DELAY_MS, gatewayMac: selectedTarget.gatewayMac }, 'waiting after connect ack before first action');
          await sleep(env.TAG_ALARM_POST_CONNECT_DELAY_MS);
        }

        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          if (action === 'led') {
            await sendLedAlert({ ...selectedTarget, tagUid: target.tagUid });
            logger.info({ alertId: params.alertId, gatewayMac: selectedTarget.gatewayMac, step: i + 1, total: actions.length, actions }, 'led success');
          }
          if (action === 'buzzer') {
            await sendBuzzerAlert({ ...selectedTarget, tagUid: target.tagUid, durationMs: alarmSettings.buzzerDurationMs });
            logger.info({ alertId: params.alertId, gatewayMac: selectedTarget.gatewayMac, step: i + 1, total: actions.length, actions, durationMs: alarmSettings.buzzerDurationMs }, 'buzzer success');
          }
          if (action === 'vibration') {
            await sendVibrationAlert({ ...selectedTarget, tagUid: target.tagUid, durationMs: alarmSettings.vibrationDurationMs });
            logger.info({ alertId: params.alertId, gatewayMac: selectedTarget.gatewayMac, step: i + 1, total: actions.length, actions, durationMs: alarmSettings.vibrationDurationMs }, 'vibration success');
          }

          if (i < actions.length - 1) {
            const delayMs = i === 0 ? alarmSettings.followupDelayMs : env.TAG_ALARM_BETWEEN_ACTION_DELAY_MS;
            if (delayMs > 0) {
              logger.info({ alertId: params.alertId, delayMs, between: `${actions[i]}->${actions[i + 1]}`, gatewayMac: selectedTarget.gatewayMac }, 'waiting before next action');
              await sleep(delayMs);
            }
          }
        }
      }
    });

    if (result.status === 'failed_no_gateway_connected') {
      throw new Error('failed_no_gateway_connected');
    }
  } finally {
    activeTagAlarms.delete(target.tagId);
  }
}
