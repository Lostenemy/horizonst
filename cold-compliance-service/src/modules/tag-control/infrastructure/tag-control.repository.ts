import { env } from '../../../config/env';
import { db } from '../../../db/pool';
import { logger } from '../../../utils/logger';
import { lookupHardwareGatewayById, lookupHardwareGatewayByMac, normalizeHorneoGatewayMac } from '../../gateways/hardware-manager.client';
import { isOperationalB5, lookupHardwareDeviceById, lookupHardwareDeviceByMac, normalizeHorneoDeviceMac } from '../../tags/hardware-manager.client';

export interface ResolvedTarget {
  workerId?: string;
  workerName?: string;
  tagId: string;
  tagUid: string;
  gatewayId: string;
  gatewayMac: string;
}

export interface ResolvedTargetCandidate extends ResolvedTarget {
  lastSeenAt?: string;
  rssi?: number | null;
  sameColdRoom?: boolean;
  hardwareDeviceId?: number | null;
  hardwareGatewayId?: number | null;
}

type GatewayStrategy = 'last_seen' | 'camera_assigned' | 'hybrid';

function mapTarget(row: any): ResolvedTargetCandidate {
  return {
    workerId: row.worker_id,
    workerName: row.full_name,
    tagId: row.tag_id,
    tagUid: row.tag_uid,
    gatewayId: row.gateway_id,
    gatewayMac: row.gateway_mac,
    lastSeenAt: row.last_seen_at,
    rssi: row.rssi,
    sameColdRoom: row.same_cold_room,
    hardwareDeviceId: row.hardware_device_id,
    hardwareGatewayId: row.hardware_gateway_id
  };
}

export async function validateTechnicalTargets(
  candidates: ResolvedTargetCandidate[],
  deps?: { lookupDeviceById?: typeof lookupHardwareDeviceById; lookupGatewayById?: typeof lookupHardwareGatewayById }
): Promise<ResolvedTargetCandidate[]> {
  if (!env.HARDWARE_MANAGER_ENABLED || !candidates.length) return [];
  const deviceLookups = new Map<number, ReturnType<typeof lookupHardwareDeviceById>>();
  const gatewayLookups = new Map<number, ReturnType<typeof lookupHardwareGatewayById>>();
  const getDevice = (id: number) => {
    if (!deviceLookups.has(id)) deviceLookups.set(id, (deps?.lookupDeviceById ?? lookupHardwareDeviceById)(id));
    return deviceLookups.get(id)!;
  };
  const getGateway = (id: number) => {
    if (!gatewayLookups.has(id)) gatewayLookups.set(id, (deps?.lookupGatewayById ?? lookupHardwareGatewayById)(id));
    return gatewayLookups.get(id)!;
  };

  const validated = await Promise.all(candidates.map(async (candidate) => {
    if (!candidate.hardwareDeviceId || !candidate.hardwareGatewayId) {
      logger.warn({ tagId: candidate.tagId, gatewayId: candidate.gatewayId }, 'tag command target has no central hardware mapping');
      return null;
    }
    const [device, gateway] = await Promise.all([getDevice(candidate.hardwareDeviceId), getGateway(candidate.hardwareGatewayId)]);
    if (device.kind === 'unavailable' || gateway.kind === 'unavailable') {
      logger.warn({ tagId: candidate.tagId, gatewayId: candidate.gatewayId }, 'Hardware Manager unavailable; rejecting command target without central validation');
      return null;
    }
    if (device.kind !== 'found' || gateway.kind !== 'found' || !isOperationalB5(device.value) || !gateway.value.active) {
      logger.warn({ tagId: candidate.tagId, gatewayId: candidate.gatewayId, deviceResult: device.kind, gatewayResult: gateway.kind }, 'tag command target rejected by central technical state');
      return null;
    }
    return {
      ...candidate,
      tagUid: normalizeHorneoDeviceMac(device.value.ble_mac)!.toLowerCase(),
      gatewayMac: normalizeHorneoGatewayMac(gateway.value.mac_address)!
    };
  }));
  return validated.filter((candidate): candidate is ResolvedTargetCandidate => candidate !== null);
}

