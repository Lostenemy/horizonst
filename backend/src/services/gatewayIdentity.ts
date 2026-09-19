import { pool } from '../db/pool';
import type { PoolClient } from 'pg';
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
const DATA_KEYS = [
  'ble_mac', 'company_name', 'device_name', 'eth_mac', 'firmware_version',
  'function_version', 'hardware_version', 'product_model', 'sl_ble_version', 'software_version'
];
const safeText = (value: unknown, max: number): value is string => {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const length = value.trim().length;
  return length > 0 && length <= max;
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
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (claimedWaiter?.state === 'observing' && waiters.get(identity.gatewayMac) === claimedWaiter) {
      claimedWaiter.state = 'waiting';
    }
    console.error('Failed to acquire database connection for observed gateway identity', error);
    return false;
  }
  let updated = false;
  let journalUpdated = false;
  try {
    await client.query('BEGIN');
    const gateway = await client.query<{ id: number }>(
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
        identity.data.slBleVersion]
    );
    updated = Boolean(gateway.rows[0]);
    if (updated && claimedWaiter?.state === 'observing'
        && waiters.get(identity.gatewayMac) === claimedWaiter) {
      const journal = await client.query(
        `UPDATE hardware_gateway_reads SET status = 'response_observed', response_observed_at = NOW(),
           response_payload = $2::jsonb WHERE id = $1 AND status IN ('pending', 'published')`,
        [claimedWaiter.readId, JSON.stringify(redactHardwarePayload(identity.payload))]
      );
      journalUpdated = Boolean(journal.rowCount);
    }
    if (journalUpdated && (claimedWaiter?.state !== 'observing'
        || waiters.get(identity.gatewayMac) !== claimedWaiter)) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to roll back observed gateway identity transaction', rollbackError);
    }
    if (claimedWaiter?.state === 'observing' && waiters.get(identity.gatewayMac) === claimedWaiter) {
      claimedWaiter.state = 'waiting';
    }
    console.error('Failed to persist observed gateway identity', error);
    return false;
  } finally {
    client.release();
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

export class GatewayIdentityBusyError extends Error {}

const persistReadTerminalState = (sql: string, params: unknown[]): void => {
  void pool.query(sql, params).catch((error) => {
    console.error('Failed to persist terminal gateway identity read state', error);
  });
};

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
  const lockClient = await pool.connect();
  let readId: string | undefined;
  let lockAcquired = false;
  try {
    const locked = await lockClient.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1, $2) AS locked', [7246, params.gatewayId]);
    if (!locked.rows[0]?.locked) throw new GatewayIdentityBusyError('Gateway already has an active operation');
    lockAcquired = true;
    await pool.query(
      `UPDATE hardware_gateway_reads SET status = 'timed_out', error_message = 'read timeout recovered before a new request'
       WHERE gateway_id = $1 AND status IN ('pending', 'published')
         AND COALESCE(sent_at, created_at) + (timeout_ms * INTERVAL '1 millisecond') < NOW()`,
      [params.gatewayId]
    );
    const request = buildGatewayIdentityRequest(gatewayMac);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO hardware_gateway_reads
         (gateway_id, company_id, msg_id, read_type, request_payload, actor_user_id, request_id, timeout_ms)
       VALUES($1,$2,2002,'gateway_identity',$3::jsonb,$4,$5,$6) RETURNING id`,
      [params.gatewayId, params.companyId, JSON.stringify(request), params.actorUserId,
        params.requestId ?? null, params.timeoutMs]
    );
    readId = inserted.rows[0].id;
    let waiter!: IdentityWaiter;
    const observed = new Promise<ObservedGatewayIdentity>((resolve, reject) => {
      waiter = {
        readId: readId!, state: 'waiting', deadline: operationDeadline,
        resolve, reject, timer: setTimeout(() => undefined, params.timeoutMs)
      };
      waiters.set(gatewayMac, waiter);
      scheduleIdentityTimeout(gatewayMac, waiter);
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
        if (waiter.state === 'waiting' || waiter.state === 'observing') {
          await pool.query(
            `UPDATE hardware_gateway_reads SET status = 'published', sent_at = NOW()
             WHERE id = $1 AND status = 'pending'`,
            [readId]
          );
        }
        return { kind: 'published' as const };
      } catch (error) {
        return { kind: 'publish_error' as const, error };
      }
    })();
    const toReadResult = (outcome: Awaited<typeof observedOutcome>) => {
      if (outcome.kind === 'response_observed') {
        return { readId: readId!, status: 'response_observed' as const, identity: outcome.identity.data,
          message: 'Gateway identity response observed; protocol does not uniquely correlate it to this request' };
      }
      persistReadTerminalState(
        `UPDATE hardware_gateway_reads SET status = 'timed_out', error_message = 'response not observed before timeout'
         WHERE id = $1 AND status IN ('pending', 'published')`,
        [readId]
      );
      return { readId: readId!, status: 'timed_out' as const,
        message: 'Gateway identity response was not observed before timeout' };
    };

    const firstOutcome = await Promise.race([observedOutcome, publicationOutcome]);
    if (firstOutcome.kind === 'response_observed' || firstOutcome.kind === 'timed_out') {
      return toReadResult(firstOutcome);
    }
    if (firstOutcome.kind === 'publish_error') {
      if (waiter.state === 'observing' || waiter.state === 'response_observed') {
        return toReadResult(await observedOutcome);
      }
      if (waiter.state === 'waiting') {
        waiter.state = 'publish_error';
        clearTimeout(waiter.timer);
        removeCurrentWaiter(gatewayMac, waiter);
        waiter.reject(new Error('gateway identity publication failed'));
      }
      if (waiter.state === 'timed_out') {
        persistReadTerminalState(
          `UPDATE hardware_gateway_reads SET status = 'timed_out', error_message = 'response not observed before timeout'
           WHERE id = $1 AND status IN ('pending', 'published')`,
          [readId]
        );
        return { readId, status: 'timed_out', message: 'Gateway identity response was not observed before timeout' };
      }
      const message = String((firstOutcome.error as Error).message ?? firstOutcome.error);
      persistReadTerminalState(
        `UPDATE hardware_gateway_reads SET status = 'publish_error', error_message = $2
         WHERE id = $1 AND status IN ('pending', 'published')`,
        [readId, message]
      );
      return { readId, status: 'publish_error', message: 'Gateway identity request could not be published' };
    }
    return toReadResult(await observedOutcome);
  } finally {
    if (!lockAcquired) {
      lockClient.release();
    } else {
      const remainingMs = operationDeadline - Date.now();
      if (remainingMs <= 0) {
        lockClient.release(true);
      } else {
        let cleanupTimer: NodeJS.Timeout | undefined;
        const unlockAttempt = lockClient.query('SELECT pg_advisory_unlock($1, $2)', [7246, params.gatewayId])
          .then(() => true, (error) => {
            console.error('Failed to release gateway identity advisory lock', error);
            return false;
          });
        const cleanupDeadline = new Promise<boolean>((resolve) => {
          cleanupTimer = setTimeout(() => resolve(false), remainingMs);
        });
        const unlocked = await Promise.race([unlockAttempt, cleanupDeadline]);
        if (cleanupTimer) clearTimeout(cleanupTimer);
        lockClient.release(unlocked ? undefined : true);
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
