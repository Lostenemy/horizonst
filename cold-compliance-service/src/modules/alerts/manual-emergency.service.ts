import { db } from '../../db/pool';
import { logger } from '../../utils/logger';
import { appendAuditLog } from '../audit/audit.service';
import { ParsedManualEmergencyEvent } from '../presence/payload-parser';
import { createAlert } from './alerts.service';
import { resolveEventTechnicalIdentity } from '../hardware-manager/event-identity.service';

const DEDUPLICATION_WINDOW_SECONDS = 60;

interface EmergencyContext {
  tag_id: string;
  hardware_device_id: number;
  gateway_id: string | null;
  worker_id: string | null;
  worker_name: string | null;
  cold_room_id: string | null;
}

export function manualEmergencyDeduplicationKey(hardwareDeviceId: number, triggerCount: number | null): string {
  return `hardware:${hardwareDeviceId}:${triggerCount ?? 'missing'}`;
}

type RejectionReason = 'unknown_tag' | 'central_unavailable' | 'central_not_found' | 'central_rejected' | 'mapping_not_found';

async function auditRejected(event: ParsedManualEmergencyEvent, reason: RejectionReason): Promise<void> {
  await appendAuditLog({
    actorType: 'system',
    action: `manual_emergency_rejected_${reason}`,
    entityType: 'tag',
    entityId: event.tagUid,
    payload: {
      gatewayMac: event.gatewayMac,
      tagUid: event.tagUid,
      triggerCount: event.triggerCount,
      reason
    }
  });
}

