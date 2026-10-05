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
    const saved = (await pool.query('SELECT * FROM controlled_b5_presence_operations')).rows[0];
    assert.equal(saved.session_id, session); assert.equal(saved.company_id, company);
    assert.equal(saved.hard_deadline.getTime() - saved.started_at.getTime(), 120000);
    await assert.rejects(pool.query("UPDATE controlled_b5_presence_operations SET protect_until = hard_deadline + INTERVAL '1 second'"), { code: '23514' });
    await assert.rejects(pool.query('UPDATE controlled_b5_presence_operations SET session_id = $1', [randomUUID()]), { code: '23503' });
    await pool.query("UPDATE tag_gateway_presence_state SET last_presence_at = NOW() - INTERVAL '31 seconds'");
    await closeStaleSessions();
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE ended_at IS NULL')).rows[0].count, 1);
    await markBleSessionActive({ tagId: tag, hardwareDeviceId: 13, tagUid: 'c65b52531bdc', gatewayMac: '142b2fe271b4', operationId: operation.operationId });
    const lease = (await pool.query('SELECT lease_expires_at FROM ble_alarm_sessions')).rows[0];
    assert.ok(lease.lease_expires_at <= saved.hard_deadline);
    await markBleSessionDisconnected({ tagId: tag, hardwareDeviceId: 13, operationId: randomUUID(), confirmed: true });
    assert.equal((await pool.query('SELECT is_active FROM ble_alarm_sessions')).rows[0].is_active, true);
    await finishControlledPresenceOperation(operation, 'unverified');
    await finishControlledPresenceOperation({ ...operation, operationId: randomUUID() }, 'failed');
    const finished = (await pool.query('SELECT outcome, protect_until, hard_deadline FROM controlled_b5_presence_operations')).rows[0];
    assert.equal(finished.outcome, 'unverified'); assert.ok(finished.protect_until <= finished.hard_deadline);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE ended_at IS NULL')).rows[0].count, 1);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ble_alarm_sessions')).rows[0].count, 1);
    // A restart needs no reconciliation to expire protection: the reader uses the persisted time predicate.
    await pool.query(`UPDATE controlled_b5_presence_operations SET started_at = NOW()-INTERVAL '121 seconds',
      hard_deadline=NOW()-INTERVAL '1 second', protect_until=NOW()-INTERVAL '1 second'`);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM controlled_b5_presence_operations WHERE protect_until > clock_timestamp()')).rows[0].count, 0);
    await closeStaleSessions();
    const closed = (await pool.query('SELECT ended_at, close_event_id, duration_seconds FROM cold_room_sessions')).rows[0];
    assert.ok(closed.ended_at); assert.equal(closed.close_event_id, null); assert.ok(closed.duration_seconds < 35);

    // Reuse only this owned fixture. Force six fractional digits, independently
    // of pg's Date parser and of the machine's clock precision.
    const resetExpired = async () => {
      await pool.query('DELETE FROM controlled_b5_presence_operations');
      await pool.query("UPDATE cold_room_sessions SET ended_at=NULL, duration_seconds=NULL, started_at=clock_timestamp()-INTERVAL '1 minute'");
      const row = (await pool.query(`UPDATE tag_gateway_presence_state SET
        last_presence_at = date_trunc('second',clock_timestamp())-INTERVAL '31 seconds'+INTERVAL '0.123456 seconds'
        RETURNING last_presence_at::text AS exact, last_presence_at AS lossy`)).rows[0];
      assert.equal((await pool.query('SELECT $1::timestamptz > $2::timestamptz AS lost', [row.exact,row.lossy])).rows[0].lost, true);
      return row.exact as string;
    };
    const isOpen = async () => (await pool.query('SELECT ended_at IS NULL AS open FROM cold_room_sessions')).rows[0].open;
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
        FROM cold_room_sessions`, [exact])).rows[0];
      assert.equal(result.exact_end,true); assert.equal(result.exact_duration,true);
    });
    await t.test('a truly later detection in the same millisecond rejects the obsolete close', async () => {
      const exact = await resetExpired();
      await sweepWithConcurrent(async () => { await pool.query("UPDATE tag_gateway_presence_state SET last_presence_at=$1::timestamptz+INTERVAL '1 microsecond'",[exact]); });
      assert.equal(await isOpen(),true);
      await closeStaleSessions(); assert.equal(await isOpen(),false);
    });
    await t.test('a concurrent fresh detection prevents closure', async () => {
      await resetExpired();
      await sweepWithConcurrent(async () => { await pool.query('UPDATE tag_gateway_presence_state SET last_presence_at=clock_timestamp()'); });
      assert.equal(await isOpen(),true);
    });
    await t.test('concurrent claim takes the session lock and prevents obsolete closure until exact expiry', async () => {
      await resetExpired(); let claim: any;
      await sweepWithConcurrent(async () => {
        await pool.query('UPDATE tag_gateway_presence_state SET last_presence_at=clock_timestamp()');
        // Use the real pool directly to avoid reinjecting this callback.
        const intercept = db.connect; (db as any).connect = () => pool.connect();
        try { claim = await beginControlledPresenceOperation({tagId:tag,hardwareDeviceId:13,companyId:company,alertId:'concurrent-claim'}); }
        finally { db.connect = intercept; }
      });
      assert.ok(claim && claim !== 'busy'); assert.equal(await isOpen(),true);
      await pool.query("UPDATE tag_gateway_presence_state SET last_presence_at=clock_timestamp()-INTERVAL '31 seconds'");
      await closeStaleSessions(); assert.equal(await isOpen(),true);
      // Derive all constraint boundaries from one PostgreSQL instant, preserving microseconds.
      await pool.query(`WITH fixture_clock AS MATERIALIZED (SELECT clock_timestamp() AS instant)
        UPDATE controlled_b5_presence_operations
        SET started_at=fixture_clock.instant-INTERVAL '121 seconds',
            hard_deadline=fixture_clock.instant-INTERVAL '1 second',
            protect_until=fixture_clock.instant-INTERVAL '1 second'
        FROM fixture_clock`);
      await closeStaleSessions(); assert.equal(await isOpen(),false);
      await finishControlledPresenceOperation({...claim,operationId:randomUUID()},'failed');
      assert.equal((await pool.query('SELECT outcome FROM controlled_b5_presence_operations')).rows[0].outcome,'running');
    });
    await t.test('reentry strictly after the microsecond confirmation is not discarded by Date truncation', async () => {
      await resetExpired(); await closeStaleSessions();
      const next = (await pool.query("SELECT (ended_at+INTERVAL '1 microsecond')::text AS timestamp FROM cold_room_sessions")).rows[0].timestamp;
      const event = {eventId:randomUUID(),tagId:'c65b52531bdc',gatewayMac:'142b2fe271b4',eventType:'heartbeat' as const,
        timestamp:next,rssi:-60,rawPayload:{}};
      const identity = {source:'central' as const,tagMac:'c65b52531bdc',gatewayMac:'142b2fe271b4',hardwareDeviceId:13,
        hardwareGatewayId:41,device:null,gateway:null};
      const prior = (await pool.query("SELECT (ended_at-INTERVAL '1 microsecond')::text AS timestamp FROM cold_room_sessions")).rows[0].timestamp;
      await processComplianceRules({...event,eventId:randomUUID(),timestamp:prior},identity);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE ended_at IS NULL')).rows[0].count,0);
      await processComplianceRules(event,identity);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM cold_room_sessions WHERE ended_at IS NULL')).rows[0].count,1);
    });
  } finally {
    db.connect = originalConnect; db.query = originalQuery; await pool.end();
    if (owned) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
