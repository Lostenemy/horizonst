import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { env } from '../../../config/env';
import { resolveGatewayMacForCommand } from '../../gateways/gateways.routes';
import { HardwareGateway } from '../../gateways/hardware-manager.client';
import { HardwareDevice } from '../../tags/hardware-manager.client';
import { validateTechnicalTargets } from '../../tag-control/infrastructure/tag-control.repository';
import {
  clearEventTechnicalIdentityCache,
  HardwareInventoryCache,
  resolveEventTechnicalIdentity
} from '../event-identity.service';

const original = {
  enabled: env.HARDWARE_MANAGER_ENABLED,
  cacheTtlMs: env.HARDWARE_MANAGER_CACHE_TTL_MS,
  errorTtlMs: env.HARDWARE_MANAGER_CACHE_ERROR_TTL_MS
};
const device: HardwareDevice = {
  id: 31, name: 'B5 central', ble_mac: 'FD9D4F8AE226', description: null,
  company_id: 'horneo', device_type: 'b5', status: 'active', active: true
};
const gateway: HardwareGateway = {
  id: 41, name: 'MKGW3 central', mac_address: '2805A55EFB68', description: null,
  company_id: 'horneo', rssi_threshold: -70, active: true
};
const found = <T>(value: T) => Promise.resolve({ kind: 'found' as const, value });
const inventoryDeps = (
  devices: HardwareDevice[] = [device],
  gateways: HardwareGateway[] = [gateway],
  cache = new HardwareInventoryCache()
) => ({ cache, listDevices: async () => found(devices), listGateways: async () => found(gateways) });

beforeEach(() => {
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  (env as any).HARDWARE_MANAGER_CACHE_TTL_MS = 30000;
  (env as any).HARDWARE_MANAGER_CACHE_ERROR_TTL_MS = 2000;
  clearEventTechnicalIdentityCache();
});
afterEach(() => {
  (env as any).HARDWARE_MANAGER_ENABLED = original.enabled;
  (env as any).HARDWARE_MANAGER_CACHE_TTL_MS = original.cacheTtlMs;
  (env as any).HARDWARE_MANAGER_CACHE_ERROR_TTL_MS = original.errorTtlMs;
  clearEventTechnicalIdentityCache();
});

test('event identity accepts an operational B5 and gateway from the central company scope', async () => {
  const result = await resolveEventTechnicalIdentity(
    { tagMac: 'fd:9d:4f:8a:e2:26', gatewayMac: '28:05:a5:5e:fb:68' },
    inventoryDeps()
  );
  assert.equal(result.source, 'central');
  assert.equal(result.hardwareDeviceId, 31);
  assert.equal(result.hardwareGatewayId, 41);
  assert.equal(result.tagMac, 'FD9D4F8AE226');
  assert.equal(result.gatewayMac, '2805a55efb68');
});

test('inactive, maintenance and non-B5 devices are rejected by central state', async () => {
  for (const patch of [
    { active: false },
    { status: 'maintenance' },
    { device_type: 'sensor' }
  ]) {
    const result = await resolveEventTechnicalIdentity(
      { tagMac: device.ble_mac, gatewayMac: gateway.mac_address },
      inventoryDeps([{ ...device, ...patch }])
    );
    assert.equal(result.source, 'central_rejected');
  }
});

test('other-company hidden resource and reconciled 404 remain explicit', async () => {
  const result = await resolveEventTechnicalIdentity(
    { tagMac: device.ble_mac, gatewayMac: gateway.mac_address },
    inventoryDeps([])
  );
  assert.equal(result.source, 'central_not_found');
  assert.equal(result.reason, 'central_device_not_found');
  const missingGateway = await resolveEventTechnicalIdentity(
    { tagMac: device.ble_mac, gatewayMac: gateway.mac_address },
    inventoryDeps([device], [])
  );
  assert.equal(missingGateway.source, 'central_not_found');
  assert.equal(missingGateway.reason, 'central_gateway_not_found');
  const inactiveGateway = await resolveEventTechnicalIdentity(
    { tagMac: device.ble_mac, gatewayMac: gateway.mac_address },
    inventoryDeps([device], [{ ...gateway, active: false }])
  );
  assert.equal(inactiveGateway.source, 'central_rejected');
  assert.equal(inactiveGateway.reason, 'central_gateway_inactive');
});

test('only central unavailability enables controlled local event fallback', async () => {
  const result = await resolveEventTechnicalIdentity(
    { tagMac: device.ble_mac, gatewayMac: gateway.mac_address },
    {
      cache: new HardwareInventoryCache(),
      listDevices: async () => ({ kind: 'unavailable', error: 'offline' }),
      listGateways: async () => found([gateway])
    }
  );
  assert.equal(result.source, 'local_fallback');
  assert.equal(result.reason, 'central_unavailable');
});

