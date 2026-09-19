import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { pool } from '../db/pool';
import { normalizeHardwareGatewayAck } from '../services/gatewayAck';
import { GatewayIdentityBusyError, GatewayIdentityOperationTimeoutError } from '../services/gatewayIdentity';
import {
  buildGatewayConfigurationReadRequest,
  executeGatewayConfigurationRead,
  handleGatewayConfigurationReport,
  parseGatewayConfigurationReport,
  resetGatewayConfigurationWaitersForTests,
  type GatewayConfigurationReadType
} from '../services/gatewayObservedReads';

const originalConnect = pool.connect.bind(pool);
const TOPIC = 'gw/2805a55efb68/publish';
const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reports = {
  led_state: { msg_id: 2011, device_info: { mac: '2805a55efb68' }, data: { net_led: 1, sys_led: 1, server_led: 1 } },
  ble_scan_switch: { msg_id: 2040, device_info: { mac: '2805a55efb68' }, data: { scan_switch: 1 } },
  filter_relation: { msg_id: 2041, device_info: { mac: '2805a55efb68' }, data: { relation: 3 } },
  duplicate_rule: { msg_id: 2057, device_info: { mac: '2805a55efb68' }, data: { rule: 0 } }
} as const;

afterEach(() => {
  (pool as any).connect = originalConnect;
  resetGatewayConfigurationWaitersForTests();
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

function mockDatabase(options: {
  busy?: boolean;
  gatewayExists?: boolean;
  connectGate?: Promise<void>;
  lockGate?: Promise<void>;
  insertGate?: Promise<void>;
  journalGate?: Promise<void>;
  journalStarted?: () => void;
} = {}) {
  const operations: Array<{ sql: string; params: unknown[] }> = [];
  let nextClient = 0;
  (pool as any).connect = async () => {
    if (options.connectGate) await options.connectGate;
    const id = ++nextClient;
    return {
      query: async (sql: string, params: unknown[] = []) => {
        operations.push({ sql, params });
        if (sql.includes('pg_try_advisory_lock')) {
          if (options.lockGate) await options.lockGate;
          return { rows: [{ locked: !options.busy }] };
        }
        if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('SELECT id, company_id FROM gateways')) {
          return { rows: options.gatewayExists === false ? [] : [{ id: 41, company_id: COMPANY_A }] };
        }
        if (sql.includes('SELECT id FROM gateways')) {
          return { rows: options.gatewayExists === false ? [] : [{ id: 41 }] };
        }
        if (sql.includes('INSERT INTO hardware_gateway_observed_settings')) return { rows: [], rowCount: 1 };
        if (sql.includes('INSERT INTO hardware_gateway_reads')) {
          if (options.insertGate) await options.insertGate;
          return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] };
        }
        if (sql.includes('UPDATE hardware_gateway_reads')) {
          if (sql.includes('response_payload') && options.journalGate) {
            options.journalStarted?.();
            await options.journalGate;
          }
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      release: (destroy?: boolean) => operations.push({ sql: 'CLIENT_RELEASE', params: [destroy ?? false, id] })
    };
  };
  return operations;
}

const execute = (readType: GatewayConfigurationReadType, publish: (topic: string, payload: Record<string, unknown>) => Promise<void>, timeoutMs = 60) =>
  executeGatewayConfigurationRead({
    gatewayId: 41, companyId: COMPANY_A, gatewayMac: '2805a55efb68', readType,
    actorUserId: 2, timeoutMs, deps: { publish }
  });

test('the four observed schemas and requests are exact and are not ACKs', () => {
  const expectedIds: Record<GatewayConfigurationReadType, number> = {
    led_state: 2011, ble_scan_switch: 2040, filter_relation: 2041, duplicate_rule: 2057
  };
  for (const [readType, report] of Object.entries(reports) as Array<[GatewayConfigurationReadType, any]>) {
    assert.deepEqual(buildGatewayConfigurationReadRequest('28:05:A5:5E:FB:68', readType), {
      msg_id: expectedIds[readType], device_info: { mac: '2805A55EFB68' }
    });
    assert.deepEqual(parseGatewayConfigurationReport(TOPIC, report)?.data, report.data);
    assert.equal(normalizeHardwareGatewayAck(TOPIC, report), null);
  }
});

test('strict parsing rejects contradictory MAC, wrong topic, extra/missing keys, types and ranges', () => {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  let value: any = clone(reports.led_state); value.device_info.mac = 'ffffffffffff';
  assert.equal(parseGatewayConfigurationReport(TOPIC, value), null);
  assert.equal(parseGatewayConfigurationReport(`${TOPIC}/extra`, reports.led_state), null);
  value = clone(reports.led_state); value.data.extra = 1;
  assert.equal(parseGatewayConfigurationReport(TOPIC, value), null);
  value = clone(reports.led_state); delete value.data.net_led;
  assert.equal(parseGatewayConfigurationReport(TOPIC, value), null);
  value = clone(reports.ble_scan_switch); value.data.scan_switch = true;
  assert.equal(parseGatewayConfigurationReport(TOPIC, value), null);
  value = clone(reports.filter_relation); value.data.relation = 9;
  assert.equal(parseGatewayConfigurationReport(TOPIC, value), null);
  value = clone(reports.duplicate_rule); value.data.rule = -1;
  assert.equal(parseGatewayConfigurationReport(TOPIC, value), null);
  value = clone(reports.led_state); value.result_code = 0; delete value.data;
  assert.equal(parseGatewayConfigurationReport(TOPIC, value), null);
});

test('an immediate response during publication is observed and scoped to gateway and company', async () => {
  const operations = mockDatabase();
  const result = await execute('led_state', async (topic, payload) => {
    assert.equal(topic, 'gw/2805a55efb68/subscribe');
    assert.deepEqual(payload, { msg_id: 2011, device_info: { mac: '2805A55EFB68' } });
    await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.led_state));
  });
  assert.equal(result.status, 'response_observed');
  assert.deepEqual(result.data, reports.led_state.data);
  const scope = operations.find((item) => item.sql.includes('SELECT id, company_id FROM gateways'))!;
  assert.deepEqual(scope.params, ['2805a55efb68', 41, COMPANY_A]);
  assert.ok(operations.some((item) => item.sql.includes('INSERT INTO hardware_gateway_observed_settings')));
});

