import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { normalizeGatewayMac } from '../utils/mac';
import { publishMqttJson } from './mqttService';
import { HardwareGatewayAck, waitForHardwareGatewayAck } from './gatewayAck';
import { redactHardwarePayload } from './hardwarePayloadRedaction';

export interface GatewayCommandPayload extends Record<string, unknown> {
  msg_id: number;
  device_info: { mac: string };
  data: Record<string, string | number>;
}

export type PhysicalB5Command = 'connect' | 'led' | 'buzzer' | 'vibration' | 'disconnect';

const PHYSICAL_B5_COMMANDS: Record<PhysicalB5Command, number> = {
  connect: 1150,
  led: 1158,
  buzzer: 1160,
  vibration: 1169,
  disconnect: 1200
};

export interface GatewayCommandActor {
  type: 'user' | 'service' | 'system';
  userId?: number;
  serviceId?: string;
  code?: string;
}

export interface GatewayCommandResult {
  commandId: string;
  msgId: number;
  status: 'success' | 'error' | 'timeout' | 'ambiguous';
  resultCode?: number;
  resultMessage?: string;
  ackMsgId?: number;
  ackAmbiguous?: boolean;
  connectionState?: 'established' | 'rejected' | 'timed_out';
  connectionReportMsgId?: number;
}

export class GatewayCommandBusyError extends Error {}

export async function expireStaleGatewayCommands(gatewayId?: number): Promise<number> {
  const values: unknown[] = [];
  let predicate = '';
  if (gatewayId !== undefined) {
    values.push(gatewayId);
    predicate = ` AND gateway_id = $${values.length}`;
  }
  const result = await pool.query(
    `UPDATE hardware_gateway_commands
     SET status = 'timed_out',
         result_message = COALESCE(result_message, 'command timeout recovered by journal sweep')
     WHERE status IN ('pending', 'published')
       AND COALESCE(sent_at, created_at) + (timeout_ms * INTERVAL '1 millisecond') < NOW()
       ${predicate}`,
    values
  );
  return result.rowCount ?? 0;
}

