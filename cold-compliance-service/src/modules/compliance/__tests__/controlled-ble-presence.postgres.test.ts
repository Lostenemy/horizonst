import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../../db/pool';
import { beginControlledPresenceOperation, finishControlledPresenceOperation } from '../../tag-control/infrastructure/controlled-presence.repository';
import { markBleSessionActive, markBleSessionDisconnected } from '../../tag-control/infrastructure/ble-session.repository';
import { closeStaleSessions, processComplianceRules } from '../compliance.service';
import { env } from '../../../config/env';
import { persistCanonicalPresenceClose } from '../presence-close.repository';
import { processOneCloseEffect } from '../presence-close-effects';

const databaseUrl = process.env.CONTROLLED_B5_TEST_DATABASE_URL;
const enabled = process.env.CONTROLLED_B5_ALLOW_DATABASE_TESTS === 'true' && Boolean(databaseUrl);

test('PostgreSQL 15: additive migration, session locking, fixed deadlines, concurrency and late ownership', {
  skip: enabled ? false : 'requires an explicitly disposable loopback PostgreSQL 15 test database'
}, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/horizonst_test_[a-z0-9_]+$/i);
  const schema = `controlled_b5_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  const pool = new Pool({ connectionString: databaseUrl, max: 3, options: `-c search_path=${schema}`, connectionTimeoutMillis: 2000 });
  const originalConnect = db.connect;
  const originalQuery = db.query;
  let owned = false;
  try {
    assert.equal(env.PRESENCE_EXIT_TIMEOUT_MS,30000);
    assert.equal(env.PRESENCE_SWEEP_INTERVAL_MS,10000);
    assert.match((await admin.query("SELECT current_setting('server_version') AS version")).rows[0].version, /^15\./);
    await admin.query(`CREATE SCHEMA ${schema}`); owned = true;
    const files = readdirSync(join(process.cwd(), 'migrations')).filter(name => name.endsWith('.sql')).sort();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const file of files) await client.query(readFileSync(join(process.cwd(), 'migrations', file), 'utf8'));
      await client.query('COMMIT');
    } finally { client.release(); }
    const tag = randomUUID(); const session = randomUUID(); const company = randomUUID(); const gateway = randomUUID();
    await pool.query("INSERT INTO tags(id,tag_uid,hardware_device_id) VALUES($1,'c65b52531bdc',13)", [tag]);
    await pool.query("INSERT INTO gateways(id,gateway_mac,hardware_gateway_id) VALUES($1,'142b2fe271b4',41)", [gateway]);
    await pool.query("INSERT INTO cold_room_sessions(id,tag_id,hardware_device_id,started_at) VALUES($1,$2,13,NOW()-INTERVAL '1 minute')", [session,tag]);
    await pool.query(`INSERT INTO tag_gateway_presence_state(tag_uid,gateway_mac,hardware_device_id,hardware_gateway_id,last_seen_at,last_presence_at)
      VALUES('c65b52531bdc','142b2fe271b4',13,41,NOW(),NOW())`);
    (db as any).connect = () => pool.connect();
    (db as any).query = pool.query.bind(pool);
    const results = await Promise.all([1,2].map(index => beginControlledPresenceOperation({ tagId: tag, hardwareDeviceId: 13,
      companyId: company, alertId: `test-${index}` })));
    assert.equal(results.filter(value => value === 'busy').length, 1);
    const operation = results.find(value => value && value !== 'busy'); assert.ok(operation && operation !== 'busy');
    const saved = (await pool.query('SELECT * FROM controlled_b5_presence_operations WHERE session_id=$1 AND hardware_device_id=13',[session])).rows[0];
    assert.equal(saved.session_id, session); assert.equal(saved.company_id, company);
    assert.equal(saved.hard_deadline.getTime() - saved.started_at.getTime(), 120000);
    assert.equal((await pool.query(`SELECT protect_until=last_presence_at+INTERVAL '60 seconds' AS exact
      FROM controlled_b5_presence_operations op JOIN tag_gateway_presence_state ps ON ps.hardware_device_id=op.hardware_device_id
      WHERE op.session_id=$1 AND op.hardware_device_id=13 AND ps.hardware_gateway_id=41`,[session])).rows[0].exact,true);
    await assert.rejects(pool.query("UPDATE controlled_b5_presence_operations SET protect_until = hard_deadline + INTERVAL '1 second' WHERE session_id=$1 AND hardware_device_id=13",[session]), { code: '23514' });
    await assert.rejects(pool.query('UPDATE controlled_b5_presence_operations SET session_id = $1 WHERE session_id=$2 AND hardware_device_id=13', [randomUUID(),session]), { code: '23503' });
    await pool.query("UPDATE tag_gateway_presence_state SET last_presence_at = NOW() - INTERVAL '31 seconds' WHERE hardware_device_id=13 AND hardware_gateway_id=41");
    await closeStaleSessions();
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE id=$1 AND hardware_device_id=13 AND ended_at IS NULL',[session])).rows[0].count, 1);
    await markBleSessionActive({ tagId: tag, hardwareDeviceId: 13, tagUid: 'c65b52531bdc', gatewayMac: '142b2fe271b4', operationId: operation.operationId });
    const lease = (await pool.query('SELECT lease_expires_at FROM ble_alarm_sessions WHERE tag_id=$1 AND hardware_device_id=13',[tag])).rows[0];
    assert.ok(lease.lease_expires_at <= saved.hard_deadline);
    await markBleSessionDisconnected({ tagId: tag, hardwareDeviceId: 13, operationId: randomUUID(), confirmed: true });
    assert.equal((await pool.query('SELECT is_active FROM ble_alarm_sessions WHERE tag_id=$1 AND hardware_device_id=13',[tag])).rows[0].is_active, true);
    await finishControlledPresenceOperation(operation, 'unverified');
    await finishControlledPresenceOperation({ ...operation, operationId: randomUUID() }, 'failed');
    const finished = (await pool.query('SELECT outcome, protect_until, hard_deadline FROM controlled_b5_presence_operations WHERE session_id=$1 AND hardware_device_id=13',[session])).rows[0];
    assert.equal(finished.outcome, 'unverified'); assert.ok(finished.protect_until <= finished.hard_deadline);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE id=$1 AND hardware_device_id=13 AND ended_at IS NULL',[session])).rows[0].count, 1);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ble_alarm_sessions WHERE tag_id=$1 AND hardware_device_id=13',[tag])).rows[0].count, 1);
    // A restart needs no reconciliation to expire protection: the reader uses the persisted time predicate.
    await pool.query(`UPDATE controlled_b5_presence_operations SET started_at = NOW()-INTERVAL '121 seconds',
      hard_deadline=NOW()-INTERVAL '1 second', protect_until=NOW()-INTERVAL '1 second'
      WHERE session_id=$1 AND hardware_device_id=13`,[session]);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM controlled_b5_presence_operations WHERE session_id=$1 AND hardware_device_id=13 AND protect_until > clock_timestamp()',[session])).rows[0].count, 0);
    await closeStaleSessions();
    const closed = (await pool.query('SELECT ended_at, close_event_id, duration_seconds FROM cold_room_sessions WHERE id=$1 AND hardware_device_id=13',[session])).rows[0];
    assert.ok(closed.ended_at); assert.equal(closed.close_event_id, null); assert.ok(closed.duration_seconds < 35);

    // Reuse only this owned fixture. Force six fractional digits, independently
    // of pg's Date parser and of the machine's clock precision.
    const resetExpired = async () => {
      await pool.query('DELETE FROM controlled_b5_presence_operations WHERE session_id=$1 AND hardware_device_id=13',[session]);
      await pool.query('DELETE FROM presence_close_outbox WHERE session_id=$1',[session]);
      const reset=await pool.query("UPDATE cold_room_sessions SET ended_at=NULL, duration_seconds=NULL, close_event_id=NULL, started_at=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1 AND hardware_device_id=13",[session]);
      assert.equal(reset.rowCount,1);
      const row = (await pool.query(`UPDATE tag_gateway_presence_state SET
        last_presence_at = date_trunc('second',clock_timestamp())-INTERVAL '31 seconds'+INTERVAL '0.123456 seconds'
        WHERE hardware_device_id=13 AND hardware_gateway_id=41
        RETURNING last_presence_at::text AS exact, last_presence_at AS lossy`)).rows[0];
      assert.ok(row);
      assert.equal((await pool.query('SELECT $1::timestamptz > $2::timestamptz AS lost', [row.exact,row.lossy])).rows[0].lost, true);
      return row.exact as string;
    };
    const isOpen = async () => {
      const result=await pool.query('SELECT ended_at IS NULL AS open FROM cold_room_sessions WHERE id=$1 AND hardware_device_id=13',[session]);
      assert.equal(result.rowCount,1);return result.rows[0].open;
    };
    const textCloseInput = async (reason:'event'|'timeout',closeEventId:string|null) => {
      const exact=await resetExpired();
      await pool.query(`INSERT INTO presence_operational_state(tag_id,hardware_device_id,inside,in_alarm)
        VALUES($1,13,TRUE,TRUE) ON CONFLICT(hardware_device_id) WHERE hardware_device_id IS NOT NULL
        DO UPDATE SET inside=TRUE,in_alarm=TRUE`,[tag]);
      const ended=(await pool.query("SELECT ($1::timestamptz+INTERVAL '30 seconds')::text AS at",[exact])).rows[0].at;
      return {sessionId:session,endedAt:ended,lastDetectionAt:exact,reason,closeEventId,timeoutMs:30000,
        limits:{preAlertMinutes:110,continuousMinutes:120,dailyMinutes:360}};
    };
    const assertTextClose = async (input:Awaited<ReturnType<typeof textCloseInput>>,expected:string|null) => {
      const result=(await pool.query(`SELECT s.ended_at=$2::timestamptz AS exact_end,
        pg_typeof(s.close_event_id)::text AS event_type,s.close_event_id,pos.inside,
        pos.grace_started_at=$3::timestamptz AS exact_grace,job.session_id AS job_id,
        job.payload->>'lastDetectionAt' AS detection,job.completed_at
        FROM cold_room_sessions s JOIN presence_operational_state pos ON pos.hardware_device_id=s.hardware_device_id
        JOIN presence_close_outbox job ON job.session_id=s.id WHERE s.id=$1`,
      [session,input.endedAt,input.lastDetectionAt])).rows[0];
      assert.ok(result);assert.equal(result.event_type,'text');assert.equal(result.close_event_id,expected);
      assert.equal(result.exact_end,true);assert.equal(result.inside,false);assert.equal(result.exact_grace,true);
      assert.equal(result.job_id,session);assert.equal(result.detection,input.lastDetectionAt);
      assert.equal(result.completed_at,null);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM presence_close_outbox WHERE session_id=$1',[session])).rows[0].n,1);
    };
    await t.test('TEXT event frontier: timeout with null closes session, outside state and outbox atomically',async()=>{
      const input=await textCloseInput('timeout',null);
      assert.equal(await persistCanonicalPresenceClose(input),true);
      await assertTextClose(input,null);
    });
    await t.test('TEXT event frontier: explicit non-UUID identifier is stored unchanged and terminal close is not overwritten',async()=>{
      const input=await textCloseInput('event','fixture/gateway:exit#packet-42');
      assert.equal(await persistCanonicalPresenceClose(input),true);
      await assertTextClose(input,input.closeEventId);
      assert.equal(await persistCanonicalPresenceClose({...input,closeEventId:'fixture/obsolete-exit'}),false);
      await assertTextClose(input,input.closeEventId);
    });
    await t.test('TEXT event frontier: null input preserves an existing textual identifier for timeout and explicit close',async()=>{
      for(const reason of ['timeout','event'] as const){
        const input=await textCloseInput(reason,null);
        await pool.query('UPDATE cold_room_sessions SET close_event_id=$2::text WHERE id=$1',
          [session,'fixture/historical-exit:preserved']);
        assert.equal(await persistCanonicalPresenceClose(input),true);
        await assertTextClose(input,'fixture/historical-exit:preserved');
      }
    });
    await t.test('TEXT event frontier: outbox failure rolls back explicit identifier, session and outside state',async()=>{
      const input=await textCloseInput('event','fixture/new-exit:must-rollback');
      await pool.query('UPDATE cold_room_sessions SET close_event_id=$2::text WHERE id=$1',[session,'fixture/prior-exit']);
      await pool.query('ALTER TABLE presence_close_outbox ADD CONSTRAINT fixture_reject_text_job CHECK (FALSE) NOT VALID');
      try{
        await assert.rejects(persistCanonicalPresenceClose(input),{code:'23514'});
        const row=(await pool.query(`SELECT s.ended_at,s.duration_seconds,s.close_event_id,pos.inside,
          (SELECT COUNT(*)::int FROM presence_close_outbox WHERE session_id=s.id) AS jobs
          FROM cold_room_sessions s JOIN presence_operational_state pos ON pos.hardware_device_id=s.hardware_device_id
          WHERE s.id=$1`,[session])).rows[0];
        assert.deepEqual(row,{ended_at:null,duration_seconds:null,close_event_id:'fixture/prior-exit',inside:true,jobs:0});
      }finally{await pool.query('ALTER TABLE presence_close_outbox DROP CONSTRAINT fixture_reject_text_job');}
    });
    // Inject a committed concurrent event after the sweep snapshot but before
    // its locking UPDATE. All comparisons and mutations below run in real PG.
    const sweepWithConcurrent = async (change: () => Promise<void>) => {
      (db as any).connect = async () => {
        const client = await pool.connect(); const query = client.query.bind(client);
        const wrapped = Object.create(client);
        wrapped.release = client.release.bind(client);
        wrapped.query = async (sql: string, params?: unknown[]) => {
          const result = await query(sql, params);
          if (sql.includes('AS last_seen_at')) await change();
          return result;
        };
        return wrapped;
      };
      try { await closeStaleSessions(); } finally { (db as any).connect = () => pool.connect(); }
    };
    await t.test('same microsecond detection closes after expiry and confirmation preserves its fractional boundary', async () => {
      const exact = await resetExpired(); await closeStaleSessions(); assert.equal(await isOpen(), false);
      const result = (await pool.query(`SELECT ended_at = $1::timestamptz + INTERVAL '30 seconds' AS exact_end,
        duration_seconds = FLOOR(EXTRACT(EPOCH FROM ($1::timestamptz-started_at)))::int AS exact_duration
        FROM cold_room_sessions WHERE id=$2 AND hardware_device_id=13`, [exact,session])).rows[0];
      assert.equal(result.exact_end,true); assert.equal(result.exact_duration,true);
    });
    await t.test('a truly later detection in the same millisecond rejects the obsolete close', async () => {
      const exact = await resetExpired();
      await sweepWithConcurrent(async () => { await pool.query("UPDATE tag_gateway_presence_state SET last_presence_at=$1::timestamptz+INTERVAL '1 microsecond' WHERE hardware_device_id=13 AND hardware_gateway_id=41",[exact]); });
      assert.equal(await isOpen(),true);
      await closeStaleSessions(); assert.equal(await isOpen(),false);
    });
    await t.test('a concurrent fresh detection prevents closure', async () => {
      await resetExpired();
      await sweepWithConcurrent(async () => { await pool.query('UPDATE tag_gateway_presence_state SET last_presence_at=clock_timestamp() WHERE hardware_device_id=13 AND hardware_gateway_id=41'); });
      assert.equal(await isOpen(),true);
    });
    await t.test('concurrent claim takes the session lock and prevents obsolete closure until exact expiry', async () => {
      await resetExpired(); let claim: any;
      await sweepWithConcurrent(async () => {
        await pool.query('UPDATE tag_gateway_presence_state SET last_presence_at=clock_timestamp() WHERE hardware_device_id=13 AND hardware_gateway_id=41');
        // Use the real pool directly to avoid reinjecting this callback.
        const intercept = db.connect; (db as any).connect = () => pool.connect();
        try { claim = await beginControlledPresenceOperation({tagId:tag,hardwareDeviceId:13,companyId:company,alertId:'concurrent-claim'}); }
        finally { db.connect = intercept; }
      });
      assert.ok(claim && claim !== 'busy'); assert.equal(await isOpen(),true);
      await pool.query("UPDATE tag_gateway_presence_state SET last_presence_at=clock_timestamp()-INTERVAL '31 seconds' WHERE hardware_device_id=13 AND hardware_gateway_id=41");
      await closeStaleSessions(); assert.equal(await isOpen(),true);
      // Derive all constraint boundaries from one PostgreSQL instant, preserving microseconds.
      await pool.query(`WITH fixture_clock AS MATERIALIZED (SELECT clock_timestamp() AS instant)
        UPDATE controlled_b5_presence_operations
        SET started_at=fixture_clock.instant-INTERVAL '121 seconds',
            hard_deadline=fixture_clock.instant-INTERVAL '1 second',
            protect_until=fixture_clock.instant-INTERVAL '1 second'
        FROM fixture_clock WHERE session_id=$1 AND hardware_device_id=13`,[session]);
      await closeStaleSessions(); assert.equal(await isOpen(),false);
      await finishControlledPresenceOperation({...claim,operationId:randomUUID()},'failed');
      assert.equal((await pool.query('SELECT outcome FROM controlled_b5_presence_operations WHERE session_id=$1 AND hardware_device_id=13',[session])).rows[0].outcome,'running');
    });
    await t.test('canonical close atomically stores outside state and an idempotent durable job; restart applies effects once',async()=>{
      const exact=await resetExpired();
      await pool.query(`INSERT INTO presence_operational_state(tag_id,hardware_device_id,inside,in_alarm)
        VALUES($1,13,TRUE,TRUE) ON CONFLICT(hardware_device_id) WHERE hardware_device_id IS NOT NULL
        DO UPDATE SET inside=TRUE,in_alarm=TRUE`,[tag]);
      await closeStaleSessions();assert.equal(await isOpen(),false);
      const saved=(await pool.query(`SELECT pos.inside,pos.grace_started_at=$1::timestamptz AS exact_grace,
        job.payload->>'lastDetectionAt' AS detection,job.completed_at FROM presence_operational_state pos
        JOIN presence_close_outbox job ON job.session_id=$2 WHERE pos.hardware_device_id=13`,[exact,session])).rows[0];
      assert.equal(saved.inside,false);assert.equal(saved.exact_grace,true);assert.equal(saved.detection,exact);
      assert.equal(saved.completed_at,null);
      // Restart loses all memory; SQL work is still claimable and completion is transactional.
      const before=(await pool.query('SELECT COUNT(*)::int AS n FROM workday_accumulators')).rows[0].n;
      assert.equal(await processOneCloseEffect(),true);assert.equal(await processOneCloseEffect(),false);
      const after=(await pool.query('SELECT COUNT(*)::int AS n FROM workday_accumulators')).rows[0].n;
      assert.ok(after>=before);assert.ok((await pool.query('SELECT completed_at FROM presence_close_outbox WHERE session_id=$1',[session])).rows[0].completed_at);
      const input={sessionId:session,endedAt:exact,lastDetectionAt:exact,reason:'timeout' as const,
        closeEventId:null,timeoutMs:30000,limits:{preAlertMinutes:110,continuousMinutes:120,dailyMinutes:360}};
      assert.equal(await persistCanonicalPresenceClose(input),false);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM presence_close_outbox WHERE session_id=$1',[session])).rows[0].n,1);
    });
    await t.test('outbox rejection rolls back session and operational state together',async()=>{
      const exact=await resetExpired();
      await pool.query('UPDATE presence_operational_state SET inside=TRUE WHERE hardware_device_id=13');
      await pool.query('ALTER TABLE presence_close_outbox ADD CONSTRAINT fixture_reject_job CHECK (FALSE) NOT VALID');
      try{
        const ended=(await pool.query("SELECT ($1::timestamptz+INTERVAL '30 seconds')::text AS end",[exact])).rows[0].end;
        await assert.rejects(persistCanonicalPresenceClose({sessionId:session,endedAt:ended,lastDetectionAt:exact,
          closeEventId:null,reason:'timeout',timeoutMs:30000,limits:{preAlertMinutes:110,continuousMinutes:120,dailyMinutes:360}}),{code:'23514'});
        assert.equal(await isOpen(),true);
        assert.equal((await pool.query('SELECT inside FROM presence_operational_state WHERE hardware_device_id=13')).rows[0].inside,true);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM presence_close_outbox WHERE session_id=$1',[session])).rows[0].n,0);
      }finally{await pool.query('ALTER TABLE presence_close_outbox DROP CONSTRAINT fixture_reject_job');}
    });
    await t.test('PostgreSQL protection boundaries retain plus/minus one microsecond and expire while physical deadline remains live',async()=>{
      await resetExpired();
      await pool.query("UPDATE cold_room_sessions SET started_at=clock_timestamp()-INTERVAL '2 minutes' WHERE id=$1 AND hardware_device_id=13",[session]);
      await pool.query(`WITH instant AS MATERIALIZED(SELECT clock_timestamp() AS at)
        UPDATE tag_gateway_presence_state SET last_presence_at=instant.at-INTERVAL '61 seconds' FROM instant
        WHERE hardware_device_id=13 AND hardware_gateway_id=41`);
      const detection=(await pool.query('SELECT last_presence_at::text AS at FROM tag_gateway_presence_state WHERE hardware_device_id=13 AND hardware_gateway_id=41')).rows[0].at;
      await pool.query(`INSERT INTO controlled_b5_presence_operations
        (hardware_device_id,operation_id,session_id,company_id,alert_reference,started_at,hard_deadline,protect_until,outcome)
        VALUES(13,$1,$2,$3,'finite',$4::timestamptz,$4::timestamptz+INTERVAL '120 seconds',
          $4::timestamptz+INTERVAL '60 seconds','running')`,[randomUUID(),session,company,detection]);
      const boundaries=(await pool.query(`SELECT
        protect_until>($1::timestamptz+INTERVAL '60 seconds'-INTERVAL '1 microsecond') AS before,
        protect_until>($1::timestamptz+INTERVAL '60 seconds') AS exact,
        protect_until>($1::timestamptz+INTERVAL '60 seconds'+INTERVAL '1 microsecond') AS after,
        hard_deadline>clock_timestamp() AS physical_live FROM controlled_b5_presence_operations
        WHERE session_id=$2 AND hardware_device_id=13`,[detection,session])).rows[0];
      assert.deepEqual(boundaries,{before:true,exact:false,after:false,physical_live:true});
      await closeStaleSessions();assert.equal(await isOpen(),false);
      assert.equal((await pool.query('SELECT outcome FROM controlled_b5_presence_operations WHERE session_id=$1 AND hardware_device_id=13',[session])).rows[0].outcome,'running');
    });
    await t.test('reentry strictly after the microsecond confirmation is not discarded by Date truncation', async () => {
      await resetExpired(); await closeStaleSessions();
      const next = (await pool.query("SELECT (ended_at+INTERVAL '1 microsecond')::text AS timestamp FROM cold_room_sessions WHERE id=$1 AND hardware_device_id=13",[session])).rows[0].timestamp;
      const event = {eventId:randomUUID(),tagId:'c65b52531bdc',gatewayMac:'142b2fe271b4',eventType:'heartbeat' as const,
        timestamp:next,rssi:-60,rawPayload:{}};
      const identity = {source:'central' as const,tagMac:'c65b52531bdc',gatewayMac:'142b2fe271b4',hardwareDeviceId:13,
        hardwareGatewayId:41,device:null,gateway:null};
      const prior = (await pool.query("SELECT (ended_at-INTERVAL '1 microsecond')::text AS timestamp FROM cold_room_sessions WHERE id=$1 AND hardware_device_id=13",[session])).rows[0].timestamp;
      await processComplianceRules({...event,eventId:randomUUID(),timestamp:prior},identity);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE tag_id=$1 AND hardware_device_id=13 AND ended_at IS NULL',[tag])).rows[0].count,0);
      await processComplianceRules(event,identity);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE tag_id=$1 AND hardware_device_id=13 AND ended_at IS NULL',[tag])).rows[0].count,1);
      // The reentry owns a different session. Finish it explicitly without
      // deleting its row or asking resetExpired to rewrite another case.
      const reentered=(await pool.query('SELECT id FROM cold_room_sessions WHERE tag_id=$1 AND hardware_device_id=13 AND ended_at IS NULL',[tag])).rows[0].id;
      assert.notEqual(reentered,session);
      const reentryEnd=(await pool.query("SELECT ($1::timestamptz+INTERVAL '1 microsecond')::text AS at",[next])).rows[0].at;
      assert.equal(await persistCanonicalPresenceClose({sessionId:reentered,endedAt:reentryEnd,lastDetectionAt:next,
        closeEventId:'fixture/reentry-case:exit',reason:'event',timeoutMs:30000,
        limits:{preAlertMinutes:110,continuousMinutes:120,dailyMinutes:360}}),true);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE tag_id=$1 AND hardware_device_id=13 AND ended_at IS NULL',[tag])).rows[0].count,0);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE id=$1 AND ended_at IS NOT NULL',[reentered])).rows[0].count,1);
    });
    await t.test('measured real PostgreSQL: 18 eligible sessions including a lock held over 2s recover before detection plus 90s',async()=>{
      const ids:string[]=[];
      for(let i=0;i<18;i++){
        const tagId=randomUUID();const sessionId=randomUUID();ids.push(sessionId);
        const mac=(0xabc000000000+i).toString(16);const hardwareId=1000+i;
        await pool.query('INSERT INTO tags(id,tag_uid,hardware_device_id) VALUES($1,$2,$3)',[tagId,mac,hardwareId]);
        await pool.query(`INSERT INTO cold_room_sessions(id,tag_id,hardware_device_id,started_at)
          VALUES($1,$2,$3,clock_timestamp()-INTERVAL '2 minutes')`,[sessionId,tagId,hardwareId]);
        await pool.query(`INSERT INTO tag_gateway_presence_state
          (tag_uid,gateway_mac,hardware_device_id,hardware_gateway_id,last_seen_at,last_presence_at)
          VALUES($1,'142b2fe271b4',$2,41,clock_timestamp(),clock_timestamp()-INTERVAL '69.5 seconds')`,[mac,hardwareId]);
        await pool.query(`INSERT INTO controlled_b5_presence_operations
          (hardware_device_id,operation_id,session_id,company_id,alert_reference,started_at,hard_deadline,protect_until,outcome)
          SELECT $1,$2,$3,$4,'load',last_presence_at,last_presence_at+INTERVAL '120 seconds',
            last_presence_at+INTERVAL '60 seconds','running' FROM tag_gateway_presence_state WHERE hardware_device_id=$1 AND hardware_gateway_id=41`,
        [hardwareId,randomUUID(),sessionId,company]);
      }
      const blocker=await pool.connect();const started=Date.now();let released=false;
      try{
        await blocker.query('BEGIN');await blocker.query('SELECT id FROM cold_room_sessions WHERE id=$1 FOR UPDATE',[ids[0]]);
        await closeStaleSessions();
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM cold_room_sessions WHERE id=ANY($1::uuid[]) AND ended_at IS NOT NULL',[ids])).rows[0].n,17);
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,2100-(Date.now()-started))));
        await blocker.query('COMMIT');blocker.release();released=true;
        await closeStaleSessions();
        const measured=(await pool.query(`SELECT count(*)::int AS closed,
          bool_and(clock_timestamp()<ps.last_presence_at+INTERVAL '90 seconds') AS all_visible_before90,
          MAX(EXTRACT(EPOCH FROM (clock_timestamp()-ps.last_presence_at))*1000) AS upper_commit_ms
          FROM cold_room_sessions s JOIN tag_gateway_presence_state ps ON ps.hardware_device_id=s.hardware_device_id AND ps.hardware_gateway_id=41
          WHERE s.id=ANY($1::uuid[]) AND s.ended_at IS NOT NULL`,[ids])).rows[0];
        assert.equal(measured.closed,18);assert.equal(measured.all_visible_before90,true);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM presence_close_outbox WHERE session_id=ANY($1::uuid[])',[ids])).rows[0].n,18);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM presence_operational_state WHERE hardware_device_id BETWEEN 1000 AND 1017 AND inside=FALSE')).rows[0].n,18);
        t.diagnostic(JSON.stringify({database:'PostgreSQL15',eligible:18,heldLockOverMs:2100,upperCommitMs:Number(measured.upper_commit_ms)}));
      }finally{if(!released){await blocker.query('ROLLBACK').catch(()=>undefined);blocker.release();}}
    });
    await t.test('a packet transaction holding the shared session lock prevents closure; committed fresh detection defeats the stale snapshot',async()=>{
      // Use only the original fixture; load-test sessions are already closed.
      // jsonb keeps timestamp fractions intact, unlike pg's Date parser.
      const otherFixtures=async()=>(await pool.query(`SELECT jsonb_build_object(
        'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM cold_room_sessions s WHERE s.id<>$1),
        'detections',(SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.hardware_device_id,ps.hardware_gateway_id)
          FROM tag_gateway_presence_state ps WHERE ps.hardware_device_id<>13 OR ps.hardware_gateway_id<>41),
        'operations',(SELECT jsonb_agg(to_jsonb(op) ORDER BY op.hardware_device_id)
          FROM controlled_b5_presence_operations op WHERE op.session_id<>$1 OR op.hardware_device_id<>13),
        'jobs',(SELECT jsonb_agg(to_jsonb(job) ORDER BY job.session_id) FROM presence_close_outbox job WHERE job.session_id<>$1),
        'states',(SELECT jsonb_agg(to_jsonb(pos) ORDER BY pos.hardware_device_id)
          FROM presence_operational_state pos WHERE pos.hardware_device_id<>13)) AS snapshot`,[session])).rows[0].snapshot;
      const before=await otherFixtures();
      await resetExpired();
      assert.deepEqual(await otherFixtures(),before);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM cold_room_sessions WHERE hardware_device_id BETWEEN 1000 AND 1017 AND ended_at IS NOT NULL')).rows[0].n,18);
      const packet=await pool.connect();
      try{
        await packet.query('BEGIN');await packet.query('SELECT id FROM cold_room_sessions WHERE id=$1 FOR SHARE',[session]);
        await closeStaleSessions();assert.equal(await isOpen(),true);
        await packet.query('UPDATE tag_gateway_presence_state SET last_presence_at=clock_timestamp() WHERE hardware_device_id=13 AND hardware_gateway_id=41');
        await packet.query('COMMIT');
        await closeStaleSessions();assert.equal(await isOpen(),true);
        assert.deepEqual(await otherFixtures(),before);
      }finally{await packet.query('ROLLBACK').catch(()=>undefined);packet.release();}
    });
  } finally {
    db.connect = originalConnect; db.query = originalQuery; await pool.end();
    if (owned) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
