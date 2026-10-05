import { PoolClient } from 'pg';
import { env } from '../../config/env';
import { madridExposureSegments } from '../realtime/workday-duration';
import { withControlledClient } from '../tag-control/infrastructure/controlled-presence.repository';
import { logger } from '../../utils/logger';

export interface CloseEffectPayload {
  sessionId: string; tagId: string; hardwareDeviceId: number;
  workerId: string | null; coldRoomId: string | null; startedAt: string;
  exposureEndedAt: string; lastDetectionAt: string; reason: 'event' | 'timeout';
  limits: { preAlertMinutes: number; continuousMinutes: number; dailyMinutes: number };
}

export async function applyCloseEffects(client: PoolClient, payload: CloseEffectPayload): Promise<void> {
  const durationMinutes = (Date.parse(payload.exposureEndedAt)-Date.parse(payload.startedAt))/60000;
  const segments=madridExposureSegments(payload.startedAt,payload.exposureEndedAt);
  if (segments.length) await client.query(`INSERT INTO workday_accumulators
    (workday_date,worker_id,cold_room_id,accumulated_seconds)
    SELECT (segment.value->>'date')::date,$2,$3,(segment.value->>'seconds')::int
    FROM jsonb_array_elements($1::jsonb) segment(value) WHERE TRUE
    ON CONFLICT (workday_date,worker_id,cold_room_id) DO UPDATE
    SET accumulated_seconds=workday_accumulators.accumulated_seconds+EXCLUDED.accumulated_seconds,updated_at=NOW()`,
  [JSON.stringify(segments),payload.workerId,payload.coldRoomId]);

  const alert=async(severity:string,type:string,message:string,metadata:Record<string,unknown>)=>{
    const created=await client.query<{id:string}>(`INSERT INTO alerts
      (worker_id,tag_id,hardware_device_id,cold_room_id,severity,alert_type,message,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [payload.workerId,payload.tagId,payload.hardwareDeviceId,payload.coldRoomId,severity,type,message,
      {...metadata,closeSessionId:payload.sessionId}]);
    const id=created.rows[0].id;
    await client.query(`INSERT INTO physical_alarm_outbox(dispatch_key,hardware_device_id,payload)
      VALUES($1,$2,$3::jsonb) ON CONFLICT(dispatch_key) DO NOTHING`,
    [id,payload.hardwareDeviceId,JSON.stringify({alertId:id,workerId:payload.workerId??undefined,
      tagId:payload.tagId,hardwareDeviceId:payload.hardwareDeviceId,severity,alertType:type})]);
  };
  if(durationMinutes>=payload.limits.preAlertMinutes){
    const prelimit=durationMinutes<payload.limits.continuousMinutes;
    await alert(prelimit?'warning':'critical',prelimit?'continuous_limit_prewarning':'continuous_limit_exceeded',
      `Permanencia en cámara: ${Math.round(durationMinutes)} min`,
      {durationMinutes,limitMinutes:payload.limits.continuousMinutes,closeReason:payload.reason});
  }
  if(durationMinutes>payload.limits.continuousMinutes+env.INCIDENT_GRACE_MINUTES)
    await client.query(`INSERT INTO incidents(worker_id,tag_id,hardware_device_id,cold_room_id,incident_type,reason,metadata)
      VALUES($1,$2,$3,$4,'continuous_exposure_breach','Exceso de permanencia continuada en cámara frigorífica',$5)`,
    [payload.workerId,payload.tagId,payload.hardwareDeviceId,payload.coldRoomId,
      {durationMinutes,closeReason:payload.reason,closeSessionId:payload.sessionId}]);
  // Preserve the existing daily rule and nullable-room behavior; no new alarm policy.
  const daily=await client.query(`SELECT accumulated_seconds FROM workday_accumulators
    WHERE workday_date=$1::date AND worker_id=$2 AND cold_room_id=$3`,
  [segments.at(-1)?.date??null,payload.workerId,payload.coldRoomId]);
  const dayMinutes=(daily.rows[0]?.accumulated_seconds??0)/60;
  if(dayMinutes>payload.limits.dailyMinutes) await alert('critical','daily_limit_exceeded',
    `Límite diario superado (${Math.round(dayMinutes)} min)`,
    {dayMinutes,dailyLimitMinutes:payload.limits.dailyMinutes});
}

// SQL effects and completion share one transaction: rollback makes retries safe.
export async function processOneCloseEffect(apply=applyCloseEffects): Promise<boolean> {
  let sessionId:string|undefined;
  try {
    return await withControlledClient(async client=>{
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='500ms'");
      await client.query("SET LOCAL statement_timeout='1500ms'");
      const job=await client.query<{session_id:string;payload:CloseEffectPayload}>(`SELECT session_id,payload
        FROM presence_close_outbox WHERE completed_at IS NULL AND available_at<=clock_timestamp()
        ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      if(!job.rowCount){await client.query('COMMIT');return false;}
      sessionId=job.rows[0].session_id;
      await apply(client,job.rows[0].payload);
      await client.query(`UPDATE presence_close_outbox SET completed_at=clock_timestamp(),
        attempts=attempts+1,last_error_code=NULL WHERE session_id=$1 AND completed_at IS NULL`,[sessionId]);
      await client.query('COMMIT');return true;
    });
  } catch {
    // No payload/error text in logs. A failed job remains durable; backoff avoids starvation.
    logger.error({sessionId},'presence close effects failed; durable retry pending');
    if(sessionId) await withControlledClient(client=>client.query(`UPDATE presence_close_outbox
      SET available_at=clock_timestamp()+INTERVAL '5 seconds',attempts=attempts+1,last_error_code='effects_failed'
      WHERE session_id=$1 AND completed_at IS NULL`,[sessionId])).catch(()=>undefined);
    return false;
  }
}

export function startCloseEffectsLoop(): ()=>void {
  let stopped=false;let timer:NodeJS.Timeout|undefined;
  const run=async()=>{
    try {await processOneCloseEffect();} finally {
      if(!stopped){timer=setTimeout(()=>void run(),250);timer.unref();}
    }
  };
  void run();return()=>{stopped=true;if(timer)clearTimeout(timer);};
}
