import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export type LocalGatewayReference = {
  id: string;
  gateway_mac: string;
  hardware_gateway_id: number | null;
  rssi_threshold: number;
  cold_room_id: string | null;
  plant_id: string | null;
};

export type HardwareGateway = {
  id: number;
  name: string | null;
  mac_address: string;
  description: string | null;
  company_id: string;
  rssi_threshold: number;
  active: boolean;
  place_id?: number | null;
  place_name?: string | null;
};

export type HardwareGatewayResolution = {
  source: 'central' | 'local_fallback' | 'local_disabled';
  local: LocalGatewayReference;
  central: HardwareGateway | null;
  divergences: string[];
};

export function normalizeHorneoGatewayMac(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return /^[0-9a-f]{12}$/.test(normalized) ? normalized : null;
}

async function requestHardwareGateway(
  path: string,
  fetchImpl: typeof fetch = fetch
): Promise<HardwareGateway | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.HARDWARE_MANAGER_TIMEOUT_MS);
  timer.unref();
  try {
    const response = await fetchImpl(`${env.HARDWARE_MANAGER_BASE_URL.replace(/\/$/, '')}${path}`, {
      headers: { Authorization: `Bearer ${env.HARDWARE_MANAGER_SERVICE_TOKEN}` },
      signal: controller.signal
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Hardware Manager returned HTTP ${response.status}`);
    return await response.json() as HardwareGateway;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveHardwareGateway(
  local: LocalGatewayReference,
  deps?: { fetch?: typeof fetch }
): Promise<HardwareGatewayResolution> {
  if (!env.HARDWARE_MANAGER_ENABLED) {
    return { source: 'local_disabled', local, central: null, divergences: [] };
  }

  const localMac = normalizeHorneoGatewayMac(local.gateway_mac);
  const divergences: string[] = [];
  if (!localMac) {
    return { source: 'local_fallback', local, central: null, divergences: ['invalid_local_mac'] };
  }

  try {
    let central = local.hardware_gateway_id
      ? await requestHardwareGateway(`/api/internal/v1/hardware/gateways/${local.hardware_gateway_id}`, deps?.fetch)
      : null;
    if (!central) {
      central = await requestHardwareGateway(`/api/internal/v1/hardware/gateways/by-mac/${localMac}`, deps?.fetch);
    }
    if (!central) {
      divergences.push('central_gateway_not_found');
      logger.warn({ localGatewayId: local.id, gatewayMac: localMac, divergences }, 'hardware gateway dual-read fallback');
      return { source: 'local_fallback', local, central: null, divergences };
    }

    if (local.hardware_gateway_id && central.id !== local.hardware_gateway_id) divergences.push('hardware_gateway_id');
    if (normalizeHorneoGatewayMac(central.mac_address) !== localMac) divergences.push('gateway_mac');
    if (central.rssi_threshold !== local.rssi_threshold) divergences.push('rssi_threshold');
    if (divergences.length) {
      logger.warn({ localGatewayId: local.id, hardwareGatewayId: central.id, gatewayMac: localMac, divergences }, 'hardware gateway dual-read divergence');
    }
    return { source: 'central', local, central, divergences };
  } catch (error) {
    logger.warn({ localGatewayId: local.id, gatewayMac: localMac, error: String(error) }, 'Hardware Manager unavailable; using local gateway fallback');
    return { source: 'local_fallback', local, central: null, divergences: ['central_unavailable'] };
  }
}
