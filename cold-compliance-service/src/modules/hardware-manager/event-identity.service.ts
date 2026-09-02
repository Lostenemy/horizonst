import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  HardwareGateway,
  lookupHardwareGatewayByMac,
  normalizeHorneoGatewayMac
} from '../gateways/hardware-manager.client';
import {
  HardwareDevice,
  isOperationalB5,
  lookupHardwareDeviceByMac,
  normalizeHorneoDeviceMac
} from '../tags/hardware-manager.client';

export type EventTechnicalIdentity = {
  source: 'central' | 'local_fallback' | 'local_disabled' | 'central_not_found' | 'central_rejected';
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
    lookupDeviceByMac?: typeof lookupHardwareDeviceByMac;
    lookupGatewayByMac?: typeof lookupHardwareGatewayByMac;
  }
): Promise<EventTechnicalIdentity> {
  const tagMac = normalizeHorneoDeviceMac(input.tagMac) ?? input.tagMac.replace(/[:-]/g, '').toUpperCase();
  const gatewayMac = normalizeHorneoGatewayMac(input.gatewayMac) ?? input.gatewayMac.replace(/[:-]/g, '').toLowerCase();
  const base = { tagMac, gatewayMac, hardwareDeviceId: null, hardwareGatewayId: null, device: null, gateway: null };

  if (!env.HARDWARE_MANAGER_ENABLED) return { source: 'local_disabled', ...base };

  const [deviceLookup, gatewayLookup] = await Promise.all([
    (deps?.lookupDeviceByMac ?? lookupHardwareDeviceByMac)(tagMac),
    (deps?.lookupGatewayByMac ?? lookupHardwareGatewayByMac)(gatewayMac)
  ]);

  if (deviceLookup.kind === 'not_found' || gatewayLookup.kind === 'not_found') {
    const reason = deviceLookup.kind === 'not_found' ? 'central_device_not_found' : 'central_gateway_not_found';
    logger.warn({ tagMac, gatewayMac, reason }, 'event technical identity not found in Hardware Manager');
    return { source: 'central_not_found', ...base, reason };
  }

  if (deviceLookup.kind === 'unavailable' || gatewayLookup.kind === 'unavailable') {
    logger.warn({
      tagMac,
      gatewayMac,
      deviceResult: deviceLookup.kind,
      gatewayResult: gatewayLookup.kind
    }, 'Hardware Manager unavailable; using controlled local event fallback');
    return { source: 'local_fallback', ...base, reason: 'central_unavailable' };
  }

  const device = deviceLookup.value;
  const gateway = gatewayLookup.value;
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
