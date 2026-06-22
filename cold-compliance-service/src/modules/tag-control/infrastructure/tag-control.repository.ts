import { env } from '../../../config/env';
import { db } from '../../../db/pool';

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
    sameColdRoom: row.same_cold_room
  };
}

export async function resolveTagTargets(params: {
  workerId?: string;
  tagId?: string;
  tagUid?: string;
  gatewayMac?: string;
  strategy: GatewayStrategy;
  limit?: number;
  recentWindowMs?: number;
}): Promise<ResolvedTargetCandidate[]> {
  if (params.gatewayMac && (params.tagId || params.tagUid)) {
    const direct = await db.query(
      `SELECT t.id as tag_id, t.tag_uid, w.id as worker_id, w.full_name, g.id as gateway_id, g.gateway_mac,
              NULL::timestamptz as last_seen_at, NULL::int as rssi, NULL::boolean as same_cold_room
       FROM tags t
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = t.id AND wta.active = true
       LEFT JOIN workers w ON w.id = wta.worker_id
       JOIN gateways g ON g.gateway_mac = $1
       WHERE t.id = COALESCE($2::uuid, t.id) AND t.tag_uid = COALESCE($3, t.tag_uid)
       LIMIT 1`,
      [params.gatewayMac.toLowerCase(), params.tagId ?? null, params.tagUid?.toLowerCase() ?? null]
    );
    return direct.rows.map(mapTarget);
  }

  const limit = Math.max(1, params.limit ?? env.TAG_CONTROL_GATEWAY_CANDIDATE_LIMIT);
  const recentWindowMs = Math.max(1, params.recentWindowMs ?? env.TAG_CONTROL_GATEWAY_CANDIDATE_WINDOW_MS);

  if (params.strategy !== 'camera_assigned') {
    const candidates = await db.query(
      `WITH target AS (
         SELECT t.id as tag_id, t.tag_uid, w.id as worker_id, w.full_name,
                s.cold_room_id AS active_cold_room_id
         FROM tags t
         LEFT JOIN worker_tag_assignments wta ON wta.tag_id = t.id AND wta.active = true
         LEFT JOIN workers w ON w.id = wta.worker_id
         LEFT JOIN LATERAL (
           SELECT cold_room_id
           FROM cold_room_sessions
           WHERE tag_id = t.id AND ended_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
         ) s ON true
         WHERE ($1::uuid IS NULL OR w.id = $1::uuid)
           AND ($2::uuid IS NULL OR t.id = $2::uuid)
           AND ($3::text IS NULL OR t.tag_uid = $3)
         LIMIT 1
       ), recent_presence AS (
         SELECT DISTINCT ON (pe.gateway_mac)
                pe.gateway_mac,
                pe.event_ts AS last_seen_at,
                pe.rssi
         FROM presence_events pe
         JOIN target t ON t.tag_uid = pe.tag_uid
         WHERE pe.event_ts >= NOW() - ($4::text)::interval
         ORDER BY pe.gateway_mac, pe.event_ts DESC, pe.rssi DESC NULLS LAST
       )
       SELECT t.tag_id, t.tag_uid, t.worker_id, t.full_name,
              g.id as gateway_id, g.gateway_mac, rp.last_seen_at, rp.rssi,
              (t.active_cold_room_id IS NOT NULL AND g.cold_room_id = t.active_cold_room_id) AS same_cold_room
       FROM target t
       JOIN recent_presence rp ON true
       JOIN gateways g ON g.gateway_mac = rp.gateway_mac
       ORDER BY
         CASE WHEN $6::text IN ('hybrid', 'camera_assigned') AND t.active_cold_room_id IS NOT NULL AND g.cold_room_id = t.active_cold_room_id THEN 0 ELSE 1 END,
         rp.last_seen_at DESC,
         rp.rssi DESC NULLS LAST
       LIMIT $5`,
      [params.workerId ?? null, params.tagId ?? null, params.tagUid?.toLowerCase() ?? null, `${recentWindowMs} milliseconds`, limit, params.strategy]
    );
    if (candidates.rowCount) return candidates.rows.map(mapTarget);
  }

  const byCamera = await db.query(
    `SELECT t.id as tag_id, t.tag_uid, w.id as worker_id, w.full_name, g.id as gateway_id, g.gateway_mac,
            NULL::timestamptz as last_seen_at, NULL::int as rssi, true as same_cold_room
     FROM tags t
     LEFT JOIN worker_tag_assignments wta ON wta.tag_id = t.id AND wta.active = true
     LEFT JOIN workers w ON w.id = wta.worker_id
     JOIN cold_room_sessions s ON s.tag_id = t.id
     JOIN gateways g ON g.cold_room_id = s.cold_room_id
     WHERE s.ended_at IS NULL
       AND ($1::uuid IS NULL OR w.id = $1::uuid)
       AND ($2::uuid IS NULL OR t.id = $2::uuid)
       AND ($3::text IS NULL OR t.tag_uid = $3)
     ORDER BY s.started_at DESC, g.gateway_mac ASC
     LIMIT $4`,
    [params.workerId ?? null, params.tagId ?? null, params.tagUid?.toLowerCase() ?? null, limit]
  );

  return byCamera.rows.map(mapTarget);
}

export async function resolveTagTarget(params: {
  workerId?: string;
  tagId?: string;
  tagUid?: string;
  gatewayMac?: string;
  strategy: GatewayStrategy;
}): Promise<ResolvedTarget> {
  const targets = await resolveTagTargets(params);
  if (!targets.length) throw new Error('unable to resolve gateway/tag target');
  return targets[0];
}

export async function findTemplate(code: string) {
  const result = await db.query('SELECT * FROM tag_command_templates WHERE code = $1 AND active = true', [code]);
  return result.rows[0] ?? null;
}

export async function listTemplates() {
  return (await db.query('SELECT * FROM tag_command_templates ORDER BY code ASC')).rows;
}

export async function createTemplate(input: { code: string; name: string; description?: string; channels: Record<string, unknown> }) {
  return (
    await db.query(
      `INSERT INTO tag_command_templates(code, name, description, channels)
       VALUES($1, $2, $3, $4) RETURNING *`,
      [input.code, input.name, input.description ?? null, input.channels]
    )
  ).rows[0];
}

export async function updateTemplate(id: string, patch: { name?: string; description?: string; channels?: Record<string, unknown>; active?: boolean }) {
  return (
    await db.query(
      `UPDATE tag_command_templates
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           channels = COALESCE($4, channels),
           active = COALESCE($5, active),
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, patch.name ?? null, patch.description ?? null, patch.channels ?? null, patch.active ?? null]
    )
  ).rows[0];
}
