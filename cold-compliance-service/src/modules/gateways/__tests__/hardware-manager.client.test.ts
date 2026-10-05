import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { env } from '../../../config/env';
import {
  hardwareGatewayRssiFields, normalizeHorneoGatewayMac,
  resolveHardwareGateway
} from '../hardware-manager.client';

const original = {
  enabled: env.HARDWARE_MANAGER_ENABLED,
  baseUrl: env.HARDWARE_MANAGER_BASE_URL,
  token: env.HARDWARE_MANAGER_SERVICE_TOKEN,
  timeout: env.HARDWARE_MANAGER_TIMEOUT_MS
};

const localGateway = {
  id: '11111111-1111-4111-8111-111111111111',
  gateway_mac: '28:05:A5:5E:FB:68',
  hardware_gateway_id: 10,
  rssi_threshold: -70,
  cold_room_id: '22222222-2222-4222-8222-222222222222',
  plant_id: '33333333-3333-4333-8333-333333333333'
};

beforeEach(() => {
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  (env as any).HARDWARE_MANAGER_BASE_URL = 'http://hardware-manager.test';
  (env as any).HARDWARE_MANAGER_SERVICE_TOKEN = 'hst_svc_test';
  (env as any).HARDWARE_MANAGER_TIMEOUT_MS = 1000;
});

afterEach(() => {
  (env as any).HARDWARE_MANAGER_ENABLED = original.enabled;
  (env as any).HARDWARE_MANAGER_BASE_URL = original.baseUrl;
  (env as any).HARDWARE_MANAGER_SERVICE_TOKEN = original.token;
  (env as any).HARDWARE_MANAGER_TIMEOUT_MS = original.timeout;
});

test('normalizes Horneo gateway MAC deterministically', () => {
  assert.equal(normalizeHorneoGatewayMac('28:05-A5:5E-FB:68'), '2805a55efb68');
  assert.equal(normalizeHorneoGatewayMac('invalid'), null);
});

test('dual-read resolves central gateway by hardware_gateway_id', async () => {
  let requestedUrl = '';
  let authorization = '';
  const result = await resolveHardwareGateway(localGateway, {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(input);
      authorization = String((init?.headers as Record<string, string>)?.Authorization);
      return new Response(JSON.stringify({
        id: 10,
        name: 'MKGW3 Horneo',
        mac_address: '2805a55efb68',
        description: null,
        company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        rssi_threshold: -70,
        active: true
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch
  });
  assert.equal(requestedUrl, 'http://hardware-manager.test/api/internal/v1/hardware/gateways/10');
  assert.equal(authorization, 'Bearer hst_svc_test');
  assert.equal(result.source, 'central');
  assert.deepEqual(result.divergences, []);
});

test('different physical and local presence thresholds are not an identity divergence', async () => {
  const result = await resolveHardwareGateway(localGateway, {
    fetch: (async () => new Response(JSON.stringify({
      id: 10,
      name: 'MKGW3 Horneo',
      mac_address: '2805a55efb68',
      description: null,
      company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rssi_threshold: -60,
      active: true
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
  });
  assert.equal(result.source, 'central');
  assert.deepEqual(result.divergences, []);
  assert.equal(result.local.rssi_threshold, -70);
  assert.equal(hardwareGatewayRssiFields(result.central!).hardware_rssi_threshold, -60);
});

test('missing or invalid central filter never falls back to the local presence threshold', () => {
  assert.deepEqual(hardwareGatewayRssiFields(), { hardware_rssi_threshold: null, hardware_rssi_state: 'not_available' });
  for (const value of [undefined, null, '-60', -128, 1, -60.5]) {
    assert.equal(hardwareGatewayRssiFields({ rssi_threshold: value } as any).hardware_rssi_threshold, null);
  }
});

test('dual-read falls back locally when Hardware Manager is unavailable', async () => {
  const result = await resolveHardwareGateway(localGateway, {
    fetch: (async () => new Response('unavailable', { status: 503 })) as typeof fetch
  });
  assert.equal(result.source, 'local_fallback');
  assert.equal(result.central, null);
  assert.deepEqual(result.divergences, ['central_unavailable']);
});

test('disabled dual-read performs no central request', async () => {
  (env as any).HARDWARE_MANAGER_ENABLED = false;
  let called = false;
  const result = await resolveHardwareGateway(localGateway, {
    fetch: (async () => {
      called = true;
      throw new Error('must not be called');
    }) as typeof fetch
  });
  assert.equal(called, false);
  assert.equal(result.source, 'local_disabled');
});
