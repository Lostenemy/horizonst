import { pool } from '../db/pool';
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
  armed: boolean;
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
  const client = await pool.connect();
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
    if (updated && waiter?.armed) {
      const journal = await client.query(
        `UPDATE hardware_gateway_reads SET status = 'response_observed', response_observed_at = NOW(),
           response_payload = $2::jsonb WHERE id = $1 AND status IN ('pending', 'published')`,
        [waiter.readId, JSON.stringify(redactHardwarePayload(identity.payload))]
      );
      journalUpdated = Boolean(journal.rowCount);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to persist observed gateway identity', error);
    return false;
  } finally {
    client.release();
  }
  if (updated && journalUpdated && waiter?.armed && waiters.get(identity.gatewayMac) === waiter) {
    clearTimeout(waiter.timer);
    waiters.delete(identity.gatewayMac);
    waiter.resolve(identity);
  }
  return updated;
}

export class GatewayIdentityBusyError extends Error {}

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
  const lockClient = await pool.connect();
  let readId: string | undefined;
  try {
    const locked = await lockClient.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1, $2) AS locked', [7246, params.gatewayId]);
    if (!locked.rows[0]?.locked) throw new GatewayIdentityBusyError('Gateway already has an active operation');
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
    const observed = new Promise<ObservedGatewayIdentity>((resolve, reject) => {
      const waiter: IdentityWaiter = {
        readId: readId!, armed: false, resolve, reject,
        timer: setTimeout(() => {
          waiters.delete(gatewayMac);
          reject(new Error('timeout waiting observed gateway identity'));
        }, params.timeoutMs)
      };
      waiters.set(gatewayMac, waiter);
    });
    void observed.catch(() => undefined);
    try {
      const publish = params.deps?.publish ?? (await import('./mqttService')).publishMqttJson;
      await publish(`gw/${gatewayMac}/subscribe`, request);
      const waiter = waiters.get(gatewayMac);
      if (waiter?.readId === readId) waiter.armed = true;
      await pool.query(
        `UPDATE hardware_gateway_reads SET status = 'published', sent_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [readId]
      );
    } catch (error) {
      const waiter = waiters.get(gatewayMac);
      if (waiter?.readId === readId) {
        clearTimeout(waiter.timer);
        waiters.delete(gatewayMac);
      }
      const message = String((error as Error).message ?? error);
      await pool.query(`UPDATE hardware_gateway_reads SET status = 'publish_error', error_message = $2 WHERE id = $1`, [readId, message]);
      return { readId, status: 'publish_error', message: 'Gateway identity request could not be published' };
    }
    try {
      const identity = await observed;
      return { readId, status: 'response_observed', identity: identity.data,
        message: 'Gateway identity response observed; protocol does not uniquely correlate it to this request' };
    } catch {
      await pool.query(`UPDATE hardware_gateway_reads SET status = 'timed_out', error_message = 'response not observed before timeout' WHERE id = $1 AND status = 'published'`, [readId]);
      return { readId, status: 'timed_out', message: 'Gateway identity response was not observed before timeout' };
    }
  } finally {
    try { await lockClient.query('SELECT pg_advisory_unlock($1, $2)', [7246, params.gatewayId]); } catch { /* release connection below */ }
    lockClient.release();
  }
}

export function resetGatewayIdentityWaitersForTests(): void {
  for (const waiter of waiters.values()) clearTimeout(waiter.timer);
  waiters.clear();
}
