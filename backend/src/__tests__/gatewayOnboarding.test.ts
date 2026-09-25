import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import app from '../app';
import { pool } from '../db/pool';
import {
  GatewayOnboardingConflictError,
  normalizeGatewayOnboardingMac,
  onboardGateway
} from '../services/gatewayOnboarding';
import { assignGatewayCompany, GatewayAssignmentConflictError } from '../services/gatewayCompanyAssignment';
import { credentialVersion, signToken } from '../utils/jwt';

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
let server: http.Server;
let baseUrl: string;

before(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
});

after(async () => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const token = (id: number, role: Parameters<typeof signToken>[0]['role']) =>
  signToken({ userId: id, role, credentialVersion: credentialVersion('fixture-hash') });

const request = (body: unknown, id?: number, role?: Parameters<typeof signToken>[0]['role']) =>
  fetch(`${baseUrl}/api/gateways/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(id && role ? { Authorization: `Bearer ${token(id, role)}` } : {}) },
    body: JSON.stringify(body)
  });

test('gateway onboarding uses the repository-proven VerneMQ bcrypt contract', () => {
  const compose = readFileSync(resolve(process.cwd(), '..', 'docker-compose.yml'), 'utf8');
  const mqttInit = readFileSync(resolve(process.cwd(), '..', 'db', 'mqtt-init.sh'), 'utf8');
  const implementation = readFileSync(resolve(process.cwd(), 'src', 'services', 'gatewayOnboarding.ts'), 'utf8');
  assert.match(compose, /PASSWORD_HASH_METHOD=bcrypt/);
  assert.match(mqttInit, /crypt\(:'app_password', gen_salt\('bf', 10\)\)/);
  assert.match(implementation, /crypt\(\$1, gen_salt\('bf', 10\)\)/);
  assert.doesNotMatch(implementation, /password\s*=\s*\$1/);
});

function fakeOnboardingDatabase() {
  const observed = {
    connected: 0,
    transaction: [] as string[],
    gatewayParams: [] as unknown[],
    brokerParams: [] as unknown[],
    auditParams: [] as unknown[]
  };
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql === 'SELECT id, role, password_hash FROM users WHERE id = $1') {
      const id = Number(params[0]);
      const role = id === 1 ? 'hardware_readonly' : id === 5 ? 'hardware_superadmin' : 'hardware_technician';
      return { rows: [{ id, role, password_hash: 'fixture-hash' }] };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  };
  (pool as any).connect = async () => {
    observed.connected += 1;
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
          observed.transaction.push(sql);
          return { rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: null }] };
        if (sql.includes('FROM gateways') && sql.includes('regexp_replace')) return { rows: [] };
        if (sql.includes('FROM vmq_auth_acl')) return { rows: [] };
        if (sql.includes('INSERT INTO gateways')) {
          observed.gatewayParams = params;
          return { rows: [{ id: 41, name: null, mac_address: params[0], description: null, owner_id: null,
            company_id: null, active: true, created_at: '2026-01-01', updated_at: '2026-01-01' }] };
        }
        if (sql.includes('INSERT INTO vmq_auth_acl')) {
          observed.brokerParams = params;
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO technical_audit_log')) {
          observed.auditParams = params;
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected client query: ${sql}`);
      },
      release: () => undefined
    };
  };
  return observed;
}

test('gateway onboarding requires global hardware authorization and accepts only the MAC', async () => {
  const observed = fakeOnboardingDatabase();
  assert.equal((await request({ macAddress: '2805A55EFB68' })).status, 401);
  assert.equal((await request({ macAddress: '2805A55EFB68' }, 1, 'hardware_readonly')).status, 403);
  assert.equal((await request({ macAddress: '2805A55EFB68' }, 2, 'hardware_technician')).status, 403);
  assert.equal((await request({ macAddress: '2805A55EFB68', companyId: COMPANY_B }, 5, 'hardware_superadmin')).status, 400);
  assert.equal((await request({ macAddress: 'not-a-mac' }, 5, 'hardware_superadmin')).status, 400);
  assert.equal((await request({ macAddress: 'prefix-2805A55EFB68' }, 5, 'hardware_superadmin')).status, 400);
  assert.equal(observed.connected, 0);
  assert.equal(normalizeGatewayOnboardingMac('28:05:A5:5E:FB:68'), '2805a55efb68');
  assert.equal(normalizeGatewayOnboardingMac('28-05-A5-5E-FB-68'), '2805a55efb68');
  assert.equal(normalizeGatewayOnboardingMac('28:05-A5:5E-FB:68'), null);
});

