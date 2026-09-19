import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool } from '../db/pool';
import { normalizeGatewayMac } from '../utils/mac';
import { redactHardwarePayload } from './hardwarePayloadRedaction';
import { GatewayIdentityBusyError, GatewayIdentityOperationTimeoutError } from './gatewayIdentity';

type PublishMqttJson = (topic: string, payload: Record<string, unknown>) => Promise<void>;

export type GatewayConfigurationReadType =
  | 'led_state'
  | 'ble_scan_switch'
  | 'filter_relation'
  | 'duplicate_rule';

export type GatewayConfigurationData = Record<string, number>;

export interface ObservedGatewayConfiguration {
  gatewayMac: string;
  msgId: number;
  readType: GatewayConfigurationReadType;
  data: GatewayConfigurationData;
  payload: Record<string, unknown>;
}

type ReadDefinition = {
  msgId: number;
  readType: GatewayConfigurationReadType;
  ranges: Record<string, readonly [number, number]>;
};

const READ_DEFINITIONS: readonly ReadDefinition[] = [
  { msgId: 2011, readType: 'led_state', ranges: { net_led: [0, 1], sys_led: [0, 1], server_led: [0, 1] } },
  { msgId: 2040, readType: 'ble_scan_switch', ranges: { scan_switch: [0, 1] } },
  { msgId: 2041, readType: 'filter_relation', ranges: { relation: [0, 8] } },
  { msgId: 2057, readType: 'duplicate_rule', ranges: { rule: [0, 3] } }
];
const definitionByMsgId = new Map(READ_DEFINITIONS.map((item) => [item.msgId, item]));
const definitionByReadType = new Map(READ_DEFINITIONS.map((item) => [item.readType, item]));

export const GATEWAY_CONFIGURATION_READ_TYPES: readonly GatewayConfigurationReadType[] =
  READ_DEFINITIONS.map((item) => item.readType);
export const isGatewayConfigurationReadType = (value: unknown): value is GatewayConfigurationReadType => (
  typeof value === 'string' && GATEWAY_CONFIGURATION_READ_TYPES.includes(value as GatewayConfigurationReadType)
);

type WaiterState = 'waiting' | 'observing' | 'response_observed' | 'invalid_response' | 'timed_out' | 'publish_error';
type ReadObservation =
  | { kind: 'response_observed'; report: ObservedGatewayConfiguration }
  | { kind: 'invalid_response' };
type ReadWaiter = {
  readId: string;
  gatewayId: number;
  companyId: string;
  definition: ReadDefinition;
  state: WaiterState;
  deadline: number;
  resolve: (observation: ReadObservation) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
type ReportInspection =
  | { kind: 'valid'; report: ObservedGatewayConfiguration }
  | { kind: 'invalid'; topicMac: string; definition: ReadDefinition; payload: Record<string, unknown> };

const waiters = new Map<string, ReadWaiter>();
const UNCLAIMED_REPORT_TIMEOUT_MS = 10_000;

type ManagedClient = { client: PoolClient; released: boolean };
const releaseClientOnce = (managed: ManagedClient, destroy = false): void => {
  if (managed.released) return;
  managed.released = true;
  managed.client.release(destroy || undefined);
};
const untilDeadline = async <T>(operation: Promise<T>, deadline: number, stage: string, readId?: string): Promise<T> => {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new GatewayIdentityOperationTimeoutError(stage, readId);
  let timer: NodeJS.Timeout | undefined;
  const guarded = operation.then(
    (value) => ({ kind: 'value' as const, value }),
    (error) => ({ kind: 'error' as const, error })
  );
  const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), remainingMs);
  });
  const outcome = await Promise.race([guarded, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome.kind === 'timeout') throw new GatewayIdentityOperationTimeoutError(stage, readId);
  if (outcome.kind === 'error') throw outcome.error;
  return outcome.value;
};
const acquireClientUntil = async (deadline: number, stage: string, readId?: string): Promise<ManagedClient> => {
  const pending = pool.connect();
  try {
    return { client: await untilDeadline(pending, deadline, stage, readId), released: false };
  } catch (error) {
    if (error instanceof GatewayIdentityOperationTimeoutError) {
      void pending.then(
        (client) => client.release(true),
        (lateError) => console.error('Late gateway configuration database acquisition failed', lateError)
      ).catch((releaseError) => console.error('Failed to destroy late gateway configuration connection', releaseError));
    }
    throw error;
  }
};
const queryUntil = async <T extends QueryResultRow = QueryResultRow>(
  managed: ManagedClient,
  sql: string,
  params: unknown[],
  deadline: number,
  stage: string,
  readId?: string
): Promise<QueryResult<T>> => {
  try {
    return await untilDeadline(managed.client.query<T>(sql, params), deadline, stage, readId);
  } catch (error) {
    if (error instanceof GatewayIdentityOperationTimeoutError) releaseClientOnce(managed, true);
    throw error;
  }
};

