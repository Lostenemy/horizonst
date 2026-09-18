import { env } from '../../../config/env';
import { ResolvedTargetCandidate, resolveTagTargets } from '../infrastructure/tag-control.repository';
import { logger } from '../../../utils/logger';
import { sleep } from '../../../utils/sleep';
import { isBleSessionActive, markBleSessionActive, markBleSessionDisconnected } from '../infrastructure/ble-session.repository';
import { db } from '../../../db/pool';
import { executeHardwareB5Command, HardwareB5CommandOutcome } from '../../hardware-manager/hardware-command.client';

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
type CommandOutcome = HardwareB5CommandOutcome | void;

export async function connectTagSession(
  params: CentralTarget,
  deps?: { execute?: (command: Parameters<typeof executeHardwareB5Command>[0]) => Promise<CommandOutcome>; wait?: typeof sleep }
): Promise<CommandOutcome> {
  const maxAttempts = Math.max(1, env.TAG_ALARM_CONNECT_MAX_RETRIES + 1);
  const execute = deps?.execute ?? executeHardwareB5Command;
  const wait = deps?.wait ?? sleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt }, 'connect requested');
      const outcome = await execute({ ...params, command: 'connect' });
      logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt, outcome: outcome ?? 'confirmed' },
        outcome === 'ambiguous' ? 'connect ACK unverified; continuing without retry' : 'connect ack');
      return outcome;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      logger.warn({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, attempt, error }, 'connect failed, retrying');
      await wait(500);
    }
  }
}

export async function sendLedAlert(params: CentralTarget): Promise<HardwareB5CommandOutcome> {
  return executeHardwareB5Command({ ...params, command: 'led' });
}

export async function sendBuzzerAlert(params: CentralTarget & { durationMs: number }): Promise<HardwareB5CommandOutcome> {
  return executeHardwareB5Command({ ...params, command: 'buzzer' });
}

export async function sendVibrationAlert(params: CentralTarget & { durationMs: number }): Promise<HardwareB5CommandOutcome> {
  return executeHardwareB5Command({ ...params, command: 'vibration' });
}

export async function disconnectTagSession(params: CentralTarget): Promise<HardwareB5CommandOutcome> {
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid }, 'disconnect requested');
  const outcome = await executeHardwareB5Command({ ...params, command: 'disconnect' });
  logger.info({ gatewayMac: params.gatewayMac, tagUid: params.tagUid, outcome }, 'disconnect reply');
  return outcome;
}


export interface ConnectedTagCommandResult {
  status: 'success' | 'attempted_unverified' | 'failed_no_gateway_connected';
  selectedGatewayMac?: string;
  connectFailures: Array<{ gatewayMac: string; error: string }>;
}

export interface PhysicalAlarmSequenceResult {
  status: 'success' | 'attempted_unverified' | 'skipped';
  selectedGatewayMac?: string;
}

