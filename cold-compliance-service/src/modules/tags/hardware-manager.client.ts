import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export type LocalTagReference = {
  id: string;
  tag_uid: string;
  hardware_device_id: number | null;
  model: string | null;
  active: boolean;
  physical_alarm_followup_delay_ms?: number;
  physical_alarm_buzzer_duration_ms?: number;
  physical_alarm_vibration_duration_ms?: number;
};

export type HardwareDevice = {
  id: number;
  name: string | null;
  ble_mac: string;
  description: string | null;
  company_id: string;
  device_type: string;
  status: string;
  active: boolean;
};

export type HardwareDeviceResolution = {
  source: 'central' | 'local_fallback' | 'local_disabled';
  local: LocalTagReference;
  central: HardwareDevice | null;
  divergences: string[];
};

export function normalizeHorneoDeviceMac(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(normalized) ? normalized : null;
}

async function requestHardwareDevice(
  path: string,
  fetchImpl: typeof fetch = fetch
): Promise<HardwareDevice | null> {
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
    return await response.json() as HardwareDevice;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveHardwareDevice(
  local: LocalTagReference,
  deps?: { fetch?: typeof fetch }
): Promise<HardwareDeviceResolution> {
  if (!env.HARDWARE_MANAGER_ENABLED) {
    return { source: 'local_disabled', local, central: null, divergences: [] };
  }

  const localMac = normalizeHorneoDeviceMac(local.tag_uid);
  const divergences: string[] = [];
  if (!localMac) {
    return { source: 'local_fallback', local, central: null, divergences: ['invalid_local_mac'] };
  }

  try {
    let central = local.hardware_device_id
      ? await requestHardwareDevice(`/api/internal/v1/hardware/devices/${local.hardware_device_id}`, deps?.fetch)
      : null;
    if (!central) {
      central = await requestHardwareDevice(`/api/internal/v1/hardware/devices/by-mac/${localMac}`, deps?.fetch);
    }
    if (!central) {
      divergences.push('central_device_not_found');
      logger.warn({ localTagId: local.id, tagUid: localMac, divergences }, 'hardware device dual-read fallback');
      return { source: 'local_fallback', local, central: null, divergences };
    }

    if (local.hardware_device_id && central.id !== local.hardware_device_id) divergences.push('hardware_device_id');
    if (normalizeHorneoDeviceMac(central.ble_mac) !== localMac) divergences.push('tag_uid');
    if (central.active !== local.active) divergences.push('active');
    if (central.status !== (local.active ? 'active' : 'inactive')) divergences.push('status');
    if (central.device_type !== 'b5') divergences.push('device_type');
    if (divergences.length) {
      logger.warn(
        { localTagId: local.id, hardwareDeviceId: central.id, tagUid: localMac, divergences },
        'hardware device dual-read divergence'
      );
    }
    return { source: 'central', local, central, divergences };
  } catch (error) {
    logger.warn(
      { localTagId: local.id, tagUid: localMac, error: String(error) },
      'Hardware Manager unavailable; using local device fallback'
    );
    return { source: 'local_fallback', local, central: null, divergences: ['central_unavailable'] };
  }
}