const waiterKey = (gatewayMac: string, msgId: number): string => `${gatewayMac}:${msgId}`;
const removeCurrentWaiter = (key: string, waiter: ReadWaiter): void => {
  if (waiters.get(key) === waiter) waiters.delete(key);
};
const scheduleTimeout = (key: string, waiter: ReadWaiter): void => {
  clearTimeout(waiter.timer);
  waiter.timer = setTimeout(() => {
    if (!['waiting', 'observing'].includes(waiter.state) || waiters.get(key) !== waiter) return;
    waiter.state = 'timed_out';
    waiters.delete(key);
    waiter.reject(new Error('timeout waiting observed gateway configuration'));
  }, Math.max(0, waiter.deadline - Date.now()));
};

const exactIntegerData = (
  value: unknown,
  ranges: Record<string, readonly [number, number]>
): GatewayConfigurationData | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const keys = Object.keys(ranges);
  if (Object.keys(data).sort().join(',') !== [...keys].sort().join(',')) return null;
  for (const key of keys) {
    const candidate = data[key];
    const [minimum, maximum] = ranges[key];
    if (!Number.isInteger(candidate) || Number(candidate) < minimum || Number(candidate) > maximum) return null;
  }
  return Object.fromEntries(keys.map((key) => [key, Number(data[key])]));
};

