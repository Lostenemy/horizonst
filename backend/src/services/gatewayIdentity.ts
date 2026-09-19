import { pool } from '../db/pool';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { normalizeGatewayMac } from '../utils/mac';
import { redactHardwarePayload } from './hardwarePayloadRedaction';

type PublishMqttJson = (topic: string, payload: Record<string, unknown>) => Promise<void>;

export interface GatewayIdentityData {
  bleMac: string;
  ethMac: string;
  deviceName: string;
  productModel: string;
  companyName: string;
  hardwareVersion: string;
  softwareVersion: string;
  firmwareVersion: string;
  functionVersion: string;
  slBleVersion: string;
}

export interface ObservedGatewayIdentity {
  gatewayMac: string;
  data: GatewayIdentityData;
  payload: Record<string, unknown>;
}

type IdentityWaiter = {
  readId: string;
  state: 'waiting' | 'observing' | 'response_observed' | 'timed_out' | 'publish_error';
  deadline: number;
  resolve: (identity: ObservedGatewayIdentity) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const waiters = new Map<string, IdentityWaiter>();
const UNCLAIMED_REPORT_TIMEOUT_MS = 10_000;
const DATA_KEYS = [
  'ble_mac', 'company_name', 'device_name', 'eth_mac', 'firmware_version',
  'function_version', 'hardware_version', 'product_model', 'sl_ble_version', 'software_version'
];
const safeText = (value: unknown, max: number): value is string => {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const length = value.trim().length;
  return length > 0 && length <= max;
};

export class GatewayIdentityBusyError extends Error {}

export class GatewayIdentityOperationTimeoutError extends Error {
  constructor(public readonly stage: string, public readonly readId?: string) {
    super(`Gateway identity operation timed out during ${stage}`);
    this.name = 'GatewayIdentityOperationTimeoutError';
  }
}

type ManagedClient = {
  client: PoolClient;
  released: boolean;
};

const releaseClientOnce = (managed: ManagedClient, destroy = false): void => {
  if (managed.released) return;
  managed.released = true;
  managed.client.release(destroy || undefined);
};

const untilDeadline = async <T>(
  operation: Promise<T>,
  deadline: number,
  stage: string,
  readId?: string
): Promise<T> => {
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
        (lateError) => console.error('Late gateway identity database acquisition failed', lateError)
      ).catch((releaseError) => {
        console.error('Failed to destroy late gateway identity database connection', releaseError);
      });
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

const removeCurrentWaiter = (gatewayMac: string, waiter: IdentityWaiter): void => {
  if (waiters.get(gatewayMac) === waiter) waiters.delete(gatewayMac);
};

const scheduleIdentityTimeout = (gatewayMac: string, waiter: IdentityWaiter): void => {
  clearTimeout(waiter.timer);
  waiter.timer = setTimeout(() => {
    if (!['waiting', 'observing'].includes(waiter.state) || waiters.get(gatewayMac) !== waiter) return;
    waiter.state = 'timed_out';
    waiters.delete(gatewayMac);
    waiter.reject(new Error('timeout waiting observed gateway identity'));
  }, Math.max(0, waiter.deadline - Date.now()));
};

export function buildGatewayIdentityRequest(gatewayMacInput: string): { msg_id: 2002; device_info: { mac: string } } {
  const gatewayMac = normalizeGatewayMac(gatewayMacInput);
  if (!gatewayMac) throw new Error('Invalid gateway MAC');
  return { msg_id: 2002, device_info: { mac: gatewayMac.toUpperCase() } };
}

export function parseGatewayIdentityReport(topic: string, payload: unknown): ObservedGatewayIdentity | null {
  const topicMatch = topic.match(/^gw\/([0-9a-f]{12})\/publish$/i);
  if (!topicMatch || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  if (Object.keys(root).sort().join(',') !== 'data,device_info,msg_id' || root.msg_id !== 2002) return null;
  if (!root.device_info || typeof root.device_info !== 'object' || Array.isArray(root.device_info)
      || Object.keys(root.device_info).join(',') !== 'mac') return null;
  const topicMac = normalizeGatewayMac(topicMatch[1]);
  const payloadMac = normalizeGatewayMac((root.device_info as Record<string, unknown>).mac);
  if (!topicMac || payloadMac !== topicMac || !root.data || typeof root.data !== 'object' || Array.isArray(root.data)) return null;
  const data = root.data as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== DATA_KEYS.join(',')) return null;
  const bleMac = normalizeGatewayMac(data.ble_mac);
  const ethMac = normalizeGatewayMac(data.eth_mac);
  if (!bleMac || !ethMac
      || !safeText(data.device_name, 64) || !safeText(data.product_model, 64)
      || !safeText(data.company_name, 128) || !safeText(data.hardware_version, 32)
      || !safeText(data.software_version, 32) || !safeText(data.firmware_version, 32)
      || !safeText(data.function_version, 32) || !safeText(data.sl_ble_version, 32)) return null;
  return {
    gatewayMac: topicMac,
    data: {
      bleMac, ethMac, deviceName: data.device_name.trim(), productModel: data.product_model.trim(),
      companyName: data.company_name.trim(), hardwareVersion: data.hardware_version.trim(),
      softwareVersion: data.software_version.trim(), firmwareVersion: data.firmware_version.trim(),
      functionVersion: data.function_version.trim(), slBleVersion: data.sl_ble_version.trim()
    },
    payload: root
  };
}

export async function handleGatewayIdentityReport(topic: string, payloadText: string): Promise<boolean> {
  let payload: unknown;
  try { payload = JSON.parse(payloadText); } catch { return false; }
  const identity = parseGatewayIdentityReport(topic, payload);
  if (!identity) return false;
  const waiter = waiters.get(identity.gatewayMac);
  const claimedWaiter = waiter?.state === 'waiting' ? waiter : undefined;
  if (claimedWaiter) {
    claimedWaiter.state = 'observing';
  }
  const persistenceDeadline = claimedWaiter?.deadline ?? Date.now() + UNCLAIMED_REPORT_TIMEOUT_MS;
  let managed: ManagedClient;
  try {
    managed = await acquireClientUntil(persistenceDeadline, 'response_connection', claimedWaiter?.readId);
  } catch (error) {
    if (claimedWaiter?.state === 'observing' && waiters.get(identity.gatewayMac) === claimedWaiter) {
      claimedWaiter.state = 'waiting';
    }
    console.error('Failed to acquire database connection for observed gateway identity', error);
    return false;
  }
  let updated = false;
  let journalUpdated = false;
  let transactionOpen = false;
  try {
    await queryUntil(managed, 'BEGIN', [], persistenceDeadline, 'response_begin', claimedWaiter?.readId);
    transactionOpen = true;
    const gateway = await queryUntil<{ id: number }>(
      managed,
      `UPDATE gateways SET
         reported_device_name = $2, reported_product_model = $3, reported_ble_mac = $4,
         reported_eth_mac = $5, reported_company_name = $6, reported_hardware_version = $7,
         reported_software_version = $8, reported_firmware_version = $9,
         reported_function_version = $10, reported_sl_ble_version = $11,
         identity_observed_at = NOW(), updated_at = NOW()
       WHERE active = TRUE AND regexp_replace(lower(mac_address), '[^0-9a-f]', '', 'g') = $1
       RETURNING id`,
      [identity.gatewayMac, identity.data.deviceName, identity.data.productModel, identity.data.bleMac,
        identity.data.ethMac, identity.data.companyName, identity.data.hardwareVersion,
        identity.data.softwareVersion, identity.data.firmwareVersion, identity.data.functionVersion,
        identity.data.slBleVersion],
      persistenceDeadline,
      'response_inventory',
      claimedWaiter?.readId
    );
    updated = Boolean(gateway.rows[0]);
    if (updated && claimedWaiter?.state === 'observing'
        && waiters.get(identity.gatewayMac) === claimedWaiter) {
      const journal = await queryUntil(
        managed,
        `UPDATE hardware_gateway_reads SET status = 'response_observed', response_observed_at = NOW(),
           response_payload = $2::jsonb WHERE id = $1 AND status IN ('pending', 'published')`,
        [claimedWaiter.readId, JSON.stringify(redactHardwarePayload(identity.payload))],
        persistenceDeadline,
        'response_journal',
        claimedWaiter.readId
      );
      journalUpdated = Boolean(journal.rowCount);
    }
    if (journalUpdated && (claimedWaiter?.state !== 'observing'
        || waiters.get(identity.gatewayMac) !== claimedWaiter)) {
      await queryUntil(managed, 'ROLLBACK', [], persistenceDeadline, 'response_rollback', claimedWaiter?.readId);
      transactionOpen = false;
      return false;
    }
    await queryUntil(managed, 'COMMIT', [], persistenceDeadline, 'response_commit', claimedWaiter?.readId);
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen && !managed.released) {
      try {
        await queryUntil(managed, 'ROLLBACK', [], persistenceDeadline, 'response_rollback', claimedWaiter?.readId);
      } catch (rollbackError) {
        releaseClientOnce(managed, true);
        console.error('Failed to roll back observed gateway identity transaction', rollbackError);
      }
    }
    if (claimedWaiter?.state === 'observing' && waiters.get(identity.gatewayMac) === claimedWaiter) {
      claimedWaiter.state = 'waiting';
    }
    console.error('Failed to persist observed gateway identity', error);
    return false;
  } finally {
    releaseClientOnce(managed);
  }
  if (updated && journalUpdated && claimedWaiter?.state === 'observing'
      && waiters.get(identity.gatewayMac) === claimedWaiter) {
    claimedWaiter.state = 'response_observed';
    clearTimeout(claimedWaiter.timer);
    removeCurrentWaiter(identity.gatewayMac, claimedWaiter);
    claimedWaiter.resolve(identity);
  } else if (claimedWaiter?.state === 'observing' && waiters.get(identity.gatewayMac) === claimedWaiter) {
    claimedWaiter.state = 'waiting';
  }
  return updated;
}