test('consecutive events share one inventory refresh instead of two remote reads per event', async () => {
  const cache = new HardwareInventoryCache();
  let deviceLists = 0;
  let gatewayLists = 0;
  const deps = {
    cache,
    listDevices: async () => { deviceLists += 1; return found([device]); },
    listGateways: async () => { gatewayLists += 1; return found([gateway]); }
  };
  for (let index = 0; index < 50; index += 1) {
    const result = await resolveEventTechnicalIdentity({ tagMac: device.ble_mac, gatewayMac: gateway.mac_address }, deps);
    assert.equal(result.source, 'central');
  }
  assert.equal(deviceLists, 1);
  assert.equal(gatewayLists, 1);
});

test('cache expiry refreshes inventory and observes central active/status/type changes', async () => {
  let now = 1_000;
  let refreshes = 0;
  let currentDevice = device;
  const cache = new HardwareInventoryCache(() => now);
  const deps = {
    cache,
    listDevices: async () => { refreshes += 1; return found([currentDevice]); },
    listGateways: async () => found([gateway])
  };

  assert.equal((await resolveEventTechnicalIdentity({ tagMac: device.ble_mac, gatewayMac: gateway.mac_address }, deps)).source, 'central');
  currentDevice = { ...device, status: 'maintenance' };
  now += env.HARDWARE_MANAGER_CACHE_TTL_MS - 1;
  assert.equal((await resolveEventTechnicalIdentity({ tagMac: device.ble_mac, gatewayMac: gateway.mac_address }, deps)).source, 'central');
  assert.equal(refreshes, 1);

  now += 1;
  const refreshed = await resolveEventTechnicalIdentity({ tagMac: device.ble_mac, gatewayMac: gateway.mac_address }, deps);
  assert.equal(refreshed.source, 'central_rejected');
  assert.equal(refreshed.reason, 'central_device_status_maintenance');
  assert.equal(refreshes, 2);
});

test('concurrent cache misses are coalesced into one pair of inventory requests', async () => {
  const cache = new HardwareInventoryCache();
  let deviceLists = 0;
  let gatewayLists = 0;
  const deps = {
    cache,
    listDevices: async () => { deviceLists += 1; await Promise.resolve(); return found([device]); },
    listGateways: async () => { gatewayLists += 1; await Promise.resolve(); return found([gateway]); }
  };
  const results = await Promise.all(Array.from({ length: 20 }, () =>
    resolveEventTechnicalIdentity({ tagMac: device.ble_mac, gatewayMac: gateway.mac_address }, deps)
  ));
  assert.ok(results.every((result) => result.source === 'central'));
  assert.equal(deviceLists, 1);
  assert.equal(gatewayLists, 1);
});

test('temporary outage is cached briefly, preserves fallback and retries after error TTL', async () => {
  let now = 1_000;
  let calls = 0;
  let unavailable = true;
  const cache = new HardwareInventoryCache(() => now);
  const deps = {
    cache,
    listDevices: async () => {
      calls += 1;
      return unavailable ? { kind: 'unavailable' as const, error: 'offline' } : found([device]);
    },
    listGateways: async () => found([gateway])
  };
  assert.equal((await resolveEventTechnicalIdentity({ tagMac: device.ble_mac, gatewayMac: gateway.mac_address }, deps)).source, 'local_fallback');
  unavailable = false;
  now += env.HARDWARE_MANAGER_CACHE_ERROR_TTL_MS - 1;
  assert.equal((await resolveEventTechnicalIdentity({ tagMac: device.ble_mac, gatewayMac: gateway.mac_address }, deps)).source, 'local_fallback');
  assert.equal(calls, 1);
  now += 1;
  assert.equal((await resolveEventTechnicalIdentity({ tagMac: device.ble_mac, gatewayMac: gateway.mac_address }, deps)).source, 'central');
  assert.equal(calls, 2);
});

test('tag-control keeps strategy candidates but replaces divergent local MACs with central MACs', async () => {
  const result = await validateTechnicalTargets([{
    tagId: 'tag-local', tagUid: 'AAAAAAAAAAAA', gatewayId: 'gateway-local', gatewayMac: 'bbbbbbbbbbbb',
    hardwareDeviceId: 31, hardwareGatewayId: 41, sameColdRoom: true
  }], {
    lookupDeviceById: async () => found(device),
    lookupGatewayById: async () => found(gateway)
  });
  assert.equal(result[0].tagUid, 'fd9d4f8ae226');
  assert.equal(result[0].gatewayMac, '2805a55efb68');
  assert.equal(result[0].sameColdRoom, true);
});