export async function resolveTagTargets(params: {
  workerId?: string;
  tagId?: string;
  hardwareDeviceId?: number;
  tagUid?: string;
  gatewayMac?: string;
  strategy: GatewayStrategy;
  limit?: number;
  recentWindowMs?: number;
}): Promise<ResolvedTargetCandidate[]> {
  if (params.gatewayMac && (params.tagId || params.hardwareDeviceId || params.tagUid)) {
    if (!env.HARDWARE_MANAGER_ENABLED) return [];
    const centralGateway = await lookupHardwareGatewayByMac(params.gatewayMac);
    if (centralGateway.kind !== 'found' || !centralGateway.value.active) return [];
    let hardwareDeviceId = params.hardwareDeviceId ?? null;
    if (!hardwareDeviceId && params.tagUid) {
      const centralDevice = await lookupHardwareDeviceByMac(params.tagUid);
      if (centralDevice.kind !== 'found' || !isOperationalB5(centralDevice.value)) return [];
      hardwareDeviceId = centralDevice.value.id;
    }
    const direct = await db.query(
      `SELECT t.id as tag_id, t.tag_uid, t.hardware_device_id, w.id as worker_id, w.full_name,
              g.id as gateway_id, g.gateway_mac, g.hardware_gateway_id,
              NULL::timestamptz as last_seen_at, NULL::int as rssi, NULL::boolean as same_cold_room
       FROM tags t
       LEFT JOIN worker_tag_assignments wta
         ON wta.hardware_device_id = t.hardware_device_id
        AND wta.active = true
       LEFT JOIN workers w ON w.id = wta.worker_id
       JOIN gateways g ON g.hardware_gateway_id = $1
       WHERE t.id = COALESCE($2::uuid, t.id)
         AND ($3::integer IS NULL OR t.hardware_device_id = $3)
       LIMIT 1`,
      [centralGateway.value.id, params.tagId ?? null, hardwareDeviceId]
    );
    return validateTechnicalTargets(direct.rows.map(mapTarget));
  }

  const limit = Math.max(1, params.limit ?? env.TAG_CONTROL_GATEWAY_CANDIDATE_LIMIT);
  const recentWindowMs = Math.max(1, params.recentWindowMs ?? env.TAG_CONTROL_GATEWAY_CANDIDATE_WINDOW_MS);
  let requestedHardwareDeviceId = params.hardwareDeviceId ?? null;
  if (!requestedHardwareDeviceId && params.tagUid) {
    if (!env.HARDWARE_MANAGER_ENABLED) return [];
    const centralDevice = await lookupHardwareDeviceByMac(params.tagUid);
    if (centralDevice.kind !== 'found' || !isOperationalB5(centralDevice.value)) return [];
    requestedHardwareDeviceId = centralDevice.value.id;
  }

  if (params.strategy !== 'camera_assigned') {
    const candidates = await db.query(
      `WITH target AS (
         SELECT t.id as tag_id, t.tag_uid, t.hardware_device_id, w.id as worker_id, w.full_name,
                s.cold_room_id AS active_cold_room_id
         FROM tags t
         LEFT JOIN worker_tag_assignments wta
           ON wta.hardware_device_id = t.hardware_device_id
          AND wta.active = true
         LEFT JOIN workers w ON w.id = wta.worker_id
         LEFT JOIN LATERAL (
           SELECT s.cold_room_id
           FROM cold_room_sessions s
           WHERE s.hardware_device_id = t.hardware_device_id
             AND s.ended_at IS NULL
           ORDER BY s.started_at DESC
           LIMIT 1
         ) s ON true
         WHERE ($1::uuid IS NULL OR w.id = $1::uuid)
           AND ($2::uuid IS NULL OR t.id = $2::uuid)
           AND ($3::integer IS NULL OR t.hardware_device_id = $3)
         LIMIT 1
       ), recent_presence AS (
         SELECT ps.gateway_mac,
                ps.hardware_gateway_id,
                ps.last_seen_at,
                ps.last_rssi AS rssi
         FROM tag_gateway_presence_state ps
         JOIN target t ON ps.hardware_device_id = t.hardware_device_id
         WHERE ps.last_seen_at >= NOW() - ($4::text)::interval
       )
       SELECT t.tag_id, t.tag_uid, t.hardware_device_id, t.worker_id, t.full_name,
              g.id as gateway_id, g.gateway_mac, g.hardware_gateway_id, rp.last_seen_at, rp.rssi,
              (t.active_cold_room_id IS NOT NULL AND g.cold_room_id = t.active_cold_room_id) AS same_cold_room
       FROM target t
       JOIN recent_presence rp ON true
       JOIN gateways g ON g.hardware_gateway_id = rp.hardware_gateway_id
       ORDER BY
         CASE WHEN $6::text IN ('hybrid', 'camera_assigned') AND t.active_cold_room_id IS NOT NULL AND g.cold_room_id = t.active_cold_room_id THEN 0 ELSE 1 END,
         rp.last_seen_at DESC,
         rp.rssi DESC NULLS LAST
       LIMIT $5`,
      [params.workerId ?? null, params.tagId ?? null, requestedHardwareDeviceId, `${recentWindowMs} milliseconds`, limit, params.strategy]
    );
    if (candidates.rowCount) {
      const validated = await validateTechnicalTargets(candidates.rows.map(mapTarget));
      if (validated.length) return validated;
    }
  }

  const byCamera = await db.query(
    `SELECT t.id as tag_id, t.tag_uid, t.hardware_device_id, w.id as worker_id, w.full_name,
            g.id as gateway_id, g.gateway_mac, g.hardware_gateway_id,
            NULL::timestamptz as last_seen_at, NULL::int as rssi, true as same_cold_room
     FROM tags t
     LEFT JOIN worker_tag_assignments wta
       ON wta.hardware_device_id = t.hardware_device_id
      AND wta.active = true
     LEFT JOIN workers w ON w.id = wta.worker_id
     JOIN cold_room_sessions s ON s.hardware_device_id = t.hardware_device_id
     JOIN gateways g ON g.cold_room_id = s.cold_room_id
     WHERE s.ended_at IS NULL
       AND ($1::uuid IS NULL OR w.id = $1::uuid)
       AND ($2::uuid IS NULL OR t.id = $2::uuid)
       AND ($3::integer IS NULL OR t.hardware_device_id = $3)
     ORDER BY s.started_at DESC, g.gateway_mac ASC
     LIMIT $4`,
    [params.workerId ?? null, params.tagId ?? null, requestedHardwareDeviceId, limit]
  );

  return validateTechnicalTargets(byCamera.rows.map(mapTarget));
}