test('global gateway onboarding returns broker prepared and unassigned, never connected', async () => {
  const observed = fakeOnboardingDatabase();
  const response = await request({ macAddress: '28:05:A5:5E:FB:68' }, 5, 'hardware_superadmin');
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.gateway.company_id, null);
  assert.equal(body.gateway.mac_address, '2805a55efb68');
  assert.equal(body.broker.status, 'prepared');
  assert.equal(body.companyAssignment, 'unassigned');
  assert.equal(body.connection, 'unverified');
  assert.equal(body.connected, null);
  assert.match(body.message, /registrada y preparada en el broker/);
  assert.match(body.message, /conexión todavía no está verificada/);
  assert.deepEqual(observed.gatewayParams, ['2805a55efb68']);
  assert.equal(observed.brokerParams[0], '2805a55efb68');
  assert.deepEqual(JSON.parse(String(observed.brokerParams[1])), [{ pattern: 'gw/2805a55efb68/publish' }]);
  assert.deepEqual(JSON.parse(String(observed.brokerParams[2])), [{ pattern: 'gw/2805a55efb68/subscribe' }]);
  assert.equal(JSON.stringify(observed.brokerParams).includes('qos'), false);
  assert.equal(JSON.stringify(observed.auditParams).includes('$2a$'), false);
  assert.deepEqual(observed.transaction, ['BEGIN', 'COMMIT']);
});

test('global ADMIN can onboard without a company membership', async () => {
  const observed = fakeOnboardingDatabase();
  assert.equal((await request({ macAddress: '142B2FE271B4' }, 5, 'ADMIN')).status, 201);
  assert.deepEqual(observed.gatewayParams, ['142b2fe271b4']);
});

test('gateway onboarding reports inventory and broker collisions without overwriting either record', async () => {
  for (const collision of ['gateway', 'broker'] as const) {
    const observed = fakeOnboardingDatabase();
    const baseConnect = (pool as any).connect;
    (pool as any).connect = async () => {
      const client = await baseConnect();
      const query = client.query.bind(client);
      client.query = async (sql: string, params: unknown[] = []) => {
        if (collision === 'gateway' && sql.includes('FROM gateways') && sql.includes('regexp_replace')) {
          return { rows: [{ id: 99, company_id: COMPANY_B }] };
        }
        if (collision === 'broker' && sql.includes('FROM vmq_auth_acl')) {
          return { rows: [{ client_id: params[0], username: params[0] }] };
        }
        return query(sql, params);
      };
      return client;
    };
    const response = await request({ macAddress: '2805A55EFB68' }, 5, 'hardware_superadmin');
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      message: collision === 'gateway' ? 'Gateway MAC is already registered' : 'Gateway broker identity is already registered'
    });
    assert.deepEqual(observed.transaction, ['BEGIN', 'ROLLBACK']);
    assert.deepEqual(observed.gatewayParams, []);
    assert.deepEqual(observed.brokerParams, []);
  }
});

test('gateway onboarding rolls back and returns a redacted error when broker provisioning fails', async () => {
  const observed = fakeOnboardingDatabase();
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...values: unknown[]) => { logs.push(values.map(String).join(' ')); };
  const baseConnect = (pool as any).connect;
  (pool as any).connect = async () => {
    const client = await baseConnect();
    const query = client.query.bind(client);
    client.query = async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO vmq_auth_acl')) throw new Error('simulated secret-sensitive broker failure');
      return query(sql, params);
    };
    return client;
  };
  try {
    const response = await request({ macAddress: '2805A55EFB68' }, 5, 'hardware_superadmin');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'Failed to onboard gateway' });
    assert.deepEqual(observed.transaction, ['BEGIN', 'ROLLBACK']);
    assert.equal(logs.join(' ').includes('secret-sensitive'), false);
  } finally {
    console.error = originalError;
  }
});

const integrationUrl = process.env.GATEWAY_ONBOARDING_TEST_DATABASE_URL;
const allowIntegration = process.env.GATEWAY_ONBOARDING_ALLOW_DATABASE_TESTS === 'true';

