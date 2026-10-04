import { env } from '../../config/env';
import { HardwareDevice, LocalTagReference, isOperationalB5, listHardwareDevices, normalizeHorneoDeviceMac } from './hardware-manager.client';

export type TagAvailability = 'available' | 'not_in_company' | 'ineligible' | 'unverified';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A complete scoped inventory is evidence of absence only after validating its contract.
// Do not share this decision/cache with presence or physical alarm fallback.
function validDevice(value: unknown): value is HardwareDevice {
  if (!value || typeof value !== 'object') return false;
  const d = value as HardwareDevice;
  const p = d.type_policy;
  return Number.isSafeInteger(d.id) && d.id > 0 && normalizeHorneoDeviceMac(d.ble_mac) !== null
    && typeof d.company_id === 'string' && uuid.test(d.company_id)
    && typeof d.active === 'boolean' && typeof d.status === 'string' && typeof d.device_type === 'string'
    && !!p && ['known', 'typeActive', 'companyAllowed', 'horneoCompatible'].every(key => typeof (p as any)[key] === 'boolean');
}

function matches(local: LocalTagReference, central: HardwareDevice): boolean {
  return central.id === local.hardware_device_id
    && normalizeHorneoDeviceMac(local.tag_uid) === normalizeHorneoDeviceMac(central.ble_mac);
}

export async function verifyTagAssignment(local: LocalTagReference, fetchImpl?: typeof fetch): Promise<TagAvailability> {
  if (!env.HARDWARE_MANAGER_ENABLED || typeof local.hardware_device_id !== 'number' || !Number.isSafeInteger(local.hardware_device_id) || local.hardware_device_id <= 0) return 'unverified';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.HARDWARE_MANAGER_TIMEOUT_MS);
  timer.unref();
  try {
    const response = await (fetchImpl ?? fetch)(`${env.HARDWARE_MANAGER_BASE_URL.replace(/\/$/, '')}/api/internal/v1/hardware/devices/${local.hardware_device_id}`, {
      headers: { Authorization: `Bearer ${env.HARDWARE_MANAGER_SERVICE_TOKEN}` }, signal: controller.signal, cache: 'no-store'
    });
    // A proxy/router 404 or malformed body is not a confirmed scoped device absence.
    const body: unknown = await response.json();
    if (response.status === 404) return (body as any)?.message === 'Device not found' ? 'not_in_company' : 'unverified';
    if (!response.ok || !validDevice(body) || !matches(local, body)) return 'unverified';
    return isOperationalB5(body) ? 'available' : 'ineligible';
  } catch { return 'unverified'; }
  finally { clearTimeout(timer); }
}

export async function operationalTagInventory<T extends LocalTagReference>(rows: T[], fetchImpl?: typeof fetch) {
  const unverified = (source: string) => rows.map(row => ({ ...row, hardware_source: source,
    assignment_available: false, availability_status: 'unverified' as TagAvailability }));
  if (!env.HARDWARE_MANAGER_ENABLED) return unverified('local_disabled');
  const lookup = await listHardwareDevices(fetchImpl);
  if (lookup.kind !== 'found' || !Array.isArray(lookup.value) || !lookup.value.every(validDevice)
    || new Set(lookup.value.map(d => d.id)).size !== lookup.value.length) return unverified('local_fallback');
  const byId = new Map(lookup.value.map(d => [d.id, d]));
  return rows.flatMap(row => {
    if (typeof row.hardware_device_id !== 'number' || !Number.isSafeInteger(row.hardware_device_id) || row.hardware_device_id <= 0) return [{ ...row,
      hardware_source: 'central_unlinked', assignment_available: false, availability_status: 'unverified' as TagAvailability }];
    const central = byId.get(row.hardware_device_id);
    if (!central) return []; // Confirmed outside the principal's scope, not deletion of the overlay.
    if (!matches(row, central)) return [{ ...row, hardware_source: 'central_identity_mismatch',
      assignment_available: false, availability_status: 'unverified' as TagAvailability }];
    const allowed = isOperationalB5(central);
    return [{ ...row, hardware_source: 'central', hardware_name: central.name,
      tag_uid: normalizeHorneoDeviceMac(central.ble_mac)!.toLowerCase(), active: central.active,
      status: central.status, device_type: central.device_type, type_policy: central.type_policy,
      technical_description: central.description, operational_allowed: allowed,
      assignment_available: allowed, availability_status: (allowed ? 'available' : 'ineligible') as TagAvailability }];
  });
}
