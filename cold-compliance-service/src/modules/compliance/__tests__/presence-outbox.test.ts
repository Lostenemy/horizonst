import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../../../db/pool';
import {processOneCloseEffect,applyCloseEffects,CloseEffectPayload} from '../presence-close-effects';
import {processOnePhysicalAlarm} from '../../alerts/physical-alarm-outbox';

const payload:CloseEffectPayload={sessionId:'11111111-1111-4111-8111-111111111111',
  tagId:'22222222-2222-4222-8222-222222222222',hardwareDeviceId:13,workerId:null,coldRoomId:null,
  startedAt:'2026-10-05T09:00:00Z',exposureEndedAt:'2026-10-05T09:01:00Z',lastDetectionAt:'2026-10-05T09:01:00Z',
  reason:'timeout',limits:{preAlertMinutes:100,continuousMinutes:120,dailyMinutes:360}};

test('SQL effect rollback and restart replay once; completion prevents another replay',async()=>{
  const original=db.connect;let durable={effect:0,complete:false};let crash=true;
  (db as any).connect=async()=>{
    let stage={...durable};return {query:async(sql:string)=>{
      if(sql==='BEGIN')stage={...durable};
      if(sql.includes('SELECT session_id,payload'))return {rows:stage.complete?[]:[{session_id:payload.sessionId,payload}],rowCount:stage.complete?0:1};
      if(sql==='simulated accumulator'){stage.effect++;return {rows:[],rowCount:1};}
      if(sql.includes('SET completed_at=clock_timestamp()'))stage.complete=true;
      if(sql==='COMMIT')durable={...stage};return {rows:[],rowCount:0};
    },release(){}};
  };
  const apply=async(client:any)=>{await client.query('simulated accumulator');if(crash)throw Error('simulated_crash');};
  try{
    assert.equal(await processOneCloseEffect(apply),false);assert.deepEqual(durable,{effect:0,complete:false});
    crash=false;assert.equal(await processOneCloseEffect(apply),true);
    assert.deepEqual(durable,{effect:1,complete:true});assert.equal(await processOneCloseEffect(apply),false);
    assert.equal(durable.effect,1);
  }finally{db.connect=original;}
});

test('a stalled SQL effect releases its connection; another durable job remains processable',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const original=db.connect;let destroyed=0;
  (db as any).connect=async()=>({query:async(sql:string)=>({rows:sql.includes('SELECT session_id,payload')?
    [{session_id:payload.sessionId,payload}]:[],rowCount:sql.includes('SELECT session_id,payload')?1:0}),
  release(destroy=false){if(destroy)destroyed++;}});
  try{
    const stalled=processOneCloseEffect(async()=>new Promise(()=>{}));
    for(let i=0;i<20;i++)await Promise.resolve();t.mock.timers.tick(2000);
    assert.equal(await stalled,false);assert.equal(destroyed,1);
    assert.equal(await processOneCloseEffect(async()=>{}),true);
  }finally{db.connect=original;}
});

test('close effects use only their transaction and insert alerts/incidents/physical jobs before completion',async()=>{
  const calls:string[]=[];
  const client={query:async(sql:string)=>{calls.push(sql);return {rows:sql.includes('RETURNING id')?[{id:'33333333-3333-4333-8333-333333333333'}]:[],rowCount:1};}} as any;
  await applyCloseEffects(client,{...payload,exposureEndedAt:'2026-10-05T12:00:00Z',
    limits:{preAlertMinutes:1,continuousMinutes:2,dailyMinutes:360}});
  assert.ok(calls.some(sql=>sql.includes('workday_accumulators')));
  assert.ok(calls.some(sql=>sql.includes('INSERT INTO alerts')));
  assert.ok(calls.some(sql=>sql.includes('INSERT INTO incidents')));
  assert.ok(calls.some(sql=>sql.includes('INSERT INTO physical_alarm_outbox')));
  assert.equal(calls.some(sql=>sql.includes('COMMIT')),false);
});

for(const kind of ['excluded','success','crash','old_uuid'] as const)test(`physical durable dispatch: ${kind}`,async()=>{
  const original=db.connect;const writes:Array<{sql:string;values:any[]}> = [];let claimed=false;let executed=0;
  (db as any).connect=async()=>({query:async(sql:string,values:any[]=[])=>{
    writes.push({sql,values});
    if(sql.includes('WITH next AS')){
      if(claimed)return {rows:[],rowCount:0};claimed=true;
      return {rows:[{dispatch_key:'alarm',payload:{alertId:'alarm',tagId:payload.tagId,
        hardwareDeviceId:13,severity:'critical',alertType:'alarm_rule_alarm'}}],rowCount:1};
    }
    return {rows:[],rowCount:kind==='old_uuid'&&sql.includes("SET state='dispatching'")?0:1};
  },release(){}});
  try{
    await processOnePhysicalAlarm(async()=>{
      executed++;if(kind==='crash')throw Error('simulated_crash_after_possible_send');
      return kind==='excluded'?{status:'skipped',skipReason:'excluded_before_dispatch'}:{status:'success'};
    });
    assert.equal(executed,kind==='old_uuid'?0:1);
    const final=writes.find(write=>write.sql.includes('exclusion_count=exclusion_count'));
    if(kind==='old_uuid'){assert.equal(final,undefined);}else{
      assert.equal(final!.values[2],kind==='excluded');
      assert.equal(final!.values[3],kind==='excluded'?'excluded_before_dispatch':kind==='crash'?'failed':'confirmed');
      assert.match(final!.sql,/claim_id=\$2 AND state='dispatching'/);
    }
    assert.ok(writes.some(write=>write.sql.includes("state='review_required'")));
    await processOnePhysicalAlarm(async()=>{executed++;return {status:'success'};});
    assert.equal(executed,kind==='old_uuid'?0:1);
  }finally{db.connect=original;}
});

test('an unresponsive physical result becomes durable review without resending or aborting the physical cycle',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const original=db.connect;const writes:Array<{sql:string;values:any[]}> = [];
  let calls=0;let claimed=false;
  (db as any).connect=async()=>({query:async(sql:string,values:any[]=[])=>{
    writes.push({sql,values});if(sql.includes('WITH next AS')){
      if(claimed)return {rows:[],rowCount:0};claimed=true;
      return {rows:[{dispatch_key:'pending',payload:{alertId:'pending',tagId:payload.tagId,
        hardwareDeviceId:13,severity:'critical',alertType:'alarm_rule_alarm'}}],rowCount:1};
    }return {rows:[],rowCount:1};
  },release(){}});
  try{
    const run=processOnePhysicalAlarm(async()=>{calls++;return new Promise(()=>{});},1000);
    for(let i=0;i<100;i++)await Promise.resolve();t.mock.timers.tick(1000);await run;
    const final=writes.find(write=>write.sql.includes('exclusion_count=exclusion_count'))!;
    assert.equal(final.values[4],true);assert.match(final.sql,/WHEN \$5 THEN 'review_required'/);
    assert.ok(writes.find(write=>write.sql.includes('WITH next AS'))!.sql.includes("'review_required'"));
    await processOnePhysicalAlarm(async()=>{calls++;return {status:'success'};});assert.equal(calls,1);
  }finally{db.connect=original;}
});