test('PostgreSQL onboarding creates bcrypt identity and exact ACL atomically under duplicates and concurrency',
  { skip: !integrationUrl || !allowIntegration ? 'requires an explicit isolated PostgreSQL database' : false }, async () => {
    const admin = new Pool({ connectionString: integrationUrl });
    const schema = `gateway_onboarding_${randomUUID().replace(/-/g, '')}`;
    const database = new Pool({ connectionString: integrationUrl, options: `-c search_path=${schema},public` });
    try {
      await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query(`
        CREATE TABLE ${schema}.companies(
          id uuid PRIMARY KEY, code varchar(64) NOT NULL, name varchar(160) NOT NULL,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT companies_code_format CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
          CONSTRAINT companies_code_unique UNIQUE (code)
        );
        CREATE TABLE ${schema}.company_user_memberships(
          user_id integer NOT NULL, company_id uuid NOT NULL REFERENCES ${schema}.companies(id), role varchar(32) NOT NULL,
          PRIMARY KEY(user_id, company_id)
        );
        CREATE TABLE ${schema}.gateways(
          id serial PRIMARY KEY, name varchar(160), mac_address varchar(32) NOT NULL UNIQUE,
          description text, owner_id integer, company_id uuid REFERENCES ${schema}.companies(id) ON DELETE RESTRICT,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${schema}.hardware_gateway_commands(
          gateway_id integer NOT NULL REFERENCES ${schema}.gateways(id), company_id uuid NOT NULL,
          msg_id integer NOT NULL,
          command_type varchar(64) NOT NULL, actor_type varchar(16) NOT NULL,
          idempotency_key varchar(128)
        );
        CREATE TABLE ${schema}.hardware_gateway_reads(gateway_id integer);
        CREATE TABLE ${schema}.hardware_gateway_observed_settings(gateway_id integer);
        CREATE TABLE ${schema}.hardware_gateway_ble_snapshots(gateway_id integer);
        CREATE TABLE ${schema}.gateway_places(gateway_id integer);
        CREATE TABLE ${schema}.devices(last_gateway_id integer);
        CREATE TABLE ${schema}.device_records(gateway_id integer);
        CREATE TABLE ${schema}.vmq_auth_acl(
          mountpoint text NOT NULL DEFAULT '', client_id text NOT NULL, username text NOT NULL, password text NOT NULL,
          publish_acl jsonb NOT NULL, subscribe_acl jsonb NOT NULL,
          UNIQUE(mountpoint, client_id)
        );
        CREATE TABLE ${schema}.technical_audit_log(
          id bigserial PRIMARY KEY, actor_user_id integer, actor_type varchar(16), actor_code varchar(64),
          actor_service_id uuid, action varchar(96) NOT NULL, entity_type varchar(64) NOT NULL,
          entity_id text NOT NULL, company_id uuid, request_id varchar(128), result varchar(32) NOT NULL,
          before_state jsonb, after_state jsonb, created_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO ${schema}.companies(id, code, name, active) VALUES
          ('${COMPANY_A}', 'company_a', 'Company A', true),
          ('${COMPANY_B}', 'company_b', 'Company B', true);
        INSERT INTO ${schema}.company_user_memberships(user_id, company_id, role) VALUES
          (2, '${COMPANY_A}', 'hardware_technician'), (3, '${COMPANY_B}', 'hardware_technician');
      `);
      assert.match((await database.query("SELECT current_setting('server_version') AS version")).rows[0].version, /^15\./);
      await database.query(readFileSync(resolve(process.cwd(), 'migrations', '012_unassigned_gateway_commands.sql'), 'utf8'));

      const firstMac = '2805a55efb68';
      const first = await onboardGateway({ macAddress: firstMac, actorUserId: 2 }, { database });
      assert.equal(first.broker.status, 'prepared');
      const auth = await database.query(
        'SELECT *, password = crypt($1, password) AS password_matches FROM vmq_auth_acl WHERE client_id = $1',
        [firstMac]
      );
      assert.equal(auth.rows[0].password_matches, true);
      assert.notEqual(auth.rows[0].password, firstMac);
      assert.match(auth.rows[0].password, /^\$2[aby]\$10\$/);
      assert.equal(auth.rows[0].mountpoint, '');
      assert.equal(auth.rows[0].username, firstMac);
      assert.deepEqual(auth.rows[0].publish_acl, [{ pattern: `gw/${firstMac}/publish` }]);
      assert.deepEqual(auth.rows[0].subscribe_acl, [{ pattern: `gw/${firstMac}/subscribe` }]);
      assert.equal(JSON.stringify(auth.rows[0].publish_acl).includes('qos'), false);
      const audit = await database.query("SELECT after_state::text FROM technical_audit_log WHERE action='gateway.onboard'");
      assert.equal(audit.rows[0].after_state.includes(auth.rows[0].password), false);
      assert.equal(audit.rows[0].after_state.includes('password'), false);
      await database.query(
        `INSERT INTO hardware_gateway_commands(gateway_id, company_id, msg_id, command_type, actor_type, idempotency_key)
         VALUES($1, NULL, 1030, 'mqtt_connection_1030', 'user', 'test-1030'),
               ($1, NULL, 1000, 'gateway_restart_1000', 'user', 'test-1000')`, [first.gateway.id]
      );
      await assert.rejects(database.query(
        `INSERT INTO hardware_gateway_commands(gateway_id, company_id, msg_id, command_type, actor_type)
         VALUES($1, NULL, 1150, 'b5_physical_connect', 'user')`, [first.gateway.id]
      ), /hardware_gateway_commands_unassigned_check/);
      await assert.rejects(database.query(
        `INSERT INTO hardware_gateway_commands(gateway_id, company_id, msg_id, command_type, actor_type)
         VALUES($1, NULL, 1150, 'mqtt_connection_1030', 'user')`, [first.gateway.id]
      ), /hardware_gateway_commands_unassigned_check/);
      await assert.rejects(database.query(
        `INSERT INTO hardware_gateway_commands(gateway_id, company_id, msg_id, command_type, actor_type, idempotency_key)
         VALUES($1, NULL, 1030, 'mqtt_connection_1030', 'user', 'test-1030')`, [first.gateway.id]
      ), /uq_hardware_gateway_commands_unassigned_idempotency/);
      const assigned = await assignGatewayCompany({ gatewayId: first.gateway.id, companyId: COMPANY_A,
        actorUserId: 2 }, { database });
      assert.equal(assigned.gateway.company_id, COMPANY_A);
      assert.equal(assigned.company.code, 'company_a');
      assert.equal(assigned.company.name, 'Company A');
      assert.equal((await database.query('SELECT count(*)::int AS n FROM hardware_gateway_commands WHERE company_id IS NULL')).rows[0].n, 2);
      assert.equal((await database.query('SELECT password FROM vmq_auth_acl WHERE client_id=$1', [firstMac])).rows[0].password,
        auth.rows[0].password);
      await assert.rejects(assignGatewayCompany({ gatewayId: first.gateway.id, companyId: COMPANY_B,
        actorUserId: 2 }, { database }), GatewayAssignmentConflictError);

      await assert.rejects(
        onboardGateway({ macAddress: firstMac, actorUserId: 3 }, { database }),
        GatewayOnboardingConflictError
      );
      assert.equal((await database.query('SELECT company_id FROM gateways WHERE mac_address=$1', [firstMac])).rows[0].company_id, COMPANY_A);

      const concurrentMac = '142b2fe271b4';
      const concurrent = await Promise.allSettled([
        onboardGateway({ macAddress: concurrentMac, actorUserId: 2 }, { database }),
        onboardGateway({ macAddress: concurrentMac, actorUserId: 2 }, { database })
      ]);
      assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(concurrent.filter((item) => item.status === 'rejected').length, 1);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM gateways WHERE mac_address=$1', [concurrentMac])).rows[0].count, 1);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM vmq_auth_acl WHERE client_id=$1', [concurrentMac])).rows[0].count, 1);
      const concurrentGateway = (await database.query('SELECT id FROM gateways WHERE mac_address=$1', [concurrentMac])).rows[0].id;
      const competingAssignments = await Promise.allSettled([
        assignGatewayCompany({ gatewayId: concurrentGateway, companyId: COMPANY_A, actorUserId: 2 }, { database }),
        assignGatewayCompany({ gatewayId: concurrentGateway, companyId: COMPANY_B, actorUserId: 3 }, { database })
      ]);
      assert.equal(competingAssignments.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(competingAssignments.filter((item) => item.status === 'rejected').length, 1);
      assert.equal((await database.query('SELECT count(*)::int AS n FROM gateways WHERE id=$1 AND company_id IS NOT NULL',
        [concurrentGateway])).rows[0].n, 1);

      const auditRollbackMac = 'abcdef123456';
      const auditRollbackGateway = await onboardGateway({ macAddress: auditRollbackMac, actorUserId: 2 }, { database });
      await database.query(`
        CREATE FUNCTION reject_test_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'gateway.company.assign' AND NEW.entity_id = '${auditRollbackGateway.gateway.id}'
          THEN RAISE EXCEPTION 'simulated assignment audit failure'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER reject_test_assignment_audit BEFORE INSERT ON technical_audit_log
        FOR EACH ROW EXECUTE FUNCTION reject_test_assignment_audit();
      `);
      await assert.rejects(assignGatewayCompany({ gatewayId: auditRollbackGateway.gateway.id,
        companyId: COMPANY_A, actorUserId: 2 }, { database }), /simulated assignment audit failure/);
      assert.equal((await database.query('SELECT company_id FROM gateways WHERE id=$1',
        [auditRollbackGateway.gateway.id])).rows[0].company_id, null);

      const rollbackMac = '007007e0c804';
      await database.query(`
        CREATE FUNCTION reject_test_broker_identity() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.client_id = '${rollbackMac}' THEN RAISE EXCEPTION 'simulated broker rejection'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER reject_test_broker_identity BEFORE INSERT ON vmq_auth_acl
        FOR EACH ROW EXECUTE FUNCTION reject_test_broker_identity();
      `);
      await assert.rejects(onboardGateway({
        macAddress: rollbackMac, actorUserId: 2, requestId: 'rollback-test'
      }, { database }), /simulated broker rejection/);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM gateways WHERE mac_address=$1', [rollbackMac])).rows[0].count, 0);
      assert.equal((await database.query("SELECT count(*)::int AS count FROM technical_audit_log WHERE request_id='rollback-test'")).rows[0].count, 0);
    } finally {
      await database.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