export function startGatewayCommandTimeoutSweep(): NodeJS.Timeout {
  const parsed = Number(process.env.GATEWAY_COMMAND_SWEEP_INTERVAL_MS ?? 5000);
  const intervalMs = Number.isFinite(parsed) ? Math.max(1000, Math.floor(parsed)) : 5000;
  const timer = setInterval(() => {
    void expireStaleGatewayCommands().catch((error) => {
      console.error('Failed to expire stale gateway commands', error);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}

export function buildB5GatewayCommands(gatewayMacInput: string): GatewayCommandPayload[] {
  const normalized = normalizeGatewayMac(gatewayMacInput);
  if (!normalized) throw new Error('Invalid gateway MAC');
  const deviceInfo = { mac: normalized.toUpperCase() };
  return [
    {
      msg_id: 1045,
      device_info: deviceInfo,
      data: {
        ibeacon: 0,
        eddystone_uid: 0,
        eddystone_url: 0,
        eddystone_tlm: 0,
        bxp_devinfo: 0,
        bxp_acc: 0,
        bxp_th: 0,
        bxp_button: 1,
        bxp_tag: 0,
        pir: 0,
        other: 0,
        mk_tof: 0,
        nano_beacon_info: 0
      }
    },
    {
      msg_id: 1053,
      device_info: deviceInfo,
      data: {
        switch_value: 1,
        single_press: 0,
        double_press: 1,
        long_press: 0,
        abnormal_inactivity: 0
      }
    },
    {
      msg_id: 1059,
      device_info: deviceInfo,
      data: { timestamp: 1, adv_data: 1, parse_adv_data: 1 }
    },
    {
      msg_id: 1063,
      device_info: deviceInfo,
      data: { interval: 0 }
    }
  ];
}

export function buildRssiGatewayCommand(gatewayMacInput: string, rssi: number): GatewayCommandPayload {
  const normalized = normalizeGatewayMac(gatewayMacInput);
  if (!normalized || !Number.isInteger(rssi) || rssi < -127 || rssi > 0) {
    throw new Error('Invalid RSSI gateway command');
  }
  return {
    msg_id: 1042,
    device_info: { mac: normalized.toUpperCase() },
    data: { rssi }
  };
}

export function durationMsToGatewaySeconds(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Invalid B5 action duration');
  return Math.max(1, Math.ceil(durationMs / 1000));
}

export function buildPhysicalB5Command(params: {
  command: PhysicalB5Command;
  gatewayMac: string;
  deviceMac: string;
  durationMs?: number;
  sessionPassword?: string;
}): GatewayCommandPayload {
  const gatewayMac = normalizeGatewayMac(params.gatewayMac);
  const deviceMac = normalizeGatewayMac(params.deviceMac);
  if (!gatewayMac || !deviceMac) throw new Error('Invalid physical B5 command MAC');
  const baseData = { mac: deviceMac.toUpperCase() };
  let data: GatewayCommandPayload['data'];
  switch (params.command) {
    case 'connect':
      if (!params.sessionPassword) throw new Error('B5 session password is not configured');
      data = { ...baseData, passwd: params.sessionPassword };
      break;
    case 'led':
      data = { ...baseData, flash_time: 100, flash_interval: 10 };
      break;
    case 'buzzer':
      data = { ...baseData, ring_time: durationMsToGatewaySeconds(params.durationMs ?? 0), ring_interval: 10 };
      break;
    case 'vibration':
      data = { ...baseData, shake_time: durationMsToGatewaySeconds(params.durationMs ?? 0), shake_interval: 10 };
      break;
    case 'disconnect':
      data = baseData;
      break;
  }
  return {
    msg_id: PHYSICAL_B5_COMMANDS[params.command],
    device_info: { mac: gatewayMac.toUpperCase() },
    data
  };
}

const commandTopic = (gatewayMac: string): string => `gw/${gatewayMac}/subscribe`;
const AMBIGUOUS_ACK_MESSAGE = 'ACK correlation ambiguous after previous timeout for this gateway and msg_id';

async function executeCommand(params: {
  gatewayId: number;
  companyId: string;
  gatewayMac: string;
  commandType: string;
  command: GatewayCommandPayload;
  actor: GatewayCommandActor;
  requestId?: string;
  timeoutMs: number;
  idempotencyKey?: string;
  journalPayload?: GatewayCommandPayload;
  ackMsgIds?: number[];
  onAck?: (ack: HardwareGatewayAck) => void;
  deps?: {
    publish?: typeof publishMqttJson;
    waitForAck?: typeof waitForHardwareGatewayAck;
  };
}): Promise<GatewayCommandResult> {
  const gatewayMac = normalizeGatewayMac(params.gatewayMac);
  if (!gatewayMac) throw new Error('Invalid gateway MAC');
  // El firmware no ofrece identificador por solicitud: tras un timeout, un ACK tardío
  // puede corresponder a cualquiera de los siguientes comandos del mismo tipo.
  const priorTimeout = await pool.query<{ ambiguous: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM hardware_gateway_commands
       WHERE gateway_id = $1 AND msg_id = $2
         AND (status = 'timed_out' OR connection_state = 'timed_out')
     ) AS ambiguous`,
    [params.gatewayId, params.command.msg_id]
  );
  const ambiguousCorrelation = priorTimeout.rows[0]?.ambiguous === true;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO hardware_gateway_commands
       (gateway_id, company_id, msg_id, command_type, payload, actor_type, actor_user_id,
        actor_service_id, actor_code, request_id, idempotency_key, timeout_ms)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      params.gatewayId,
      params.companyId,
      params.command.msg_id,
      params.commandType,
      JSON.stringify(redactHardwarePayload(params.journalPayload ?? params.command)),
      params.actor.type,
      params.actor.userId ?? null,
      params.actor.serviceId ?? null,
      params.actor.code ?? null,
      params.requestId ?? null,
      params.idempotencyKey ?? null,
      params.timeoutMs
    ]
  );
  const commandId = inserted.rows[0].id;
  const waitForAck = params.deps?.waitForAck ?? waitForHardwareGatewayAck;
  const publish = params.deps?.publish ?? publishMqttJson;
  const ackPromise = waitForAck({
    gatewayMac,
    msgIds: params.ackMsgIds ?? [params.command.msg_id, params.command.msg_id + 2000, params.command.msg_id + 2001],
    timeoutMs: params.timeoutMs
  });
  void ackPromise.catch(() => undefined);
  let published = false;

  try {
    await publish(commandTopic(gatewayMac), params.command);
    published = true;
    await pool.query(
      `UPDATE hardware_gateway_commands SET status = 'published', sent_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [commandId]
    );
    const ack: HardwareGatewayAck = await ackPromise;
    params.onAck?.(ack);
    const status = ack.resultCode !== 0 ? 'error' : ambiguousCorrelation ? 'ambiguous' : 'success';
    const resultMessage = status === 'ambiguous' ? AMBIGUOUS_ACK_MESSAGE : ack.resultMessage;
    await pool.query(
      `UPDATE hardware_gateway_commands
       SET status = $2, ack_at = COALESCE(ack_at, NOW()), ack_msg_id = $3,
           result_code = $4, result_message = $5, response_payload = $6::jsonb
       WHERE id = $1`,
      [commandId, status === 'success' ? 'ack_success' : status === 'ambiguous' ? 'ack_ambiguous' : 'ack_error', ack.msgId,
       ack.resultCode, resultMessage ?? null, JSON.stringify(redactHardwarePayload(ack.payload))]
    );
    return {
      commandId,
      msgId: params.command.msg_id,
      status,
      resultCode: ack.resultCode,
      resultMessage,
      ackMsgId: ack.msgId,
      ...(status === 'ambiguous' ? { ackAmbiguous: true } : {})
    };
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const timedOut = published && message.includes('timeout waiting gateway reply');
    await pool.query(
      `UPDATE hardware_gateway_commands
       SET status = $2, result_message = $3
       WHERE id = $1 AND status IN ('pending', 'published')`,
      [commandId, timedOut ? 'timed_out' : 'publish_error', message]
    );
    return {
      commandId,
      msgId: params.command.msg_id,
      status: timedOut ? 'timeout' : 'error',
      resultMessage: message
    };
  }
}

export async function executePhysicalB5Command(params: {
  gatewayId: number;
  companyId: string;
  gatewayMac: string;
  deviceMac: string;
  command: PhysicalB5Command;
  durationMs?: number;
  sessionPassword?: string;
  actor: GatewayCommandActor;
  requestId?: string;
  timeoutMs: number;
  deps?: Parameters<typeof executeCommand>[0]['deps'];
}): Promise<GatewayCommandResult> {
  const lockClient = await pool.connect();
  const completionController = new AbortController();
  try {
    await expireStaleGatewayCommands(params.gatewayId);
    await acquireGatewayLock(lockClient, params.gatewayId);
    const command = buildPhysicalB5Command(params);
    const journalPayload = params.command === 'connect'
      ? { ...command, data: { mac: command.data.mac } }
      : command;
    // 1150 confirma aceptación; 3151 es la notificación asíncrona de conexión.
    const completionPromise = params.command === 'connect'
      ? (params.deps?.waitForAck ?? waitForHardwareGatewayAck)({
          gatewayMac: normalizeGatewayMac(params.gatewayMac)!, msgIds: [3151],
          timeoutMs: params.timeoutMs, signal: completionController.signal
        })
      : null;
    void completionPromise?.catch(() => undefined);
    let acceptanceSequence: number | undefined;
    const result = await executeCommand({
      gatewayId: params.gatewayId,
      companyId: params.companyId,
      gatewayMac: params.gatewayMac,
      commandType: `b5_physical_${params.command}`,
      command,
      journalPayload,
      actor: params.actor,
      requestId: params.requestId,
      timeoutMs: params.timeoutMs,
      idempotencyKey: params.requestId ? `${params.requestId}:${command.msg_id}` : undefined,
      ...(params.command === 'connect' ? { ackMsgIds: [1150] } : {}),
      onAck: (ack) => { acceptanceSequence = ack.receivedSequence; },
      deps: params.deps
    });
    if (!completionPromise || (result.status !== 'success' && result.status !== 'ambiguous')) return result;
    await pool.query(`UPDATE hardware_gateway_commands SET connection_state = 'awaiting_report' WHERE id = $1`, [result.commandId]);
    try {
      const report = await completionPromise;
      const reportData = report.payload.data;
      const reportedTagMac = reportData && typeof reportData === 'object'
        ? (reportData as Record<string, unknown>).mac : undefined;
      const reportValid = report.msgId === 3151
        && normalizeGatewayMac(report.gatewayMac) === normalizeGatewayMac(params.gatewayMac)
        && report.resultCode === 0
        && report.resultMessage?.trim().toLowerCase() === 'connect succeed'
        && (acceptanceSequence === undefined || report.receivedSequence === undefined
          || report.receivedSequence > acceptanceSequence)
        && (reportedTagMac === undefined || normalizeGatewayMac(reportedTagMac) === normalizeGatewayMac(params.deviceMac));
      await pool.query(
        `UPDATE hardware_gateway_commands SET connection_state = $2, connection_report_at = NOW() WHERE id = $1`,
        [result.commandId, reportValid ? 'established' : 'rejected']
      );
      return reportValid
        ? { ...result, connectionState: 'established', connectionReportMsgId: 3151 }
        : { ...result, status: 'error', resultCode: report.resultCode,
            resultMessage: 'B5 connection was not confirmed by a matching 3151 Connect succeed report',
            connectionState: 'rejected', connectionReportMsgId: report.msgId };
    } catch {
      await pool.query(`UPDATE hardware_gateway_commands SET connection_state = 'timed_out' WHERE id = $1`, [result.commandId]);
      return { ...result, status: 'timeout', resultMessage: 'timeout waiting B5 connection report 3151', connectionState: 'timed_out' };
    }
  } finally {
    completionController.abort();
    try { await releaseGatewayLock(lockClient, params.gatewayId); } catch { /* connection cleanup releases the lock */ }
    lockClient.release();
  }
}

async function acquireGatewayLock(client: PoolClient, gatewayId: number): Promise<void> {
  const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1, $2) AS locked', [7246, gatewayId]);
  if (!result.rows[0]?.locked) throw new GatewayCommandBusyError('Gateway already has an active command sequence');
}

async function releaseGatewayLock(client: PoolClient, gatewayId: number): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1, $2)', [7246, gatewayId]);
}

