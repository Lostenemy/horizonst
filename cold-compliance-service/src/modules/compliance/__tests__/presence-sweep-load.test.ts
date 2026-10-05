import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {db} from '../../../db/pool';
import {persistCanonicalPresenceClose} from '../presence-close.repository';
import {nonOverlapping,runBoundedPresenceClosures} from '../presence-sweep';

test('measured isolated loads process every session including number 17 without a capacity cutoff',async t=>{
  for(const count of [1,16,17,32,64,128]){
    const original=db.connect;let active=0;let peak=0;let completed=0;
    const queue:number[]=[];const tx:number[]=[];const started=performance.now();
    const ids=Array.from({length:count},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
    (db as any).connect=async()=>{
      const acquired=performance.now();queue.push(acquired-started);active++;peak=Math.max(peak,active);
      return {query:async(sql:string,values:any[]=[])=>{
        if(sql.startsWith('UPDATE cold_room_sessions'))return {rowCount:1,rows:[{id:values[2],
          tag_id:'11111111-1111-4111-8111-111111111111',hardware_device_id:13,worker_id:null,cold_room_id:null,
          started_at:'2026-10-05 09:00:00.123456+00'}]};
        if(sql==='COMMIT'){await new Promise(resolve=>setTimeout(resolve,5));completed++;tx.push(performance.now()-acquired);}
        return {rowCount:0,rows:[]};
      },release(){active--;}};
    };
    try{
      const failures:string[]=[];
      await runBoundedPresenceClosures(ids,async sessionId=>{
        assert.equal(await persistCanonicalPresenceClose({sessionId,endedAt:'2026-10-05 10:01:00.123456+00',
          lastDetectionAt:'2026-10-05 10:00:00.123456+00',closeEventId:null,reason:'timeout',timeoutMs:30000,
          limits:{preAlertMinutes:110,continuousMinutes:120,dailyMinutes:360}}),true);
      },id=>failures.push(id));
      const measured=performance.now()-started;
      assert.deepEqual(failures,[]);assert.equal(completed,count);assert.ok(peak<=4);
      // Simulated DB transport (5ms COMMIT), NOT a PostgreSQL capacity/SLA certificate.
      t.diagnostic(JSON.stringify({count,workers:4,transport:'simulated-5ms-commit',
        sweepWallMs:Math.ceil(measured),maxQueueMs:Math.ceil(Math.max(...queue)),maxTransactionMs:Math.ceil(Math.max(...tx))}));
    }finally{db.connect=original;}
  }
});

test('one indefinitely blocked session does not prevent 17 others from committing; restart retries the retained close',async()=>{
  const original=db.connect;let acquired=0;let committed=0;let destroyed=0;let blocked=true;
  (db as any).connect=async()=>{
    const stalled=blocked&&acquired++===0;
    return {query:async(sql:string,values:any[]=[])=>{
      if(stalled)return new Promise(()=>{});
      if(sql.startsWith('UPDATE cold_room_sessions'))return {rowCount:1,rows:[{id:values[2],
        tag_id:'11111111-1111-4111-8111-111111111111',hardware_device_id:13,worker_id:null,cold_room_id:null,
        started_at:'2026-10-05 09:00:00+00'}]};
      if(sql==='COMMIT')committed++;return {rows:[],rowCount:0};
    },release(destroy=false){if(destroy)destroyed++;}};
  };
  const close=async(sessionId:string)=>{await persistCanonicalPresenceClose({sessionId,endedAt:'2026-10-05 10:01:00+00',
    lastDetectionAt:'2026-10-05 10:00:00+00',closeEventId:null,reason:'timeout',timeoutMs:30000,
    limits:{preAlertMinutes:110,continuousMinutes:120,dailyMinutes:360}});};
  try{
    const failed:string[]=[];const start=performance.now();
    await runBoundedPresenceClosures(Array.from({length:18},(_,i)=>String(i)),close,id=>failed.push(id));
    assert.equal(committed,17);assert.deepEqual(failed,['0']);assert.equal(destroyed,1);
    assert.ok(performance.now()-start<4000); // Actual local elapsed time, no long sleep.
    blocked=false;await close('0');assert.equal(committed,18);
  }finally{db.connect=original;}
});

test('overlapping sweeps share one flight; failure resets the flight without losing a future attempt',async()=>{
  let calls=0;let resolve!:()=>void;
  const sweep=nonOverlapping(async()=>{calls++;await new Promise<void>(done=>{resolve=done;});});
  const first=sweep();assert.equal(sweep(),first);assert.equal(calls,1);resolve();await first;
  const second=sweep();assert.equal(calls,2);resolve();await second;
  let failures=0;const failed=nonOverlapping(async()=>{failures++;throw Error('simulated');});
  await assert.rejects(failed());await assert.rejects(failed());assert.equal(failures,2);
});
