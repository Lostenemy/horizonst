import { db } from '../../../db/pool';

export interface ResolvedTarget {
  workerId?: string;
  workerName?: string;
  tagId: string;
  tagUid: string;
  gatewayId: string;
  gatewayMac: string;
}

export async function resolveTagTarget(params: {
  workerId?: string;
  tagId?: string;
  tagUid?: string;
  gatewayMac?: string;
  strategy: 'last_seen' | 'camera_assigned' | 'hybrid';
}): Promise<ResolvedTarget> {
  if (params.gatewayMac && (params.tagId || params.tagUid)) {
    const direct = await db.query(
      `SELECT t.id as tag_id, t.tag_uid, g.id as gateway_id, g.gateway_mac
       FROM tags t JOIN gateways g ON g.gateway_mac = $1
       WHERE t.id = COALESCE($2::uuid, t.id) AND t.tag_uid = COALESCE($3, t.tag_uid)
       LIMIT 1`,
      [params.gatewayMac.toLowerCase(), params.tagId ?? null, params.tagUid?.toLowerCase() ?? null]
    );
    if (direct.rowCount) {
      return { tagId: direct.rows[0].tag_id, tagUid: direct.rows[0].tag_uid, gatewayId: direct.rows[0].gateway_id, gatewayMac: direct.rows[0].gateway_mac };
    }
  }

  if (params.strategy !== 'camera_assigned') {
    const lastSeen = await db.query(
      `SELECT t.id as tag_id, t.tag_uid, w.id as worker_id, w.full_name,
              g.id as gateway_id, g.gateway_mac
       FROM tags t
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = t.id AND wta.active = true
       LEFT JOIN workers w ON w.id = wta.worker_id
       JOIN LATERAL (
          SELECT pe.gateway_mac FROM presence_events pe
          WHERE pe.tag_uid = t.tag_uid
          ORDER BY pe.event_ts DESC LIMIT 1
       ) pe ON true
       JOIN gateways g ON g.gateway_mac = pe.gateway_mac
       WHERE (w.id = COALESCE($1::uuid, w.id))
         AND (t.id = COALESCE($2::uuid, t.id))
         AND (t.tag_uid = COALESCE($3, t.tag_uid))
       LIMIT 1`,
      [params.workerId ?? null, params.tagId ?? null, params.tagUid?.toLowerCase() ?? null]
    );
    if (lastSeen.rowCount) {
      return {
        workerId: lastSeen.rows[0].worker_id,
        workerName: lastSeen.rows[0].full_name,
        tagId: lastSeen.rows[0].tag_id,
        tagUid: lastSeen.rows[0].tag_uid,
        gatewayId: lastSeen.rows[0].gateway_id,
        gatewayMac: lastSeen.rows[0].gateway_mac
      };
    }
  }

  const byCamera = await db.query(
    `SELECT t.id as tag_id, t.tag_uid, w.id as worker_id, w.full_name, g.id as gateway_id, g.gateway_mac
     FROM tags t
     LEFT JOIN worker_tag_assignments wta ON wta.tag_id = t.id AND wta.active = true
     LEFT JOIN workers w ON w.id = wta.worker_id
     JOIN cold_room_sessions s ON s.tag_id = t.id
     JOIN gateways g ON g.cold_room_id = s.cold_room_id
     WHERE s.ended_at IS NULL
       AND (w.id = COALESCE($1::uuid, w.id))
       AND (t.id = COALESCE($2::uuid, t.id))
       AND (t.tag_uid = COALESCE($3, t.tag_uid))
     ORDER BY s.started_at DESC
     LIMIT 1`,
    [params.workerId ?? null, params.tagId ?? null, params.tagUid?.toLowerCase() ?? null]
  );

  if (!byCamera.rowCount) throw new Error('unable to resolve gateway/tag target');

  return {
    workerId: byCamera.rows[0].worker_id,
    workerName: byCamera.rows[0].full_name,
    tagId: byCamera.rows[0].tag_id,
    tagUid: byCamera.rows[0].tag_uid,
    gatewayId: byCamera.rows[0].gateway_id,
    gatewayMac: byCamera.rows[0].gateway_mac
  };
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