test('tag-control preserves last_seen, camera_assigned and hybrid selection while correlating central ids', () => {
  const repository = readFileSync(join(process.cwd(), 'src/modules/tag-control/infrastructure/tag-control.repository.ts'), 'utf8');
  assert.match(repository, /type GatewayStrategy = 'last_seen' \| 'camera_assigned' \| 'hybrid'/);
  assert.match(repository, /params\.strategy !== 'camera_assigned'/);
  assert.match(repository, /ORDER BY[\s\S]*same_cold_room|active_cold_room_id/);
  assert.match(repository, /ps\.hardware_device_id = t\.hardware_device_id/);
  assert.match(repository, /g\.hardware_gateway_id = rp\.hardware_gateway_id/);
});

test('tag-control excludes unmapped or inactive hardware but falls back on outage', async () => {
  assert.deepEqual(await validateTechnicalTargets([{
    tagId: 'tag-local', tagUid: 'aaaaaaaaaaaa', gatewayId: 'gateway-local', gatewayMac: 'bbbbbbbbbbbb'
  }]), []);
  const candidate = {
    tagId: 'tag-local', tagUid: 'aaaaaaaaaaaa', gatewayId: 'gateway-local', gatewayMac: 'bbbbbbbbbbbb',
    hardwareDeviceId: 31, hardwareGatewayId: 41
  };
  assert.deepEqual(await validateTechnicalTargets([candidate], {
    lookupDeviceById: async () => found({ ...device, active: false }),
    lookupGatewayById: async () => found(gateway)
  }), []);
  assert.deepEqual(await validateTechnicalTargets([candidate], {
    lookupDeviceById: async () => ({ kind: 'unavailable', error: 'offline' }),
    lookupGatewayById: async () => found(gateway)
  }), [candidate]);
});

test('RSSI and B5 command routes derive the topic MAC from the central gateway', async () => {
  const local = {
    id: 'gateway-local', gateway_mac: 'AAAAAAAAAAAA', hardware_gateway_id: 41,
    rssi_threshold: -70, cold_room_id: null, plant_id: null
  };
  const mac = await resolveGatewayMacForCommand(local, {
    fetch: async () => new Response(JSON.stringify(gateway), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  assert.equal(mac, '2805a55efb68');
  const routes = readFileSync(join(process.cwd(), 'src/modules/gateways/gateways.routes.ts'), 'utf8');
  assert.match(routes, /msg_id: 1042/);
  assert.match(routes, /gatewayTopic\(gatewayMac\)/);
  assert.match(routes, /configureEmergencyButton\(\{ gatewayMac, topic \}\)/);
  assert.match(routes, /MQTT_COMMAND_TOPIC_TEMPLATE/);
  assert.doesNotMatch(routes, /\/MKGW3\/.*\/send/);
});

test('CRUD técnico local queda bloqueado y PATCH de tags conserva solo los tres tiempos físicos', () => {
  const tags = readFileSync(join(process.cwd(), 'src/modules/tags/tags.routes.ts'), 'utf8');
  const gateways = readFileSync(join(process.cwd(), 'src/modules/gateways/gateways.routes.ts'), 'utf8');
  assert.match(tags, /hardware_manager_authoritative/);
  assert.match(tags, /physical_alarm_followup_delay_ms = COALESCE/);
  assert.match(tags, /physical_alarm_buzzer_duration_ms = COALESCE/);
  assert.match(tags, /physical_alarm_vibration_duration_ms = COALESCE/);
  assert.doesNotMatch(tags.slice(tags.indexOf("tagsRouter.patch('/:id'"), tags.indexOf("tagsRouter.delete('/:id'")), /SET tag_uid|SET model|SET active/);
  assert.match(gateways, /Solo rssiThreshold es editable localmente/);
  assert.doesNotMatch(gateways.slice(gateways.indexOf("gatewaysRouter.patch('/:id'"), gateways.indexOf("gatewaysRouter.post('/:id\/apply-rssi'")), /SET gateway_mac|SET description/);
});

test('stale-session correlation prefers central hardware ids and keeps legacy fallback', () => {
  const compliance = readFileSync(join(process.cwd(), 'src/modules/compliance/compliance.service.ts'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/016_presence_hardware_references.sql'), 'utf8');
  assert.match(compliance, /ps\.hardware_device_id = t\.hardware_device_id/);
  assert.match(compliance, /ps\.hardware_gateway_id = seen_gateway\.hardware_gateway_id/);
  assert.match(compliance, /ps\.hardware_device_id IS NULL/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS hardware_gateway_id INTEGER/);
  assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE/i);
});
