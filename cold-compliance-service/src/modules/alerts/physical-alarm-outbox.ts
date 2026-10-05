import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { executeAlarmSequence, PhysicalAlarmSequenceResult } from '../tag-control/application/tag-physical-alarm.service';
import { withControlledClient } from '../tag-control/infrastructure/controlled-presence.repository';
import { logger } from '../../utils/logger';
import { db } from '../../db/pool';

type Dispatch=Parameters<typeof executeAlarmSequence>[0];
export async function enqueuePhysicalAlarm(params:Dispatch,query:typeof db.query=db.query.bind(db)):Promise<void>{
  if(!params.tagId||!Number.isInteger(params.hardwareDeviceId))throw new Error('physical_dispatch_identity_required');
  const payload={alertId:params.alertId,workerId:params.workerId,tagId:params.tagId,
    hardwareDeviceId:params.hardwareDeviceId,severity:params.severity,alertType:params.alertType};
  await query(`INSERT INTO physical_alarm_outbox(dispatch_key,hardware_device_id,payload)
    VALUES($1,$2,$3::jsonb) ON CONFLICT(dispatch_key) DO NOTHING`,
  [params.alertId,params.hardwareDeviceId,JSON.stringify(payload)]);
}

async function transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  return withControlledClient(async client=>{
    await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='500ms'");
    await client.query("SET LOCAL statement_timeout='1500ms'");
    const result=await work(client);await client.query('COMMIT');return result;
  });
}

export async function processOnePhysicalAlarm(execute=executeAlarmSequence,observationTimeoutMs=180000):Promise<boolean>{
  const claimId=randomUUID();
  const job=await transaction(async client=>{
    // A crash before dispatch is safe to reclaim. A crash after dispatch is NOT.
    await client.query(`UPDATE physical_alarm_outbox SET state='pending',claim_id=NULL,lease_until=NULL,
      updated_at=clock_timestamp() WHERE state='claimed' AND lease_until<=clock_timestamp()`);
    await client.query(`UPDATE physical_alarm_outbox SET state='review_required',lease_until=NULL,
      result_code='interrupted_dispatch',updated_at=clock_timestamp()
      WHERE state='dispatching' AND lease_until<=clock_timestamp()`);
    const claimed=await client.query<{dispatch_key:string;payload:Dispatch}>(`WITH next AS (
      SELECT queued.dispatch_key FROM physical_alarm_outbox queued WHERE queued.state='pending' AND queued.available_at<=clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM physical_alarm_outbox active
        WHERE active.hardware_device_id=queued.hardware_device_id AND active.state IN ('claimed','dispatching','review_required'))
      ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE physical_alarm_outbox job SET state='claimed',claim_id=$1,lease_until=clock_timestamp()+INTERVAL '10 seconds',
        attempts=attempts+1,updated_at=clock_timestamp() FROM next
      WHERE job.dispatch_key=next.dispatch_key RETURNING job.dispatch_key,job.payload`,[claimId]);
    return claimed.rows[0];
  });
  if(!job)return false;
  const dispatch=await transaction(client=>client.query(`UPDATE physical_alarm_outbox
    SET state='dispatching',lease_until=clock_timestamp()+INTERVAL '180 seconds',updated_at=clock_timestamp()
    WHERE dispatch_key=$1 AND claim_id=$2 AND state='claimed' AND lease_until>clock_timestamp() RETURNING dispatch_key`,
  [job.dispatch_key,claimId]));
  if(dispatch.rowCount!==1)return false;
  let outcome:PhysicalAlarmSequenceResult;
  let failed=false;
  let timer:NodeJS.Timeout|undefined;
  try{outcome=await Promise.race([execute(job.payload),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('physical_result_unavailable')),observationTimeoutMs);
  })]);}catch{failed=true;outcome={status:'attempted_unverified'};}
  finally{if(timer)clearTimeout(timer);}
  await transaction(async client=>{
    const retry=!failed&&outcome.status==='skipped'&&outcome.skipReason==='excluded_before_dispatch';
    const result=retry?'excluded_before_dispatch':failed?'failed':outcome.status==='success'?'confirmed':'unverified';
    const saved=await client.query(`UPDATE physical_alarm_outbox SET
      state=CASE WHEN $3 THEN 'pending' WHEN $5 THEN 'review_required' ELSE 'completed' END,
      claim_id=CASE WHEN $3 THEN NULL ELSE claim_id END,lease_until=NULL,result_code=$4,
      available_at=CASE WHEN $3 THEN clock_timestamp()+INTERVAL '5 seconds' ELSE available_at END,
      exclusion_count=exclusion_count+CASE WHEN $3 THEN 1 ELSE 0 END,
      last_excluded_at=CASE WHEN $3 THEN clock_timestamp() ELSE last_excluded_at END,updated_at=clock_timestamp()
      WHERE dispatch_key=$1 AND claim_id=$2 AND state='dispatching' RETURNING dispatch_key`,
    [job.dispatch_key,claimId,retry,result,failed]);
    if(saved.rowCount!==1)return; // Old workers never overwrite a newer UUID/review.
    // Grace/reminder keys are not alert UUIDs; avoid casting them into alerts.id.
    if(/^[0-9a-f-]{36}$/i.test(job.payload.alertId))await client.query(`UPDATE alerts
      SET metadata=jsonb_set(metadata,'{physicalDispatch}',$2::jsonb,true) WHERE id=$1::uuid`,
    [job.payload.alertId,JSON.stringify({status:outcome.status,skipReason:outcome.skipReason??null,
      gatewayMac:outcome.selectedGatewayMac??null,completedAt:new Date().toISOString()})]);
  });
  return true;
}

export function startPhysicalAlarmOutboxLoop():()=>void{
  let stopped=false;const timers=new Set<NodeJS.Timeout>();
  const schedule=(work:()=>Promise<void>,delay:number)=>{
    if(stopped)return;const timer=setTimeout(()=>{timers.delete(timer);void work();},delay);
    timer.unref();timers.add(timer);
  };
  const run=async()=>{
    try{await processOnePhysicalAlarm();}catch{logger.error('physical outbox failed; durable recovery pending');}
    finally{schedule(run,250);}
  };
  const recover=async()=>{
    try{await transaction(async client=>{
      await client.query(`UPDATE physical_alarm_outbox SET state='pending',claim_id=NULL,lease_until=NULL,
        updated_at=clock_timestamp() WHERE state='claimed' AND lease_until<=clock_timestamp()`);
      await client.query(`UPDATE physical_alarm_outbox SET state='review_required',lease_until=NULL,
        result_code='interrupted_dispatch',updated_at=clock_timestamp()
        WHERE state='dispatching' AND lease_until<=clock_timestamp()`);
    });}catch{logger.error('physical outbox lease recovery pending');}finally{schedule(recover,1000);}
  };
  for(let i=0;i<4;i++)void run();void recover();
  return()=>{stopped=true;for(const timer of timers)clearTimeout(timer);timers.clear();};
}
