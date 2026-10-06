import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { db } from '../../../db/pool';
import { env } from '../../../config/env';
import { startPresenceTimeoutLoop } from '../compliance.service';
import { beginControlledPresenceOperation } from '../../tag-control/infrastructure/controlled-presence.repository';
import { processOneCloseEffect } from '../presence-close-effects';
import { logger } from '../../../utils/logger';

const databaseUrl=process.env.CONTROLLED_B5_TEST_DATABASE_URL;
const enabled=process.env.CONTROLLED_B5_ALLOW_DATABASE_TESTS==='true'
  &&process.env.CONTROLLED_B5_SCHEDULER_REAL_TIME_TESTS==='true'&&Boolean(databaseUrl);
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
interface Attempt {
  sessionId:string; sweep:number; poolMs:number; startMs:number; transactionMs?:number;
  commitAckUpperTotalMs?:number; errorCode?:string;
  queries:Array<{phase:string;durationMs:number}>;
}

test('PostgreSQL 15 real scheduler: fresh detection, D+60 protection, 6 and 12 sessions, automatic next-sweep recovery',{
  skip:enabled?false:'requires disposable PostgreSQL 15 and explicit real-time scheduler opt-in',timeout:230000
},async t=>{
  const url=new URL(databaseUrl!);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  assert.match(url.pathname,/^\/horizonst_test_[a-z0-9_]+$/i);
  assert.equal(env.PRESENCE_EXIT_TIMEOUT_MS,30000);assert.equal(env.PRESENCE_SWEEP_INTERVAL_MS,10000);
  for(const count of [6,12])await t.test(`${count} sessions / six workers, real wall-clock closure visible before D+90`,async()=>{
    const schema=`scheduler_b5_${randomUUID().replaceAll('-','')}`;
    const admin=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:2000,
      options:'-c statement_timeout=30000'});
    // Four production closure workers compete for three actual pooled connections.
    const options=`-c search_path=${schema} -c statement_timeout=2000`;
    const pool=new Pool({connectionString:databaseUrl,max:3,options,connectionTimeoutMillis:2000});
    const observer=new Pool({connectionString:databaseUrl,max:1,options,connectionTimeoutMillis:2000});
    const lockPool=new Pool({connectionString:databaseUrl,max:1,options,connectionTimeoutMillis:2000});
    const originalConnect=db.connect,originalQuery=db.query,originalInfo=logger.info;
    const activeClients=new Set<PoolClient>();let connecting=0;let owned=false;
    const attempts:Attempt[]=[];
    const snapshots:Array<{sweep:number;poolMs:number;sqlMs:number;totalMs:number}> = [];
    const callbacks:Array<{sweep:number;atMs:number;delayMs:number}> = [];
    const closeLogs:Array<{sessionId:string;queueWaitMs:number;transactionElapsedMs:number}> = [];
    const timers:NodeJS.Timeout[]=[];let referenceStart=0;let detectionMs=0;let currentSweep=0;
    let blocker:PoolClient|undefined;let blockStarted=0;let blockReleased=0;
    let releaseTask:Promise<void>|undefined;let blockerError:unknown;
    let blockedAttemptVerified=false;let blockInjected=false;
    let reportEmitted=false;const visible=new Map<string,number>();
    const sessions=Array.from({length:count},()=>randomUUID());
    const tags=Array.from({length:count},()=>randomUUID());
    const workers=Array.from({length:6},()=>randomUUID());const company=randomUUID();
    let detection='';
    const releaseBlocker=()=>{
      if(!releaseTask)releaseTask=(async()=>{
        if(!blocker)return;
        try{await blocker.query('COMMIT');blockReleased=performance.now();}
        finally{blocker.release();blocker=undefined;}
      })();
      return releaseTask;
    };
    try{
      const version=(await admin.query("SELECT current_setting('server_version') AS version")).rows[0].version;
      assert.match(version,/^15\./);
      await admin.query(`CREATE SCHEMA ${schema}`);owned=true;
      const setup=await pool.connect();
      try{
        await setup.query('BEGIN');
        for(const file of readdirSync(join(process.cwd(),'migrations')).filter(name=>name.endsWith('.sql')).sort())
          await setup.query(readFileSync(join(process.cwd(),'migrations',file),'utf8'));
        await setup.query('COMMIT');
      }finally{setup.release();}
      for(let i=0;i<6;i++)await pool.query('INSERT INTO workers(id,dni,full_name) VALUES($1,$2,$3)',
        [workers[i],`SCHEDULER-FIXTURE-${i}`,`Fixture worker ${i}`]);
      await pool.query("INSERT INTO gateways(id,gateway_mac,hardware_gateway_id) VALUES($1,'a20000000000',41)",[randomUUID()]);
      for(let i=0;i<count;i++)await pool.query('INSERT INTO tags(id,tag_uid,hardware_device_id) VALUES($1,$2,$3)',
        [tags[i],(0xa10000000000+i).toString(16),1000+i]);
      // D is obtained NOW, before recording detections. No backdating or virtual clock.
      referenceStart=performance.now();
      detection=(await pool.query('SELECT clock_timestamp()::text AS at')).rows[0].at;
      detectionMs=Date.parse(detection);
      const fixtures=await pool.connect();
      try{
        await fixtures.query('BEGIN');
        for(let i=0;i<count;i++){
          await fixtures.query(`INSERT INTO cold_room_sessions(id,tag_id,hardware_device_id,worker_id,started_at)
            VALUES($1,$2,$3,$4,$5::timestamptz)`,[sessions[i],tags[i],1000+i,workers[i%6],detection]);
          await fixtures.query(`INSERT INTO tag_gateway_presence_state
            (tag_uid,gateway_mac,hardware_device_id,hardware_gateway_id,last_seen_at,last_presence_at)
            VALUES($1,'a20000000000',$2,41,$3::timestamptz,$3::timestamptz)`,
          [(0xa10000000000+i).toString(16),1000+i,detection]);
          await fixtures.query(`INSERT INTO presence_operational_state(tag_id,hardware_device_id,worker_id,inside,in_alarm)
            VALUES($1,$2,$3,TRUE,FALSE)`,[tags[i],1000+i,workers[i%6]]);
        }
        await fixtures.query('COMMIT');
      }finally{fixtures.release();}
      (db as any).connect=()=>pool.connect();
      for(let i=0;i<count;i++){
        const operation=await beginControlledPresenceOperation({tagId:tags[i],hardwareDeviceId:1000+i,companyId:company,alertId:`fixture-${i}`});
        assert.ok(operation&&operation!=='busy');
      }
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM controlled_b5_presence_operations
        WHERE protect_until=$1::timestamptz+INTERVAL '60 seconds'`,[detection])).rows[0].n,count);
      (logger as any).info=(...args:any[])=>{
        if(args[1]==='closed stale session by presence timeout')closeLogs.push(args[0]);
        return (originalInfo as any).apply(logger,args);
      };
      (db as any).connect=async()=>{
        const start=performance.now();const sweep=currentSweep;connecting++;
        let client:PoolClient;
        try{client=await pool.connect();}finally{connecting--;}
        activeClients.add(client);const poolMs=performance.now()-start;
        const query=client.query.bind(client);let attempt:Attempt|undefined;let released=false;
        const wrapped=Object.create(client);
        wrapped.release=(destroy=false)=>{
          assert.equal(released,false,'connection released twice');released=true;activeClients.delete(client);client.release(destroy);
        };
        wrapped.query=async(sql:string,values:any[]=[])=>{
          if(sql.startsWith('SELECT id FROM cold_room_sessions')&&sql.includes('FOR UPDATE')){
            attempt={sessionId:values[0],sweep,poolMs,startMs:start,queries:[]};attempts.push(attempt);
          }
          const queryStart=performance.now();
          try{
            const result=await query(sql,values);
            if(sql.includes('AS last_seen_at')){
              snapshots.push({sweep,poolMs,sqlMs:performance.now()-queryStart,totalMs:performance.now()-referenceStart});
              const snapshotTime=Number(result.rows[0]?.snapshot_now_ms);
              if(!blockInjected&&snapshotTime>detectionMs+60000){
                blockInjected=true;blocker=await lockPool.connect();
                await blocker.query('BEGIN');await blocker.query('SELECT id FROM cold_room_sessions WHERE id=$1 FOR UPDATE',[sessions[0]]);
                blockStarted=performance.now();
                const releaseAfterMinimumHold=()=>{
                  const remaining=2100-(performance.now()-blockStarted);
                  if(remaining>0){timers.push(setTimeout(releaseAfterMinimumHold,Math.ceil(remaining)));return;}
                  void releaseBlocker().catch(error=>{blockerError=error;});
                };
                timers.push(setTimeout(releaseAfterMinimumHold,2100));
              }
            }
            if(sql==='COMMIT'&&attempt){
              attempt.commitAckUpperTotalMs=performance.now()-referenceStart;
              attempt.transactionMs=performance.now()-start-poolMs;
            }
            return result;
          }catch(error){if(attempt)attempt.errorCode=(error as {code?:string}).code??'query_error';throw error;}
          finally{if(attempt)attempt.queries.push({phase:sql==='COMMIT'?'commit':sql.includes('FOR UPDATE')?'session_lock':
            sql.startsWith('UPDATE cold_room_sessions')?'session_update':sql.includes('presence_operational_state')?'outside_state':
            sql.includes('presence_close_outbox')?'outbox':'other',durationMs:performance.now()-queryStart});}
        };
        return wrapped;
      };
      (db as any).query=pool.query.bind(pool);
      // Capture and stop the actual interval; callbacks run only on native timers.
      const nativeInterval=global.setInterval;
      (global as any).setInterval=(callback:()=>void,delay:number)=>{
        assert.equal(delay,7500);let expected=performance.now()+delay;
        const timer=nativeInterval(()=>{
          const now=performance.now();currentSweep++;
          callbacks.push({sweep:currentSweep,atMs:now-referenceStart,delayMs:Math.max(0,now-expected)});
          expected=now+delay;callback();
        },delay);
        timers.push(timer);return timer;
      };
      try{startPresenceTimeoutLoop();}finally{global.setInterval=nativeInterval;}
      while(visible.size<count&&performance.now()-referenceStart<95000){
        if(blockerError)throw blockerError;
        const rows=(await observer.query(`SELECT s.id,s.ended_at IS NOT NULL AS closed,pos.inside,
          (SELECT count(*)::int FROM presence_close_outbox job WHERE job.session_id=s.id) AS jobs,
          EXTRACT(EPOCH FROM(clock_timestamp()-$2::timestamptz))*1000 AS visible_total_ms
          FROM cold_room_sessions s JOIN presence_operational_state pos ON pos.hardware_device_id=s.hardware_device_id
          WHERE s.id=ANY($1::uuid[])`,[sessions,detection])).rows;
        assert.equal(rows.length,count);
        for(const row of rows){
          assert.equal(row.closed,!row.inside,'no partially committed outside state');
          assert.equal(row.jobs,row.closed?1:0,'no lost or duplicate outbox');
          if(row.closed){assert.ok(Number(row.visible_total_ms)>=60000,'protection ended prematurely');
            if(!visible.has(row.id))visible.set(row.id,Number(row.visible_total_ms));}
          if(row.id===sessions[0]&&!row.closed&&attempts.some(item=>item.sessionId===row.id&&item.errorCode))
            blockedAttemptVerified=true;
        }
        await pause(100);
      }
      // Stop before draining/restarting the effect worker. Never invoke a sweep manually.
      for(const timer of timers)clearInterval(timer);
      await releaseBlocker();
      for(let i=0;i<60&&(activeClients.size||connecting);i++)await pause(100);
      assert.equal(activeClients.size,0);assert.equal(connecting,0);
      assert.equal(visible.size,count,'every session eventually closed by scheduler');
      assert.ok(blockInjected);assert.ok(blockedAttemptVerified);
      assert.ok(blockReleased-blockStarted>=2100);
      const failed=attempts.find(item=>item.sessionId===sessions[0]&&item.errorCode);
      const recovered=attempts.find(item=>item.sessionId===sessions[0]&&item.commitAckUpperTotalMs);
      assert.ok(failed&&recovered);assert.ok(recovered.sweep>failed.sweep,'recovery must be a later native scheduler tick');
      assert.equal(failed.errorCode,'55P03','the failed attempt must be the actual session row-lock timeout');
      assert.equal((await observer.query('SELECT count(*)::int AS n FROM tag_gateway_presence_state WHERE last_presence_at=$1::timestamptz',[detection])).rows[0].n,count);
      assert.equal((await observer.query('SELECT count(*)::int AS n FROM presence_close_outbox WHERE completed_at IS NULL')).rows[0].n,count);
      // Canonical jobs survive loss of process memory; SQL effects can replay once.
      (db as any).connect=()=>pool.connect();
      for(let i=0;i<count;i++)assert.equal(await processOneCloseEffect(),true);
      const completed=(await observer.query('SELECT session_id,completed_at::text,attempts FROM presence_close_outbox ORDER BY session_id')).rows;
      assert.equal(completed.length,count);assert.ok(completed.every(row=>row.completed_at&&row.attempts===1));
      assert.equal(await processOneCloseEffect(),false);
      assert.deepEqual((await observer.query('SELECT session_id,completed_at::text,attempts FROM presence_close_outbox ORDER BY session_id')).rows,completed);
      const maxVisibleMs=Math.max(...visible.values());
      reportEmitted=true;
      t.diagnostic(JSON.stringify({postgres:version,node:process.version,workers:6,sessions:count,poolMax:3,closureWorkers:4,
        timeoutMs:30000,protectionMs:60000,schedulerMs:7500,pollMs:100,heldLockMs:blockReleased-blockStarted,
        maxVisibleMs,maxCommitAckUpperMs:Math.max(...attempts.map(item=>item.commitAckUpperTotalMs??0)),
        callbacks,snapshots,attempts:attempts.map(item=>({...item,startMs:item.startMs-referenceStart})),closeLogs,
        visibility:Array.from(visible,([sessionId,totalMs])=>({sessionId,totalMs}))}));
      assert.ok(maxVisibleMs<90000,'measured load exceeded the objective; do not claim SLA success');
    }finally{
      if(!reportEmitted)t.diagnostic(JSON.stringify({measurementComplete:false,sessions:count,
        visibleCount:visible.size,maxVisibleMs:visible.size?Math.max(...visible.values()):null,
        callbacks,snapshots,attempts:attempts.map(item=>({...item,startMs:item.startMs-referenceStart})),closeLogs}));
      for(const timer of timers){clearTimeout(timer);clearInterval(timer);}
      await releaseBlocker().catch(()=>undefined);
      for(let i=0;i<60&&(activeClients.size||connecting);i++)await pause(100);
      db.connect=originalConnect;db.query=originalQuery;logger.info=originalInfo;
      await Promise.all([pool.end(),observer.end(),lockPool.end()]);
      if(owned)await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});