export async function configureB5Gateway(params: {
  gatewayId: number;
  companyId: string;
  gatewayMac: string;
  actor: GatewayCommandActor;
  requestId?: string;
  timeoutMs: number;
  deps?: Parameters<typeof executeCommand>[0]['deps'];
}): Promise<{ ok: boolean; commands: GatewayCommandPayload[]; results: GatewayCommandResult[] }> {
  const lockClient = await pool.connect();
  try {
    await expireStaleGatewayCommands(params.gatewayId);
    await acquireGatewayLock(lockClient, params.gatewayId);
    const commands = buildB5GatewayCommands(params.gatewayMac);
    const results: GatewayCommandResult[] = [];
    for (const command of commands) {
      results.push(await executeCommand({
        ...params,
        commandType: 'b5_emergency_config',
        command,
        idempotencyKey: params.requestId ? `${params.requestId}:${command.msg_id}` : undefined
      }));
    }
    return { ok: results.every((result) => result.status === 'success'), commands, results };
  } finally {
    try { await releaseGatewayLock(lockClient, params.gatewayId); } catch { /* connection cleanup releases the lock */ }
    lockClient.release();
  }
}

export async function configureGatewayRssi(params: {
  gatewayId: number;
  companyId: string;
  gatewayMac: string;
  rssi: number;
  actor: GatewayCommandActor;
  requestId?: string;
  timeoutMs: number;
  deps?: Parameters<typeof executeCommand>[0]['deps'];
}): Promise<GatewayCommandResult> {
  const lockClient = await pool.connect();
  try {
    await expireStaleGatewayCommands(params.gatewayId);
    await acquireGatewayLock(lockClient, params.gatewayId);
    const result = await executeCommand({
      ...params,
      commandType: 'rssi_config',
      command: buildRssiGatewayCommand(params.gatewayMac, params.rssi),
      idempotencyKey: params.requestId ? `${params.requestId}:1042` : undefined
    });
    if (result.status === 'success') {
      await pool.query('UPDATE gateways SET rssi_threshold = $2, updated_at = NOW() WHERE id = $1', [params.gatewayId, params.rssi]);
    }
    return result;
  } finally {
    try { await releaseGatewayLock(lockClient, params.gatewayId); } catch { /* connection cleanup releases the lock */ }
    lockClient.release();
  }
}

export function physicalB5HttpStatus(result: GatewayCommandResult): number {
  if (result.status === 'success') return 200;
  if (result.status === 'ambiguous' && result.resultCode === 0 && result.ackAmbiguous === true) return 202;
  return result.status === 'timeout' ? 504 : 502;
}

export async function executeManagedGatewayCommand(params: {
  gatewayId: number;
  companyId: string;
  gatewayMac: string;
  commandType: string;
  command: GatewayCommandPayload;
  actor: GatewayCommandActor;
  requestId?: string;
  timeoutMs: number;
  deps?: Parameters<typeof executeCommand>[0]['deps'];
}): Promise<GatewayCommandResult> {
  const lockClient = await pool.connect();
  try {
    await expireStaleGatewayCommands(params.gatewayId);
    await acquireGatewayLock(lockClient, params.gatewayId);
    return await executeCommand({
      ...params,
      idempotencyKey: params.requestId ? `${params.requestId}:${params.command.msg_id}` : undefined
    });
  } finally {
    try { await releaseGatewayLock(lockClient, params.gatewayId); } catch { /* connection cleanup releases the lock */ }
    lockClient.release();
  }
}
