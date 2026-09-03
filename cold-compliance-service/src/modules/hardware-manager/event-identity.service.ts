import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  HardwareGateway,
  listHardwareGateways,
  normalizeHorneoGatewayMac
} from '../gateways/hardware-manager.client';
import {
  HardwareDevice,
  HardwareLookup,
  isOperationalB5,
  listHardwareDevices,
  normalizeHorneoDeviceMac
} from '../tags/hardware-manager.client';

type HardwareInventory = {
  devicesByMac: Map<string, HardwareDevice>;
  gatewaysByMac: Map<string, HardwareGateway>;
};

type InventoryLoaders = {
  listDevices: () => Promise<HardwareLookup<HardwareDevice[]>>;
  listGateways: () => Promise<HardwareLookup<HardwareGateway[]>>;
};

export class HardwareInventoryCache {
  private cached: { expiresAt: number; result: HardwareLookup<HardwareInventory> } | null = null;
  private inFlight: Promise<HardwareLookup<HardwareInventory>> | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  clear(): void {
    this.cached = null;
    this.inFlight = null;
  }

  async get(loaders: InventoryLoaders): Promise<HardwareLookup<HardwareInventory>> {
    const now = this.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.result;
    if (this.inFlight) return this.inFlight;

    this.inFlight = Promise.all([loaders.listDevices(), loaders.listGateways()])
      .then(([devices, gateways]): HardwareLookup<HardwareInventory> => {
        if (devices.kind === 'not_found' || gateways.kind === 'not_found') return { kind: 'not_found' };
        if (devices.kind === 'unavailable' || gateways.kind === 'unavailable') {
          return {
            kind: 'unavailable',
            error: devices.kind === 'unavailable' ? devices.error : gateways.kind === 'unavailable' ? gateways.error : 'unknown'
          };
        }

        const devicesByMac = new Map<string, HardwareDevice>();
        for (const device of devices.value) {
          const mac = normalizeHorneoDeviceMac(device.ble_mac);
          if (mac) devicesByMac.set(mac, device);
        }
        const gatewaysByMac = new Map<string, HardwareGateway>();
        for (const gateway of gateways.value) {
          const mac = normalizeHorneoGatewayMac(gateway.mac_address);
          if (mac) gatewaysByMac.set(mac, gateway);
        }
        return { kind: 'found', value: { devicesByMac, gatewaysByMac } };
      })
      .then((result) => {
        const ttlMs = result.kind === 'unavailable'
          ? env.HARDWARE_MANAGER_CACHE_ERROR_TTL_MS
          : env.HARDWARE_MANAGER_CACHE_TTL_MS;
        this.cached = { expiresAt: this.now() + ttlMs, result };
        return result;
      })
      .finally(() => { this.inFlight = null; });

    return this.inFlight;
  }
}

const sharedInventoryCache = new HardwareInventoryCache();

export function clearEventTechnicalIdentityCache(): void {
  sharedInventoryCache.clear();
}

export type EventTechnicalIdentity = {
  source: 'central' | 'central_unavailable' | 'central_not_found' | 'central_rejected';
  tagMac: string;
  gatewayMac: string;
  hardwareDeviceId: number | null;
  hardwareGatewayId: number | null;
  device: HardwareDevice | null;
  gateway: HardwareGateway | null;
  reason?: string;
};

export async function resolveEventTechnicalIdentity(
  input: { tagMac: string; gatewayMac: string },
  deps?: {
    cache?: HardwareInventoryCache;
    listDevices?: InventoryLoaders['listDevices'];
    listGateways?: InventoryLoaders['listGateways'];
  }
): Promise<EventTechnicalIdentity> {
  const tagMac = normalizeHorneoDeviceMac(input.tagMac) ?? input.tagMac.replace(/[:-]/g, '').toUpperCase();
  const gatewayMac = normalizeHorneoGatewayMac(input.gatewayMac) ?? input.gatewayMac.replace(/[:-]/g, '').toLowerCase();
  const base = { tagMac, gatewayMac, hardwareDeviceId: null, hardwareGatewayId: null, device: null, gateway: null };

  if (!env.HARDWARE_MANAGER_ENABLED) {
    return { source: 'central_unavailable', ...base, reason: 'central_disabled' };
  }

  const inventory = await (deps?.cache ?? sharedInventoryCache).get({
    listDevices: deps?.listDevices ?? (() => listHardwareDevices()),
    listGateways: deps?.listGateways ?? (() => listHardwareGateways())
  });

  if (inventory.kind === 'not_found') {
    const reason = 'central_inventory_not_found';
    logger.warn({ tagMac, gatewayMac, reason }, 'event technical identity not found in Hardware Manager');
    return { source: 'central_not_found', ...base, reason };
  }

  if (inventory.kind === 'unavailable') {
    logger.warn({
      tagMac,
      gatewayMac,
      error: inventory.error
    }, 'Hardware Manager unavailable; rejecting event without central identity');
    return { source: 'central_unavailable', ...base, reason: 'central_unavailable' };
  }

  const device = inventory.value.devicesByMac.get(tagMac);
  const gateway = inventory.value.gatewaysByMac.get(gatewayMac);
  if (!device || !gateway) {
    const reason = !device ? 'central_device_not_found' : 'central_gateway_not_found';
    logger.warn({ tagMac, gatewayMac, reason }, 'event technical identity not found in cached Hardware Manager inventory');
    return { source: 'central_not_found', ...base, reason };
  }
  if (!isOperationalB5(device)) {
    const reason = !device.active ? 'central_device_inactive'
      : device.status !== 'active' ? `central_device_status_${device.status}`
        : `central_device_type_${device.device_type}`;
    logger.warn({ tagMac, gatewayMac, hardwareDeviceId: device.id, reason }, 'event device rejected by central state');
    return { source: 'central_rejected', ...base, device, gateway, reason };
  }
  if (!gateway.active) {
    logger.warn({ tagMac, gatewayMac, hardwareGatewayId: gateway.id }, 'event gateway rejected by central state');
    return { source: 'central_rejected', ...base, device, gateway, reason: 'central_gateway_inactive' };
  }

  return {
    source: 'central',
    tagMac: normalizeHorneoDeviceMac(device.ble_mac)!,
    gatewayMac: normalizeHorneoGatewayMac(gateway.mac_address)!,
    hardwareDeviceId: device.id,
    hardwareGatewayId: gateway.id,
    device,
    gateway
  };
}