export async function executeConnectedTagCommandSequence(params: {
  tagId: string;
  tagUid: string;
  candidates: ResolvedTargetCandidate[];
  context?: Record<string, unknown>;
  runActions: (target: ResolvedTargetCandidate) => Promise<CommandOutcome>;
  deps?: {
    connect?: typeof connectTagSession;
    disconnect?: (target: CentralTarget) => Promise<CommandOutcome>;
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
    let connectOutcome: CommandOutcome;
    try {
      connectOutcome = await deps.connect({ ...candidate, tagUid: params.tagUid });
      logger.info({ ...params.context, gatewayMac: candidate.gatewayMac, tagUid: params.tagUid, outcome: connectOutcome ?? 'confirmed' },
        connectOutcome === 'ambiguous' ? 'connect unverified' : 'connect success');
      logger.info({ ...params.context, selectedGatewayMac: candidate.gatewayMac, tagUid: params.tagUid }, 'selected gateway');
    } catch (error: any) {
      const message = String(error?.message ?? error);
      connectFailures.push({ gatewayMac: candidate.gatewayMac, error: message });
      logger.warn({ ...params.context, gatewayMac: candidate.gatewayMac, tagUid: params.tagUid, error: message }, 'connect failed');
      continue;
    }

    // Esta fila actúa como lease de exclusión durante el intento; un ACK ambiguo no confirma la conexión BLE.
    await deps.markActive({
      tagId: params.tagId,
      hardwareDeviceId: candidate.hardwareDeviceId,
      tagUid: params.tagUid,
      gatewayMac: candidate.gatewayMac
    });
    logger.info({ ...params.context, tagId: params.tagId, gatewayMac: candidate.gatewayMac }, 'opened internal BLE attempt lease');

    let disconnectAck = false;
    let disconnectError: string | undefined;
    let actionOutcome: CommandOutcome;
    try {
      actionOutcome = await params.runActions(candidate);
    } catch (error) {
      logger.error({ ...params.context, error, tagId: params.tagId, gatewayMac: candidate.gatewayMac }, 'connected tag command sequence action failed');
      throw error;
    } finally {
      try {
        const disconnectOutcome = await deps.disconnect({ ...candidate, tagUid: params.tagUid });
        disconnectAck = disconnectOutcome !== 'ambiguous';
        logger.info({ ...params.context, gatewayMac: candidate.gatewayMac, tagUid: params.tagUid, outcome: disconnectOutcome ?? 'confirmed' },
          disconnectAck ? 'disconnect success' : 'disconnect unverified');
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
    return {
      status: connectOutcome === 'ambiguous' || actionOutcome === 'ambiguous' || !disconnectAck
        ? 'attempted_unverified' : 'success',
      selectedGatewayMac: candidate.gatewayMac, connectFailures
    };
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
}): Promise<PhysicalAlarmSequenceResult> {
  if (!env.TAG_ALARM_PHYSICAL_ENABLED) return { status: 'skipped' };

  const actions = resolveAlarmActions({ severity: params.severity, alertType: params.alertType });
  if (!actions.length) return { status: 'skipped' };

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
    return { status: 'skipped' };
  }

  const bleActive = await isBleSessionActive({ tagId: target.tagId, hardwareDeviceId: target.hardwareDeviceId });
  if (bleActive) {
    logger.info({ alertId: params.alertId, tagId: target.tagId }, 'skipped duplicate physical alarm (BLE session already active)');
    return { status: 'skipped' };
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
        let ambiguousAction = false;
        if (env.TAG_ALARM_POST_CONNECT_DELAY_MS > 0) {
          logger.info({ alertId: params.alertId, delayMs: env.TAG_ALARM_POST_CONNECT_DELAY_MS, gatewayMac: selectedTarget.gatewayMac }, 'waiting after connect reply before first action');
          await sleep(env.TAG_ALARM_POST_CONNECT_DELAY_MS);
        }

        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          if (action === 'led') {
            const outcome = await sendLedAlert({ ...selectedTarget, tagUid: target.tagUid });
            ambiguousAction ||= outcome === 'ambiguous';
            logger.info({ alertId: params.alertId, gatewayMac: selectedTarget.gatewayMac, step: i + 1, total: actions.length, actions, outcome }, 'led reply');
          }
          if (action === 'buzzer') {
            const outcome = await sendBuzzerAlert({ ...selectedTarget, tagUid: target.tagUid, durationMs: alarmSettings.buzzerDurationMs });
            ambiguousAction ||= outcome === 'ambiguous';
            logger.info({ alertId: params.alertId, gatewayMac: selectedTarget.gatewayMac, step: i + 1, total: actions.length, actions, durationMs: alarmSettings.buzzerDurationMs, outcome }, 'buzzer reply');
          }
          if (action === 'vibration') {
            const outcome = await sendVibrationAlert({ ...selectedTarget, tagUid: target.tagUid, durationMs: alarmSettings.vibrationDurationMs });
            ambiguousAction ||= outcome === 'ambiguous';
            logger.info({ alertId: params.alertId, gatewayMac: selectedTarget.gatewayMac, step: i + 1, total: actions.length, actions, durationMs: alarmSettings.vibrationDurationMs, outcome }, 'vibration reply');
          }

          if (i < actions.length - 1) {
            const delayMs = i === 0 ? alarmSettings.followupDelayMs : env.TAG_ALARM_BETWEEN_ACTION_DELAY_MS;
            if (delayMs > 0) {
              logger.info({ alertId: params.alertId, delayMs, between: `${actions[i]}->${actions[i + 1]}`, gatewayMac: selectedTarget.gatewayMac }, 'waiting before next action');
              await sleep(delayMs);
            }
          }
        }
        return ambiguousAction ? 'ambiguous' : 'confirmed';
      }
    });

    if (result.status === 'failed_no_gateway_connected') {
      throw new Error('failed_no_gateway_connected');
    }
    if (result.status === 'attempted_unverified') {
      logger.warn({ alertId: params.alertId, tagId: target.tagId, gatewayMac: result.selectedGatewayMac },
        'physical alarm attempted; gateway ACK correlation or disconnect remains unverified');
    }
    return { status: result.status, selectedGatewayMac: result.selectedGatewayMac };
  } finally {
    activeTagAlarms.delete(target.tagId);
  }
}