export async function processManualEmergency(event: ParsedManualEmergencyEvent): Promise<void> {
  logger.info({
    gatewayMac: event.gatewayMac,
    tagUid: event.tagUid,
    triggerCount: event.triggerCount
  }, 'manual emergency received');

  const identity = await resolveEventTechnicalIdentity({ tagMac: event.tagUid, gatewayMac: event.gatewayMac });
  if (identity.source !== 'central') {
    const reason = identity.source;
    logger.warn({ gatewayMac: event.gatewayMac, tagUid: event.tagUid, technicalReason: identity.reason }, 'manual emergency rejected by Hardware Manager');
    await auditRejected(event, reason);
    return;
  }

  const client = await db.connect();
  let rejection: RejectionReason | null = null;
  let createdAlertId: string | null = null;
  let context: EmergencyContext | null = null;

  try {
    await client.query('BEGIN');
    const contextResult = await client.query<EmergencyContext>(
      `SELECT t.id AS tag_id,
              t.hardware_device_id,
              assignment.worker_id,
              assignment.worker_name,
              gateway.gateway_id,
              COALESCE(pos.cold_room_id, session.cold_room_id, gateway.cold_room_id) AS cold_room_id
       FROM tags t
       LEFT JOIN LATERAL (
         SELECT wta.worker_id, w.full_name AS worker_name
         FROM worker_tag_assignments wta
         LEFT JOIN workers w ON w.id = wta.worker_id
         WHERE wta.hardware_device_id = t.hardware_device_id
           AND wta.active = TRUE
         ORDER BY wta.assigned_at DESC
         LIMIT 1
       ) assignment ON TRUE
       LEFT JOIN presence_operational_state pos
         ON pos.hardware_device_id = t.hardware_device_id
       LEFT JOIN LATERAL (
         SELECT crs.cold_room_id
         FROM cold_room_sessions crs
         WHERE crs.hardware_device_id = t.hardware_device_id
           AND crs.ended_at IS NULL
         ORDER BY crs.started_at DESC
         LIMIT 1
       ) session ON TRUE
       LEFT JOIN LATERAL (
         SELECT g.id AS gateway_id, g.cold_room_id
         FROM gateways g
         WHERE g.hardware_gateway_id = $2
         LIMIT 1
       ) gateway ON TRUE
       WHERE t.hardware_device_id = $1
       LIMIT 1`,
      [identity.hardwareDeviceId, identity.hardwareGatewayId]
    );

    context = contextResult.rows[0] ?? null;
    if (!context) {
      rejection = 'unknown_tag';
      await client.query('ROLLBACK');
    } else if (!context.gateway_id) {
      rejection = 'mapping_not_found';
      await client.query('ROLLBACK');
    } else if (!Number.isInteger(context.hardware_device_id)) {
      rejection = 'mapping_not_found';
      await client.query('ROLLBACK');
    } else {
      const hardwareDeviceId = context.hardware_device_id as number;
      const deduplicationKey = manualEmergencyDeduplicationKey(hardwareDeviceId, event.triggerCount);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [deduplicationKey]);

      const duplicate = await client.query<{ id: string }>(
        `SELECT a.id
         FROM alerts a
         WHERE a.hardware_device_id = $1
           AND alert_type = 'manual_emergency'
           AND created_at >= NOW() - ($3 * INTERVAL '1 second')
           AND metadata ->> 'triggerCount' IS NOT DISTINCT FROM $2
         LIMIT 1`,
        [hardwareDeviceId, event.triggerCount === null ? null : String(event.triggerCount), DEDUPLICATION_WINDOW_SECONDS]
      );

      if (duplicate.rowCount) {
        await client.query('COMMIT');
        logger.info({
          gatewayMac: event.gatewayMac,
          tagUid: event.tagUid,
          triggerCount: event.triggerCount,
          workerId: context.worker_id,
          coldRoomId: context.cold_room_id,
          alertId: duplicate.rows[0].id
        }, 'manual emergency duplicate ignored');
        try {
          await appendAuditLog({
            actorType: 'system',
            action: 'manual_emergency_duplicate_ignored',
            entityType: 'alert',
            entityId: duplicate.rows[0].id,
            payload: {
              gatewayMac: event.gatewayMac,
              tagUid: event.tagUid,
              triggerCount: event.triggerCount,
              workerId: context.worker_id,
              coldRoomId: context.cold_room_id,
              alertId: duplicate.rows[0].id
            }
          });
        } catch (error) {
          logger.error({ error, alertId: duplicate.rows[0].id }, 'failed to audit ignored manual emergency duplicate');
        }
        return;
      }

      const workerName = context.worker_name ?? 'Sin trabajador asignado';
      const alert = await createAlert({
        workerId: context.worker_id ?? undefined,
        tagId: context.tag_id,
        hardwareDeviceId,
        coldRoomId: context.cold_room_id ?? undefined,
        severity: 'critical',
        alertType: 'manual_emergency',
        message: `Alarma de emergencia activada manualmente por ${workerName}`,
        metadata: {
          source: 'bxp_button',
          alarmStatus: event.alarmStatus,
          triggerCount: event.triggerCount,
          gatewayMac: event.gatewayMac,
          tagUid: event.tagUid,
          receivedAt: event.receivedAt,
          rawPayload: event.rawPayload
        },
        dispatchPhysicalAlarm: false,
        queryClient: client
      });
      createdAlertId = alert.id;
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (rejection) {
    logger.warn({
      gatewayMac: event.gatewayMac,
      tagUid: event.tagUid,
      triggerCount: event.triggerCount,
      workerId: context?.worker_id ?? null,
      coldRoomId: context?.cold_room_id ?? null
    }, 'manual emergency rejected');
    await auditRejected(event, rejection);
    return;
  }

  if (createdAlertId && context) {
    logger.info({
      gatewayMac: event.gatewayMac,
      tagUid: event.tagUid,
      triggerCount: event.triggerCount,
      workerId: context.worker_id,
      coldRoomId: context.cold_room_id,
      alertId: createdAlertId
    }, 'manual emergency created');
    await appendAuditLog({
      actorType: 'system',
      action: 'manual_emergency_created',
      entityType: 'alert',
      entityId: createdAlertId,
      payload: {
        gatewayMac: event.gatewayMac,
        tagUid: event.tagUid,
        triggerCount: event.triggerCount,
        workerId: context.worker_id,
        coldRoomId: context.cold_room_id,
        alertId: createdAlertId
      }
    });
  }
}
