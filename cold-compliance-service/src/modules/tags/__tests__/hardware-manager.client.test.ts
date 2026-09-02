import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { env } from '../../../config/env';
import {
  HardwareDevice,
  normalizeHorneoDeviceMac,
  resolveHardwareDevice
} from '../hardware-manager.client';

const original = {
  enabled: env.HARDWARE_MANAGER_ENABLED,
  baseUrl: env.HARDWARE_MANAGER_BASE_URL,
  token: env.HARDWARE_MANAGER_SERVICE_TOKEN,
  timeout: env.HARDWARE_MANAGER_TIMEOUT_MS
};

const localTag = {
  id: '11111111-1111-4111-8111-111111111111',
  tag_uid: 'df:9d:da:a7:ea:b3',
  hardware_device_id: 1,
  model: 'B5 local',
  active: true,
  physical_alarm_followup_delay_ms: 45000,
  physical_alarm_buzzer_duration_ms: 3000,
  physical_alarm_vibration_duration_ms: 3000
};

const centralDevice: HardwareDevice = {
  id: 1,
  name: 'Nombre central distinto permitido',
  ble_mac: 'DF9DDAA7EAB3',
  description: null,
  company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  device_type: 'b5',
  status: 'active',
  active: true
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

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

test('normaliza MAC de tag a la representación central mayúscula', () => {
  assert.equal(normalizeHorneoDeviceMac('df:9d-da:a7-ea:b3'), 'DF9DDAA7EAB3');
  assert.equal(normalizeHorneoDeviceMac('bad'), null);
});

test('lectura dual desactivada conserva toda la referencia operativa local', async () => {
  (env as any).HARDWARE_MANAGER_ENABLED = false;
  const result = await resolveHardwareDevice(localTag, { fetch: async () => { throw new Error('must not fetch'); } });
  assert.equal(result.source, 'local_disabled');
  assert.deepEqual(result.local, localTag);
  assert.equal(result.central, null);
});

test('resuelve primero por hardware_device_id y no considera el nombre una divergencia dura', async () => {
  const calls: string[] = [];
  const result = await resolveHardwareDevice(localTag, { fetch: async (input) => {
    calls.push(String(input));
    return jsonResponse(centralDevice);
  }});
  assert.equal(result.source, 'central');
  assert.deepEqual(result.divergences, []);
  assert.deepEqual(calls, ['http://hardware-manager.test/api/internal/v1/hardware/devices/1']);
});

test('un 404 del id reconciliado es explícito y no vuelve a decidir por MAC local', async () => {
  const calls: string[] = [];
  const result = await resolveHardwareDevice(localTag, { fetch: async (input) => {
    calls.push(String(input));
    return jsonResponse({}, 404);
  }});
  assert.equal(result.source, 'central_not_found');
  assert.deepEqual(result.divergences, ['central_device_not_found']);
  assert.deepEqual(calls, ['http://hardware-manager.test/api/internal/v1/hardware/devices/1']);
});

test('404 de un recurso ajeno oculto no activa fallback local', async () => {
  let calls = 0;
  const result = await resolveHardwareDevice(localTag, { fetch: async () => {
    calls += 1;
    return jsonResponse({}, 404);
  }});
  assert.equal(calls, 1);
  assert.equal(result.source, 'central_not_found');
  assert.deepEqual(result.divergences, ['central_device_not_found']);
});

test('indisponibilidad central vuelve a local y no pierde parámetros de alarma', async () => {
  const result = await resolveHardwareDevice(localTag, { fetch: async () => { throw new Error('offline'); } });
  assert.equal(result.source, 'local_fallback');
  assert.deepEqual(result.divergences, ['central_unavailable']);
  assert.equal(result.local.physical_alarm_followup_delay_ms, 45000);
  assert.equal(result.local.physical_alarm_buzzer_duration_ms, 3000);
});

test('informa divergencias de MAC, estado, activo y tipo sin alterar el registro local', async () => {
  const result = await resolveHardwareDevice(localTag, { fetch: async () => jsonResponse({
    ...centralDevice,
    ble_mac: 'A00000000001',
    active: false,
    status: 'maintenance',
    device_type: 'sensor'
  }) });
  assert.equal(result.source, 'central');
  assert.deepEqual(result.divergences, ['tag_uid', 'active', 'status', 'device_type']);
  assert.equal(result.local.active, true);
});

test('endpoint diagnóstico está protegido por el router y es de solo lectura', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', '..', 'src', 'modules', 'tags', 'tags.routes.ts'),
    'utf8'
  );
  const authPosition = source.indexOf('tagsRouter.use(requireAuth)');
  const routePosition = source.indexOf("tagsRouter.get('/:id/hardware-resolution'");
  assert.ok(authPosition >= 0 && routePosition > authPosition);
  const route = source.slice(routePosition, source.indexOf("tagsRouter.patch('/:id'", routePosition));
  assert.match(route, /SELECT id, tag_uid, hardware_device_id/);
  assert.match(route, /resolveHardwareDevice/);
  assert.doesNotMatch(route, /INSERT|UPDATE|DELETE|publish|mqtt|ble/i);
});
