import { normalizeMacAddress } from '../utils/mac';

export type ReconciliationLocalDevice = {
  id: string;
  tag_uid: string | null;
  model: string | null;
  active: boolean;
  hardware_device_id: number | null;
  created_at: string;
};

export type ReconciliationCentralDevice = {
  id: number;
  name: string | null;
  ble_mac: string;
  description: string | null;
  device_type: string;
  status: string;
  active: boolean;
  company_id: string | null;
  company_code: string | null;
};

export type DeviceReconciliationPlan = {
  local: ReconciliationLocalDevice;
  mac: string;
  central?: ReconciliationCentralDevice;
  action: 'create' | 'reuse' | 'link_unassigned';
  differences: string[];
};

function duplicateKeys<T>(rows: T[], key: (row: T) => string | null): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

export function buildDeviceReconciliation(params: {
  localRows: ReconciliationLocalDevice[];
  centralRows: ReconciliationCentralDevice[];
  company?: { id: string; active: boolean };
}) {
  const { localRows, centralRows, company } = params;
  const duplicateLocalMacs = duplicateKeys(localRows, (row) => normalizeMacAddress(row.tag_uid));
  const duplicateCentralMacs = duplicateKeys(centralRows, (row) => normalizeMacAddress(row.ble_mac));
  const duplicateLocalHardwareIds = duplicateKeys(localRows, (row) =>
    row.hardware_device_id === null ? null : String(row.hardware_device_id)
  );
  const centralById = new Map(centralRows.map((row) => [row.id, row]));
  const centralByMac = new Map<string, ReconciliationCentralDevice[]>();
  for (const device of centralRows) {
    const mac = normalizeMacAddress(device.ble_mac);
    if (mac) centralByMac.set(mac, [...(centralByMac.get(mac) ?? []), device]);
  }

  const conflicts: Array<Record<string, unknown>> = [];
  if (!company || !company.active) conflicts.push({ type: 'horneo_company_missing_or_inactive' });
  for (const mac of duplicateLocalMacs) conflicts.push({ type: 'duplicate_local_mac', mac });
  for (const mac of duplicateCentralMacs) conflicts.push({ type: 'duplicate_central_mac', mac });
  for (const id of duplicateLocalHardwareIds) {
    conflicts.push({ type: 'duplicate_local_hardware_device_id', hardwareDeviceId: Number(id) });
  }
  for (const row of localRows.filter((item) => !normalizeMacAddress(item.tag_uid))) {
    conflicts.push({ type: 'invalid_local_mac', id: row.id, tagUid: row.tag_uid });
  }

  const plans: DeviceReconciliationPlan[] = [];
  for (const local of localRows) {
    const mac = normalizeMacAddress(local.tag_uid);
    if (
      !mac ||
      duplicateLocalMacs.includes(mac) ||
      duplicateCentralMacs.includes(mac) ||
      (local.hardware_device_id !== null && duplicateLocalHardwareIds.includes(String(local.hardware_device_id)))
    ) continue;

    const central = (centralByMac.get(mac) ?? [])[0];
    const storedCentral = local.hardware_device_id === null
      ? undefined
      : centralById.get(local.hardware_device_id);

    if (local.hardware_device_id !== null && !storedCentral) {
      conflicts.push({
        type: 'hardware_device_id_orphan',
        localTagId: local.id,
        storedHardwareDeviceId: local.hardware_device_id,
        mac
      });
      continue;
    }
    if (storedCentral && normalizeMacAddress(storedCentral.ble_mac) !== mac) {
      conflicts.push({
        type: 'hardware_device_id_mac_mismatch',
        localTagId: local.id,
        storedHardwareDeviceId: storedCentral.id,
        storedMac: storedCentral.ble_mac,
        localMac: mac,
        matchedCentralDeviceId: central?.id ?? null
      });
      continue;
    }
    if (storedCentral?.company_id && storedCentral.company_id !== company?.id) {
      conflicts.push({
        type: 'hardware_device_id_other_company',
        localTagId: local.id,
        centralDeviceId: storedCentral.id,
        mac,
        companyCode: storedCentral.company_code
      });
      continue;
    }
    if (central?.company_id && central.company_id !== company?.id) {
      conflicts.push({
        type: 'device_owned_by_other_company',
        localTagId: local.id,
        centralDeviceId: central.id,
        mac,
        companyCode: central.company_code
      });
      continue;
    }
    if (central && (central.active !== local.active || central.status !== (local.active ? 'active' : 'inactive'))) {
      conflicts.push({
        type: 'central_device_operational_state_mismatch',
        localTagId: local.id,
        centralDeviceId: central.id,
        mac,
        localActive: local.active,
        centralActive: central.active,
        centralStatus: central.status
      });
      continue;
    }
    if (central && !['b5', 'unknown'].includes(central.device_type)) {
      conflicts.push({
        type: 'central_device_type_conflict',
        localTagId: local.id,
        centralDeviceId: central.id,
        mac,
        deviceType: central.device_type
      });
      continue;
    }

    const differences: string[] = [];
    if (central && central.ble_mac !== mac) differences.push('mac_format');
    if (central && central.device_type !== 'b5') differences.push('device_type');
    if (central && local.model && central.name !== local.model) differences.push('name_model');
    plans.push({
      local,
      mac,
      central,
      action: !central ? 'create' : central.company_id ? 'reuse' : 'link_unassigned',
      differences
    });
  }

  const matchedIds = new Set(plans.flatMap((plan) => plan.central ? [plan.central.id] : []));
  const centralWithoutLocal = centralRows
    .filter((row) => row.company_id === company?.id && !matchedIds.has(row.id))
    .map((row) => ({ id: row.id, mac: row.ble_mac }));
  const centralWithoutCompany = centralRows
    .filter((row) => row.company_id === null)
    .map((row) => ({ id: row.id, mac: row.ble_mac }));

  return {
    conflicts,
    plans,
    centralWithoutLocal,
    centralWithoutCompany,
    duplicateLocalMacs,
    duplicateCentralMacs,
    duplicateLocalHardwareIds
  };
}
