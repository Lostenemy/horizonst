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
  if (!env.HARDWARE_MANAGER_ENABLED || !candidates.length) return candidates;
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
      logger.warn({ tagId: candidate.tagId, gatewayId: candidate.gatewayId }, 'Hardware Manager unavailable; using controlled local command target fallback');
      return candidate;
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
    let gatewayClause = 'g.gateway_mac = $1';
    let gatewayValue: string | number = params.gatewayMac.toLowerCase();
    let tagUidClause = 't.tag_uid = COALESCE($3, t.tag_uid)';
    let tagUidValue: string | number | null = params.tagUid?.toLowerCase() ?? null;
    if (env.HARDWARE_MANAGER_ENABLED) {
      const centralGateway = await lookupHardwareGatewayByMac(params.gatewayMac);
      if (centralGateway.kind === 'not_found' || (centralGateway.kind === 'found' && !centralGateway.value.active)) return [];
      if (centralGateway.kind === 'found') {
        gatewayClause = 'g.hardware_gateway_id = $1';
        gatewayValue = centralGateway.value.id;
      }
      if (!params.tagId && !params.hardwareDeviceId && params.tagUid) {
        const centralDevice = await lookupHardwareDeviceByMac(params.tagUid);
        if (centralDevice.kind === 'not_found' || (centralDevice.kind === 'found' && !isOperationalB5(centralDevice.value))) return [];
        if (centralDevice.kind === 'found') {
          tagUidClause = 't.hardware_device_id = $3';
          tagUidValue = centralDevice.value.id;
        }
      }
    }
    const direct = await db.query(
      `SELECT t.id as tag_id, t.tag_uid, t.hardware_device_id, w.id as worker_id, w.full_name,
              g.id as gateway_id, g.gateway_mac, g.hardware_gateway_id,
              NULL::timestamptz as last_seen_at, NULL::int as rssi, NULL::boolean as same_cold_room
       FROM tags t
       LEFT JOIN worker_tag_assignments wta
         ON ((t.hardware_device_id IS NOT NULL AND wta.hardware_device_id = t.hardware_device_id)
             OR (wta.hardware_device_id IS NULL AND wta.tag_id = t.id))
        AND wta.active = true
       LEFT JOIN workers w ON w.id = wta.worker_id
       JOIN gateways g ON ${gatewayClause}
       WHERE t.id = COALESCE($2::uuid, t.id)
         AND ($4::integer IS NULL OR t.hardware_device_id = $4)
         AND ${tagUidClause}
       LIMIT 1`,
      [gatewayValue, params.tagId ?? null, tagUidValue, params.hardwareDeviceId ?? null]
    );
    return validateTechnicalTargets(direct.rows.map(mapTarget));
  }

  const limit = Math.max(1, params.limit ?? env.TAG_CONTROL_GATEWAY_CANDIDATE_LIMIT);
  const recentWindowMs = Math.max(1, params.recentWindowMs ?? env.TAG_CONTROL_GATEWAY_CANDIDATE_WINDOW_MS);

  if (params.strategy !== 'camera_assigned') {
    const candidates = await db.query(
      `WITH target AS (
         SELECT t.id as tag_id, t.tag_uid, t.hardware_device_id, w.id as worker_id, w.full_name,
                s.cold_room_id AS active_cold_room_id
         FROM tags t
         LEFT JOIN worker_tag_assignments wta
           ON ((t.hardware_device_id IS NOT NULL AND wta.hardware_device_id = t.hardware_device_id)
               OR (wta.hardware_device_id IS NULL AND wta.tag_id = t.id))
          AND wta.active = true
         LEFT JOIN workers w ON w.id = wta.worker_id
         LEFT JOIN LATERAL (
           SELECT s.cold_room_id
           FROM cold_room_sessions s
           WHERE ((t.hardware_device_id IS NOT NULL AND s.hardware_device_id = t.hardware_device_id)
                  OR (s.hardware_device_id IS NULL AND s.tag_id = t.id))
             AND s.ended_at IS NULL
           ORDER BY s.started_at DESC
           LIMIT 1
         ) s ON true
         WHERE ($1::uuid IS NULL OR w.id = $1::uuid)
           AND ($2::uuid IS NULL OR t.id = $2::uuid)
           AND ($3::text IS NULL OR t.tag_uid = $3)
           AND ($7::integer IS NULL OR t.hardware_device_id = $7)
         LIMIT 1
       ), recent_presence AS (
         SELECT ps.gateway_mac,
                ps.hardware_gateway_id,
                ps.last_seen_at,
                ps.last_rssi AS rssi
         FROM tag_gateway_presence_state ps
         JOIN target t ON ((t.hardware_device_id IS NOT NULL AND ps.hardware_device_id = t.hardware_device_id)
                           OR (ps.hardware_device_id IS NULL AND regexp_replace(lower(t.tag_uid), '[-:]', '', 'g') = ps.tag_uid))
         WHERE ps.last_seen_at >= NOW() - ($4::text)::interval
       )
       SELECT t.tag_id, t.tag_uid, t.hardware_device_id, t.worker_id, t.full_name,
              g.id as gateway_id, g.gateway_mac, g.hardware_gateway_id, rp.last_seen_at, rp.rssi,
              (t.active_cold_room_id IS NOT NULL AND g.cold_room_id = t.active_cold_room_id) AS same_cold_room
       FROM target t
       JOIN recent_presence rp ON true
       JOIN gateways g ON ((g.hardware_gateway_id IS NOT NULL AND g.hardware_gateway_id = rp.hardware_gateway_id)
                           OR (rp.hardware_gateway_id IS NULL AND regexp_replace(lower(g.gateway_mac), '[-:]', '', 'g') = rp.gateway_mac))
       ORDER BY
         CASE WHEN $6::text IN ('hybrid', 'camera_assigned') AND t.active_cold_room_id IS NOT NULL AND g.cold_room_id = t.active_cold_room_id THEN 0 ELSE 1 END,
         rp.last_seen_at DESC,
         rp.rssi DESC NULLS LAST
       LIMIT $5`,
      [params.workerId ?? null, params.tagId ?? null, params.tagUid?.toLowerCase() ?? null, `${recentWindowMs} milliseconds`, limit, params.strategy, params.hardwareDeviceId ?? null]
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
       ON ((t.hardware_device_id IS NOT NULL AND wta.hardware_device_id = t.hardware_device_id)
           OR (wta.hardware_device_id IS NULL AND wta.tag_id = t.id))
      AND wta.active = true
     LEFT JOIN workers w ON w.id = wta.worker_id
     JOIN cold_room_sessions s
       ON ((t.hardware_device_id IS NOT NULL AND s.hardware_device_id = t.hardware_device_id)
           OR (s.hardware_device_id IS NULL AND s.tag_id = t.id))
     JOIN gateways g ON g.cold_room_id = s.cold_room_id
     WHERE s.ended_at IS NULL
       AND ($1::uuid IS NULL OR w.id = $1::uuid)
       AND ($2::uuid IS NULL OR t.id = $2::uuid)
       AND ($3::text IS NULL OR t.tag_uid = $3)
       AND ($5::integer IS NULL OR t.hardware_device_id = $5)
     ORDER BY s.started_at DESC, g.gateway_mac ASC
     LIMIT $4`,
    [params.workerId ?? null, params.tagId ?? null, params.tagUid?.toLowerCase() ?? null, limit, params.hardwareDeviceId ?? null]
  );

  return validateTechnicalTargets(byCamera.rows.map(mapTarget));
}