test('a delayed valid response completes while timeout and wrong topic remain bounded', async () => {
  mockDatabase();
  const delayed = await execute('ble_scan_switch', async () => {
    setTimeout(() => { void handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.ble_scan_switch)); }, 5);
  });
  assert.equal(delayed.status, 'response_observed');
  mockDatabase();
  const wrongTopic = await execute('ble_scan_switch', async () => {
    await handleGatewayConfigurationReport('gw/2805a55efb68/publish/extra', JSON.stringify(reports.ble_scan_switch));
  }, 25);
  assert.equal(wrongTopic.status, 'timed_out');
});

test('a late response refreshes latest state but cannot revive a timed-out read', async () => {
  const operations = mockDatabase();
  const result = await execute('duplicate_rule', async () => undefined, 20);
  assert.equal(result.status, 'timed_out');
  assert.equal(await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.duplicate_rule)), true);
  assert.ok(operations.some((item) => item.sql.includes('INSERT INTO hardware_gateway_observed_settings')));
  const observedJournal = operations.filter((item) => item.sql.includes('response_payload'));
  assert.equal(observedJournal.length, 0);
});

test('a schema-invalid or contradictory-MAC response is recorded as invalid, never successful', async () => {
  mockDatabase();
  const invalid = JSON.parse(JSON.stringify(reports.filter_relation));
  invalid.data.relation = 99;
  assert.equal((await execute('filter_relation', async () => {
    await handleGatewayConfigurationReport(TOPIC, JSON.stringify(invalid));
  })).status, 'invalid_response');
  mockDatabase();
  const contradictory = JSON.parse(JSON.stringify(reports.filter_relation));
  contradictory.device_info.mac = 'ffffffffffff';
  assert.equal((await execute('filter_relation', async () => {
    await handleGatewayConfigurationReport(TOPIC, JSON.stringify(contradictory));
  })).status, 'invalid_response');
});

test('unknown or inactive gateway responses do not persist or resolve a read', async () => {
  const operations = mockDatabase({ gatewayExists: false });
  assert.equal(await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.led_state)), false);
  assert.equal(operations.some((item) => item.sql.includes('hardware_gateway_observed_settings')), false);
  const result = await execute('led_state', async () => {
    await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.led_state));
  }, 25);
  assert.equal(result.status, 'timed_out');
});

