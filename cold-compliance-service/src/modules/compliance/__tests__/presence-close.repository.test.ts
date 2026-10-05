import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../../db/pool';
import { persistCanonicalPresenceClose, PresenceCloseInput } from '../presence-close.repository';

const input: PresenceCloseInput = {
  sessionId:'11111111-1111-4111-8111-111111111111',
  endedAt:'2026-10-05 10:01:00.123456+00',
  lastDetectionAt:'2026-10-05 10:00:00.123456+00',closeEventId:null,reason:'timeout',timeoutMs:30000,
  limits:{preAlertMinutes:110,continuousMinutes:120,dailyMinutes:360}
};
const closed = {id:input.sessionId,tag_id:'22222222-2222-4222-8222-222222222222',
  hardware_device_id:13,worker_id:null,cold_room_id:null,started_at:'2026-10-05 09:59:00.123456+00'};

test('canonical close commits session, outside state and durable outbox together with exact timestamp tokens', async () => {
  const original=db.connect; const calls:Array<{sql:string;values:any[]}> = []; const released:boolean[]=[];
  (db as any).connect=async()=>({query:async(sql:string,values:any[]=[])=>{
    calls.push({sql,values}); return {rows:sql.startsWith('UPDATE cold_room_sessions')?[closed]:[],
      rowCount:sql.startsWith('UPDATE cold_room_sessions')?1:0};
  },release:(destroy=false)=>released.push(destroy)});
  try {
    assert.equal(await persistCanonicalPresenceClose(input),true);
    const close=calls.find(call=>call.sql.startsWith('UPDATE cold_room_sessions'))!;
    assert.equal(close.values[0],input.endedAt); assert.equal(close.values[3],input.lastDetectionAt);
    assert.match(close.sql,/ps\.last_presence_at > \$4::timestamptz/);
    assert.match(close.sql,/LEAST\(op\.protect_until,\$4::timestamptz\+INTERVAL '60 seconds'\)/);
    assert.match(calls.find(call=>call.sql.includes('INSERT INTO presence_operational_state'))!.sql,
      /\$5::timestamptz\+\(COALESCE/);
    const outbox=calls.find(call=>call.sql.includes('INSERT INTO presence_close_outbox'))!;
    assert.equal(JSON.parse(outbox.values[1]).lastDetectionAt,input.lastDetectionAt);
    assert.match(outbox.sql,/ON CONFLICT \(session_id\) DO NOTHING/);
    assert.equal(calls.at(-1)!.sql,'COMMIT'); assert.deepEqual(released,[false]);
    assert.ok(calls.findIndex(call=>call.sql.includes('presence_operational_state'))<calls.indexOf(outbox));
  } finally {db.connect=original;}
});

test('a concurrent newer detection or an already closed session creates no outbox or state update', async () => {
  const original=db.connect;const calls:string[]=[];
  (db as any).connect=async()=>({query:async(sql:string)=>{calls.push(sql);return {rows:[],rowCount:0};},release(){}});
  try {
    assert.equal(await persistCanonicalPresenceClose(input),false);
    assert.equal(calls.at(-1),'COMMIT');
    assert.equal(calls.some(sql=>sql.includes('INSERT INTO presence_close_outbox')),false);
    assert.equal(calls.some(sql=>sql.includes('INSERT INTO presence_operational_state')),false);
  } finally {db.connect=original;}
});

test('an outbox failure destroys the transaction connection without committing a partial canonical close', async () => {
  const original=db.connect;const calls:string[]=[];const released:boolean[]=[];
  (db as any).connect=async()=>({query:async(sql:string)=>{
    calls.push(sql);if(sql.includes('INSERT INTO presence_close_outbox'))throw new Error('simulated_outbox_failure');
    return {rows:sql.startsWith('UPDATE cold_room_sessions')?[closed]:[],rowCount:1};
  },release:(destroy=false)=>released.push(destroy)});
  try {
    await assert.rejects(persistCanonicalPresenceClose(input),/simulated_outbox_failure/);
    assert.equal(calls.includes('COMMIT'),false);assert.deepEqual(released,[true]);
  } finally {db.connect=original;}
});

test('a blocked canonical query ends within its local budget and destroys the connection once', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const original=db.connect;const released:boolean[]=[];
  (db as any).connect=async()=>({query:()=>new Promise(()=>{}),release:(destroy=false)=>released.push(destroy)});
  try {
    const pending=persistCanonicalPresenceClose(input);
    const rejected=assert.rejects(pending,/controlled_presence_database_timeout/);
    await Promise.resolve();t.mock.timers.tick(2000);await rejected;
    assert.deepEqual(released,[true]);
  } finally {db.connect=original;}
});