export async function executeGatewayIdentityRead(params: {
  gatewayId: number;
  companyId: string;
  gatewayMac: string;
  actorUserId: number;
  requestId?: string;
  timeoutMs: number;
  deps?: { publish?: PublishMqttJson };
}): Promise<{ readId: string; status: 'response_observed' | 'timed_out' | 'publish_error'; identity?: GatewayIdentityData; message: string }> {
  const gatewayMac = normalizeGatewayMac(params.gatewayMac);
  if (!gatewayMac) throw new Error('Invalid gateway MAC');
  const operationDeadline = Date.now() + params.timeoutMs;
  const cleanupBudgetMs = Math.max(2, Math.min(100, Math.floor(params.timeoutMs / 2)));
  const observationDeadline = operationDeadline - cleanupBudgetMs;
  let managed: ManagedClient | undefined;
  let readId: string | undefined;
  let lockAcquired = false;
  let waiter: IdentityWaiter | undefined;
  try {
    managed = await acquireClientUntil(operationDeadline, 'database_connection');
    const locked = await queryUntil<{ locked: boolean }>(
      managed, 'SELECT pg_try_advisory_lock($1, $2) AS locked', [7246, params.gatewayId],
      operationDeadline, 'advisory_lock'
    );
    if (!locked.rows[0]?.locked) throw new GatewayIdentityBusyError('Gateway already has an active operation');
    lockAcquired = true;
    await queryUntil(
      managed,
      `UPDATE hardware_gateway_reads SET status = 'timed_out', error_message = 'read timeout recovered before a new request'
       WHERE gateway_id = $1 AND status IN ('pending', 'published')
         AND COALESCE(sent_at, created_at) + (timeout_ms * INTERVAL '1 millisecond') < NOW()`,
      [params.gatewayId], operationDeadline, 'stale_read_recovery'
    );
    const request = buildGatewayIdentityRequest(gatewayMac);
    const inserted = await queryUntil<{ id: string }>(
      managed,
      `INSERT INTO hardware_gateway_reads
         (gateway_id, company_id, msg_id, read_type, request_payload, actor_user_id, request_id, timeout_ms)
       VALUES($1,$2,2002,'gateway_identity',$3::jsonb,$4,$5,$6) RETURNING id`,
      [params.gatewayId, params.companyId, JSON.stringify(request), params.actorUserId,
        params.requestId ?? null, params.timeoutMs],
      operationDeadline, 'read_journal_insert'
    );
    readId = inserted.rows[0].id;
    const observed = new Promise<ObservedGatewayIdentity>((resolve, reject) => {
      waiter = {
        readId: readId!, state: 'waiting', deadline: observationDeadline,
        resolve, reject, timer: setTimeout(() => undefined, params.timeoutMs)
      };
      waiters.set(gatewayMac, waiter!);
      scheduleIdentityTimeout(gatewayMac, waiter!);
    });
    void observed.catch(() => undefined);
    const observedOutcome = observed.then(
      (identity) => ({ kind: 'response_observed' as const, identity }),
      () => ({ kind: 'timed_out' as const })
    );
    const publicationOutcome = (async () => {
      try {
        const publish = params.deps?.publish ?? (await import('./mqttService')).publishMqttJson;
        await publish(`gw/${gatewayMac}/subscribe`, request);
        return { kind: 'published' as const };
      } catch (error) {
        return { kind: 'publish_error' as const, error };
      }
    })();
    const toReadResult = async (outcome: Awaited<typeof observedOutcome>) => {
      if (outcome.kind === 'response_observed') {
        return { readId: readId!, status: 'response_observed' as const, identity: outcome.identity.data,
          message: 'Gateway identity response observed; protocol does not uniquely correlate it to this request' };
      }
      try {
        await queryUntil(
          managed!,
          `UPDATE hardware_gateway_reads SET status = 'timed_out', error_message = 'response not observed before timeout'
           WHERE id = $1 AND status IN ('pending', 'published')`,
          [readId], operationDeadline, 'timeout_journal', readId
        );
      } catch (error) {
        if (!(error instanceof GatewayIdentityOperationTimeoutError)) throw error;
        // El resultado público respeta el plazo absoluto. Destruir la conexión
        // libera el advisory lock y la recuperación posterior cierra la fila pendiente.
      }
      return { readId: readId!, status: 'timed_out' as const,
        message: 'Gateway identity response was not observed before timeout' };
    };

    const firstOutcome = await Promise.race([observedOutcome, publicationOutcome]);
    if (firstOutcome.kind === 'response_observed' || firstOutcome.kind === 'timed_out') {
      return await toReadResult(firstOutcome);
    }
    if (firstOutcome.kind === 'publish_error') {
      if (waiter!.state === 'observing' || waiter!.state === 'response_observed') {
        return await toReadResult(await observedOutcome);
      }
      if (waiter!.state === 'waiting') {
        waiter!.state = 'publish_error';
        clearTimeout(waiter!.timer);
        removeCurrentWaiter(gatewayMac, waiter!);
        waiter!.reject(new Error('gateway identity publication failed'));
      }
      if (waiter!.state === 'timed_out') {
        return await toReadResult({ kind: 'timed_out' });
      }
      const message = String((firstOutcome.error as Error).message ?? firstOutcome.error);
      await queryUntil(
        managed,
        `UPDATE hardware_gateway_reads SET status = 'publish_error', error_message = $2
         WHERE id = $1 AND status IN ('pending', 'published')`,
        [readId, message], operationDeadline, 'publish_error_journal', readId
      );
      return { readId, status: 'publish_error', message: 'Gateway identity request could not be published' };
    }
    if (waiter!.state === 'waiting' || waiter!.state === 'observing') {
      await queryUntil(
        managed,
        `UPDATE hardware_gateway_reads SET status = 'published', sent_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [readId], operationDeadline, 'published_journal', readId
      );
    }
    return await toReadResult(await observedOutcome);
  } finally {
    if (waiter && (waiter.state === 'waiting' || waiter.state === 'observing')) {
      waiter.state = 'timed_out';
      clearTimeout(waiter.timer);
      removeCurrentWaiter(gatewayMac, waiter);
      waiter.reject(new Error('gateway identity operation ended before observation completed'));
    }
    if (managed && !managed.released) {
      if (!lockAcquired) {
        releaseClientOnce(managed);
      } else if (Date.now() >= operationDeadline) {
        releaseClientOnce(managed, true);
      } else {
        try {
          await queryUntil(
            managed, 'SELECT pg_advisory_unlock($1, $2)', [7246, params.gatewayId],
            operationDeadline, 'advisory_unlock', readId
          );
        } catch (error) {
          releaseClientOnce(managed, true);
          console.error('Failed to release gateway identity advisory lock', error);
        }
        releaseClientOnce(managed);
      }
    }
  }
}

export function resetGatewayIdentityWaitersForTests(): void {
  for (const waiter of waiters.values()) {
    clearTimeout(waiter.timer);
    if (waiter.state === 'waiting' || waiter.state === 'observing') {
      waiter.state = 'timed_out';
      waiter.reject(new Error('gateway identity waiter reset'));
    }
  }
  waiters.clear();
}