test('two gateways from two companies persist independently without cross-contamination', async () => {
  const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const persisted: unknown[][] = [];
  (pool as any).connect = async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('SELECT id, company_id FROM gateways')) {
        return { rows: params[0] === '2805a55efb68'
          ? [{ id: 41, company_id: COMPANY_A }]
          : params[0] === '142b2fe271b4' ? [{ id: 42, company_id: companyB }] : [] };
      }
      if (sql.includes('INSERT INTO hardware_gateway_observed_settings')) {
        persisted.push(params);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release: () => undefined
  });
  const reportB = JSON.parse(JSON.stringify(reports.ble_scan_switch));
  reportB.device_info.mac = '142b2fe271b4';
  assert.equal(await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.ble_scan_switch)), true);
  assert.equal(await handleGatewayConfigurationReport('gw/142b2fe271b4/publish', JSON.stringify(reportB)), true);
  assert.deepEqual(persisted.map((params) => params.slice(0, 2)), [[41, COMPANY_A], [42, companyB]]);
});

test('busy gateway and all pre-publication database phases are bounded', async () => {
  mockDatabase({ busy: true });
  await assert.rejects(() => execute('led_state', async () => undefined), GatewayIdentityBusyError);
  for (const stage of ['connect', 'lock', 'insert'] as const) {
    const gate = deferred();
    const options = stage === 'connect' ? { connectGate: gate.promise }
      : stage === 'lock' ? { lockGate: gate.promise } : { insertGate: gate.promise };
    const operations = mockDatabase(options);
    const operation = execute('led_state', async () => undefined, 15);
    try {
      await assert.rejects(operation, GatewayIdentityOperationTimeoutError);
    } finally {
      gate.resolve();
      await operation.catch(() => undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const releases = operations.filter((item) => item.sql === 'CLIENT_RELEASE');
    assert.equal(releases.length, 1);
    assert.equal(releases[0].params[0], true);
  }
});

test('blocked response journal, late publish error and consecutive gateways clean waiters and connections', async () => {
  const gate = deferred();
  const started = deferred();
  const blockedOperations = mockDatabase({ journalGate: gate.promise, journalStarted: started.resolve });
  const blocked = execute('led_state', async () => {
    await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.led_state));
  }, 80);
  await started.promise;
  assert.equal((await blocked).status, 'timed_out');
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  gate.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.ok(blockedOperations.some((item) => item.sql === 'CLIENT_RELEASE' && item.params[0] === true),
    JSON.stringify(blockedOperations.filter((item) => item.sql === 'CLIENT_RELEASE')));

  mockDatabase();
  const observedDespitePublishError = await execute('led_state', async () => {
    await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.led_state));
    throw new Error('late callback failure');
  });
  assert.equal(observedDespitePublishError.status, 'response_observed');

  mockDatabase();
  assert.equal((await execute('filter_relation', async () => {
    await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.filter_relation));
  })).status, 'response_observed');
  assert.equal((await execute('filter_relation', async () => {
    await handleGatewayConfigurationReport(TOPIC, JSON.stringify(reports.filter_relation));
  })).status, 'response_observed');
});

test('migration 010 is additive, constrained and does not rewrite rows', () => {
  const migration = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '010_gateway_observed_configuration_reads.sql'), 'utf8');
  assert.match(migration, /hardware_gateway_observed_settings/);
  assert.match(migration, /FOREIGN KEY \(gateway_id, company_id\)/);
  assert.match(migration, /jsonb_typeof\(observed_value->'relation'\) = 'number'/);
  assert.doesNotMatch(migration, /jsonb_object_length/);
  assert.match(migration, /observed_value - ARRAY\['net_led', 'sys_led', 'server_led'\]::text\[\] = '\{\}'::jsonb/);
  assert.match(migration, /observed_value - ARRAY\['scan_switch'\]::text\[\] = '\{\}'::jsonb/);
  assert.match(migration, /observed_value - ARRAY\['relation'\]::text\[\] = '\{\}'::jsonb/);
  assert.match(migration, /observed_value - ARRAY\['rule'\]::text\[\] = '\{\}'::jsonb/);
  for (const value of ['2011', '2040', '2041', '2057', 'invalid_response']) assert.match(migration, new RegExp(value));
  assert.doesNotMatch(migration, /^\s*(?:UPDATE\s|DELETE\s+FROM\s|TRUNCATE\s)/im);
  assert.equal(fs.readFileSync(path.resolve(process.cwd(), 'migrations', '009_gateway_identity_reads.sql'), 'utf8').includes('msg_id = 2002'), true);
});