const inspectGatewayConfigurationReport = (topic: string, payload: unknown): ReportInspection | null => {
  const topicMatch = topic.match(/^gw\/([0-9a-f]{12})\/publish$/i);
  if (!topicMatch || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  if ('result_code' in root) return null;
  const definition = definitionByMsgId.get(Number(root.msg_id));
  if (!definition) return null;
  const topicMac = normalizeGatewayMac(topicMatch[1]);
  if (!topicMac) return null;
  const invalid = (): ReportInspection => ({ kind: 'invalid', topicMac, definition, payload: root });
  if (Object.keys(root).sort().join(',') !== 'data,device_info,msg_id'
      || !root.device_info || typeof root.device_info !== 'object' || Array.isArray(root.device_info)
      || Object.keys(root.device_info).join(',') !== 'mac') return invalid();
  const payloadMac = normalizeGatewayMac((root.device_info as Record<string, unknown>).mac);
  if (payloadMac !== topicMac) return invalid();
  const data = exactIntegerData(root.data, definition.ranges);
  if (!data) return invalid();
  return {
    kind: 'valid',
    report: { gatewayMac: topicMac, msgId: definition.msgId, readType: definition.readType, data, payload: root }
  };
};

export function buildGatewayConfigurationReadRequest(
  gatewayMacInput: string,
  readType: GatewayConfigurationReadType
): { msg_id: number; device_info: { mac: string } } {
  const gatewayMac = normalizeGatewayMac(gatewayMacInput);
  const definition = definitionByReadType.get(readType);
  if (!gatewayMac) throw new Error('Invalid gateway MAC');
  if (!definition) throw new Error('Unsupported gateway configuration read');
  return { msg_id: definition.msgId, device_info: { mac: gatewayMac.toUpperCase() } };
}

export function parseGatewayConfigurationReport(topic: string, payload: unknown): ObservedGatewayConfiguration | null {
  const inspected = inspectGatewayConfigurationReport(topic, payload);
  return inspected?.kind === 'valid' ? inspected.report : null;
}

const persistLatestValue = async (
  managed: ManagedClient,
  report: ObservedGatewayConfiguration,
  waiter: ReadWaiter | undefined,
  deadline: number
): Promise<boolean> => {
  const gateway = await queryUntil<{ id: number; company_id: string }>(managed,
    `SELECT id, company_id FROM gateways
     WHERE active = TRUE AND company_id IS NOT NULL
       AND regexp_replace(lower(mac_address), '[^0-9a-f]', '', 'g') = $1
       AND ($2::integer IS NULL OR id = $2)
       AND ($3::uuid IS NULL OR company_id = $3)`,
    [report.gatewayMac, waiter?.gatewayId ?? null, waiter?.companyId ?? null],
    deadline, 'response_gateway_scope', waiter?.readId);
  const row = gateway.rows[0];
  if (!row) return false;
  await queryUntil(managed,
    `INSERT INTO hardware_gateway_observed_settings
       (gateway_id, company_id, read_type, msg_id, observed_value, observed_at)
     VALUES($1,$2,$3,$4,$5::jsonb,NOW())
     ON CONFLICT (gateway_id, read_type) DO UPDATE SET
       company_id = EXCLUDED.company_id, msg_id = EXCLUDED.msg_id,
       observed_value = EXCLUDED.observed_value, observed_at = EXCLUDED.observed_at`,
    [row.id, row.company_id, report.readType, report.msgId, JSON.stringify(report.data)],
    deadline, 'response_observed_value', waiter?.readId);
  return true;
};

const persistJournalResult = async (
  managed: ManagedClient,
  waiter: ReadWaiter,
  status: 'response_observed' | 'invalid_response',
  payload: Record<string, unknown>,
  deadline: number
): Promise<boolean> => {
  const result = await queryUntil(managed,
    `UPDATE hardware_gateway_reads SET status = $2, response_observed_at = NOW(),
       response_payload = $3::jsonb, error_message = $4
     WHERE id = $1 AND gateway_id = $5 AND company_id = $6 AND msg_id = $7
       AND read_type = $8 AND status IN ('pending', 'published')`,
    [waiter.readId, status, JSON.stringify(redactHardwarePayload(payload)),
      status === 'invalid_response' ? 'observed response failed strict schema validation' : null,
      waiter.gatewayId, waiter.companyId, waiter.definition.msgId, waiter.definition.readType],
    deadline, 'response_journal', waiter.readId);
  return Boolean(result.rowCount);
};

export async function handleGatewayConfigurationReport(topic: string, payloadText: string): Promise<boolean> {
  let payload: unknown;
  try { payload = JSON.parse(payloadText); } catch { return false; }
  const inspected = inspectGatewayConfigurationReport(topic, payload);
  if (!inspected) return false;
  const topicMac = inspected.kind === 'valid' ? inspected.report.gatewayMac : inspected.topicMac;
  const definition = inspected.kind === 'valid'
    ? definitionByMsgId.get(inspected.report.msgId)!
    : inspected.definition;
  const key = waiterKey(topicMac, definition.msgId);
  const candidate = waiters.get(key);
  const claimedWaiter = candidate?.state === 'waiting' ? candidate : undefined;
  if (claimedWaiter) claimedWaiter.state = 'observing';
  if (inspected.kind === 'invalid' && !claimedWaiter) return false;
  const deadline = claimedWaiter?.deadline ?? Date.now() + UNCLAIMED_REPORT_TIMEOUT_MS;
  let managed: ManagedClient;
  try {
    managed = await acquireClientUntil(deadline, 'response_connection', claimedWaiter?.readId);
  } catch (error) {
    if (claimedWaiter?.state === 'observing' && waiters.get(key) === claimedWaiter) claimedWaiter.state = 'waiting';
    console.error('Failed to acquire database connection for observed gateway configuration', error);
    return false;
  }
  try {
    await queryUntil(managed, 'BEGIN', [], deadline, 'response_begin', claimedWaiter?.readId);
    let transactionOpen = true;
    try {
      let validGateway = false;
      if (inspected.kind === 'valid') {
        validGateway = await persistLatestValue(managed, inspected.report, claimedWaiter, deadline);
      } else {
        const gateway = await queryUntil(managed,
          `SELECT id FROM gateways WHERE id = $1 AND company_id = $2 AND active = TRUE
             AND regexp_replace(lower(mac_address), '[^0-9a-f]', '', 'g') = $3`,
          [claimedWaiter!.gatewayId, claimedWaiter!.companyId, topicMac],
          deadline, 'invalid_response_scope', claimedWaiter!.readId);
        validGateway = Boolean(gateway.rows[0]);
      }
      if (!validGateway) {
        await queryUntil(managed, 'ROLLBACK', [], deadline, 'response_rollback', claimedWaiter?.readId);
        transactionOpen = false;
        if (claimedWaiter?.state === 'observing' && waiters.get(key) === claimedWaiter) claimedWaiter.state = 'waiting';
        return false;
      }
      await queryUntil(managed, 'COMMIT', [], deadline, 'response_commit', claimedWaiter?.readId);
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen && !managed.released) {
        try { await queryUntil(managed, 'ROLLBACK', [], deadline, 'response_rollback', claimedWaiter?.readId); }
        catch { releaseClientOnce(managed, true); }
      }
      throw error;
    }
    if (!claimedWaiter || claimedWaiter.state !== 'observing' || waiters.get(key) !== claimedWaiter) {
      return inspected.kind === 'valid';
    }
    const status = inspected.kind === 'valid' ? 'response_observed' : 'invalid_response';
    const journalUpdated = await persistJournalResult(managed, claimedWaiter, status,
      inspected.kind === 'valid' ? inspected.report.payload : inspected.payload, deadline);
    if (!journalUpdated || claimedWaiter.state !== 'observing' || waiters.get(key) !== claimedWaiter) {
      return inspected.kind === 'valid';
    }
    claimedWaiter.state = status;
    clearTimeout(claimedWaiter.timer);
    removeCurrentWaiter(key, claimedWaiter);
    claimedWaiter.resolve(inspected.kind === 'valid'
      ? { kind: 'response_observed', report: inspected.report }
      : { kind: 'invalid_response' });
    return inspected.kind === 'valid';
  } catch (error) {
    if (claimedWaiter?.state === 'observing' && waiters.get(key) === claimedWaiter) claimedWaiter.state = 'waiting';
    console.error('Failed to persist observed gateway configuration', error);
    return false;
  } finally {
    releaseClientOnce(managed);
  }
}

