import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../../db/pool';
import { beginControlledPresenceOperation, finishControlledPresenceOperation } from '../../tag-control/infrastructure/controlled-presence.repository';
import { markBleSessionActive, markBleSessionDisconnected } from '../../tag-control/infrastructure/ble-session.repository';
import { closeStaleSessions } from '../compliance.service';

const databaseUrl = process.env.CONTROLLED_B5_TEST_DATABASE_URL;
const enabled = process.env.CONTROLLED_B5_ALLOW_DATABASE_TESTS === 'true' && Boolean(databaseUrl);

test('PostgreSQL 15: additive migration, session locking, fixed deadlines, concurrency and late ownership', {
  skip: enabled ? false : 'requires an explicitly disposable loopback PostgreSQL 15 test database'
}, async () => {
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
  } finally {
    db.connect = originalConnect; db.query = originalQuery; await pool.end();
    if (owned) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