export type GatewayConfigurationReadResult = {
  readId: string;
  readType: GatewayConfigurationReadType;
  msgId: number;
  status: 'response_observed' | 'invalid_response' | 'timed_out' | 'publish_error';
  data?: GatewayConfigurationData;
  message: string;
};

export async function executeGatewayConfigurationRead(params: {
  gatewayId: number;
  companyId: string;
  gatewayMac: string;
  readType: GatewayConfigurationReadType;
  actorUserId: number;
  requestId?: string;
  timeoutMs: number;
  deps?: { publish?: PublishMqttJson };
}): Promise<GatewayConfigurationReadResult> {
  const gatewayMac = normalizeGatewayMac(params.gatewayMac);
  const definition = definitionByReadType.get(params.readType);
  if (!gatewayMac) throw new Error('Invalid gateway MAC');
  if (!definition) throw new Error('Unsupported gateway configuration read');
  const operationDeadline = Date.now() + params.timeoutMs;
  const cleanupBudgetMs = Math.max(2, Math.min(100, Math.floor(params.timeoutMs / 2)));
  const observationDeadline = operationDeadline - cleanupBudgetMs;
  const key = waiterKey(gatewayMac, definition.msgId);
  let managed: ManagedClient | undefined;
  let readId: string | undefined;
  let lockAcquired = false;
  let waiter: ReadWaiter | undefined;
  try {
    managed = await acquireClientUntil(operationDeadline, 'database_connection');
    const locked = await queryUntil<{ locked: boolean }>(managed,
      'SELECT pg_try_advisory_lock($1, $2) AS locked', [7246, params.gatewayId], operationDeadline, 'advisory_lock');
    if (!locked.rows[0]?.locked) throw new GatewayIdentityBusyError('Gateway already has an active operation');
    lockAcquired = true;
    await queryUntil(managed,
      `UPDATE hardware_gateway_reads SET status = 'timed_out', error_message = 'read timeout recovered before a new request'
       WHERE gateway_id = $1 AND status IN ('pending', 'published')
         AND COALESCE(sent_at, created_at) + (timeout_ms * INTERVAL '1 millisecond') < NOW()`,
      [params.gatewayId], operationDeadline, 'stale_read_recovery');
    const request = buildGatewayConfigurationReadRequest(gatewayMac, params.readType);
    const inserted = await queryUntil<{ id: string }>(managed,
      `INSERT INTO hardware_gateway_reads
         (gateway_id, company_id, msg_id, read_type, request_payload, actor_user_id, request_id, timeout_ms)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id`,
      [params.gatewayId, params.companyId, definition.msgId, params.readType, JSON.stringify(request),
        params.actorUserId, params.requestId ?? null, params.timeoutMs],
      operationDeadline, 'read_journal_insert');
    readId = inserted.rows[0].id;
    const observed = new Promise<ReadObservation>((resolve, reject) => {
      waiter = {
        readId: readId!, gatewayId: params.gatewayId, companyId: params.companyId,
        definition, state: 'waiting', deadline: observationDeadline, resolve, reject,
        timer: setTimeout(() => undefined, params.timeoutMs)
      };
      waiters.set(key, waiter);
      scheduleTimeout(key, waiter);
    });
    void observed.catch(() => undefined);
    const observedOutcome = observed.then((value) => value, () => ({ kind: 'timed_out' as const }));
    const publicationOutcome = (async () => {
      try {
        const publish = params.deps?.publish ?? (await import('./mqttService')).publishMqttJson;
        await publish(`gw/${gatewayMac}/subscribe`, request);
        return { kind: 'published' as const };
      } catch (error) { return { kind: 'publish_error' as const, error }; }
    })();
    const toResult = async (outcome: Awaited<typeof observedOutcome>): Promise<GatewayConfigurationReadResult> => {
      if (outcome.kind === 'response_observed') return {
        readId: readId!, readType: params.readType, msgId: definition.msgId,
        status: 'response_observed', data: outcome.report.data,
        message: 'Gateway response observed; protocol does not uniquely correlate it to this request'
      };
      if (outcome.kind === 'invalid_response') return {
        readId: readId!, readType: params.readType, msgId: definition.msgId,
        status: 'invalid_response', message: 'Gateway response was observed but failed strict schema validation'
      };
      try {
        await queryUntil(managed!,
          `UPDATE hardware_gateway_reads SET status = 'timed_out', error_message = 'response not observed before timeout'
           WHERE id = $1 AND status IN ('pending', 'published')`,
          [readId], operationDeadline, 'timeout_journal', readId);
      } catch (error) {
        if (!(error instanceof GatewayIdentityOperationTimeoutError)) throw error;
        // El plazo absoluto prevalece: destruir la conexión libera el advisory lock.
        // La recuperación de lecturas antiguas cerrará la fila si este último apunte no llegó a persistirse.
      }
      return { readId: readId!, readType: params.readType, msgId: definition.msgId,
        status: 'timed_out', message: 'Gateway response was not observed before timeout' };
    };
    const firstOutcome = await Promise.race([observedOutcome, publicationOutcome]);
    if (firstOutcome.kind !== 'published' && firstOutcome.kind !== 'publish_error') return await toResult(firstOutcome);
    if (firstOutcome.kind === 'publish_error') {
      if (waiter!.state === 'observing' || ['response_observed', 'invalid_response'].includes(waiter!.state)) {
        return await toResult(await observedOutcome);
      }
      if (waiter!.state === 'waiting') {
        waiter!.state = 'publish_error';
        clearTimeout(waiter!.timer);
        removeCurrentWaiter(key, waiter!);
        waiter!.reject(new Error('gateway configuration publication failed'));
      }
      if (waiter!.state === 'timed_out') return await toResult({ kind: 'timed_out' });
      const message = String((firstOutcome.error as Error).message ?? firstOutcome.error);
      await queryUntil(managed,
        `UPDATE hardware_gateway_reads SET status = 'publish_error', error_message = $2
         WHERE id = $1 AND status IN ('pending', 'published')`,
        [readId, message], operationDeadline, 'publish_error_journal', readId);
      return { readId, readType: params.readType, msgId: definition.msgId,
        status: 'publish_error', message: 'Gateway configuration request could not be published' };
    }
    if (waiter!.state === 'waiting' || waiter!.state === 'observing') {
      await queryUntil(managed,
        `UPDATE hardware_gateway_reads SET status = 'published', sent_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [readId], operationDeadline, 'published_journal', readId);
    }
    return await toResult(await observedOutcome);
  } finally {
    if (waiter && (waiter.state === 'waiting' || waiter.state === 'observing')) {
      waiter.state = 'timed_out';
      clearTimeout(waiter.timer);
      removeCurrentWaiter(key, waiter);
      waiter.reject(new Error('gateway configuration read ended before observation completed'));
    }
    if (managed && !managed.released) {
      if (!lockAcquired) releaseClientOnce(managed);
      else if (Date.now() >= operationDeadline) releaseClientOnce(managed, true);
      else {
        try {
          await queryUntil(managed, 'SELECT pg_advisory_unlock($1, $2)', [7246, params.gatewayId],
            operationDeadline, 'advisory_unlock', readId);
        } catch (error) {
          releaseClientOnce(managed, true);
          console.error('Failed to release gateway configuration advisory lock', error);
        }
        releaseClientOnce(managed);
      }
    }
  }
}

export function resetGatewayConfigurationWaitersForTests(): void {
  for (const waiter of waiters.values()) {
    clearTimeout(waiter.timer);
    if (waiter.state === 'waiting' || waiter.state === 'observing') {
      waiter.state = 'timed_out';
      waiter.reject(new Error('gateway configuration waiter reset'));
    }
  }
  waiters.clear();
}
