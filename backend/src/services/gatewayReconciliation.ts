import { normalizeGatewayMac } from '../utils/mac';

export type ReconciliationLocalGateway = {
  id: string;
  gateway_mac: string | null;
  description: string | null;
  rssi_threshold: number;
  cold_room_id: string | null;
  plant_id: string | null;
  hardware_gateway_id: number | null;
  created_at: string;
};

export type ReconciliationCentralGateway = {
  id: number;
  name: string | null;
  mac_address: string;
  description: string | null;
  rssi_threshold: number;
  active: boolean;
  company_id: string | null;
  company_code: string | null;
};

export type GatewayReconciliationPlan = {
  local: ReconciliationLocalGateway;
  mac: string;
  central?: ReconciliationCentralGateway;
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

export function buildGatewayReconciliation(params: {
  localRows: ReconciliationLocalGateway[];
  centralRows: ReconciliationCentralGateway[];
  company?: { id: string; active: boolean };
}) {
  const { localRows, centralRows, company } = params;
  const duplicateLocalMacs = duplicateKeys(localRows, (row) => normalizeGatewayMac(row.gateway_mac));
  const duplicateCentralMacs = duplicateKeys(centralRows, (row) => normalizeGatewayMac(row.mac_address));
  const centralByMac = new Map<string, ReconciliationCentralGateway[]>();
  for (const gateway of centralRows) {
    const mac = normalizeGatewayMac(gateway.mac_address);
    if (mac) centralByMac.set(mac, [...(centralByMac.get(mac) ?? []), gateway]);
  }

  const conflicts: Array<Record<string, unknown>> = [];
  if (!company || !company.active) conflicts.push({ type: 'horneo_company_missing_or_inactive' });
  for (const mac of duplicateLocalMacs) conflicts.push({ type: 'duplicate_local_mac', mac });
  for (const mac of duplicateCentralMacs) conflicts.push({ type: 'duplicate_central_mac', mac });
  for (const row of localRows.filter((item) => !normalizeGatewayMac(item.gateway_mac))) {
    conflicts.push({ type: 'invalid_local_mac', id: row.id, gatewayMac: row.gateway_mac });
  }

  const plans: GatewayReconciliationPlan[] = [];
  for (const gateway of localRows) {
    const mac = normalizeGatewayMac(gateway.gateway_mac);
    if (!mac || duplicateLocalMacs.includes(mac) || duplicateCentralMacs.includes(mac)) continue;
    const centralGateway = (centralByMac.get(mac) ?? [])[0];
    const storedCentral = gateway.hardware_gateway_id
      ? centralRows.find((row) => row.id === gateway.hardware_gateway_id)
      : undefined;
    if (storedCentral && storedCentral.id !== centralGateway?.id) {
      conflicts.push({
        type: 'hardware_gateway_id_mismatch',
        localGatewayId: gateway.id,
        storedHardwareGatewayId: storedCentral.id,
        matchedCentralGatewayId: centralGateway?.id ?? null,
        mac
      });
      continue;
    }
    if (gateway.hardware_gateway_id && !storedCentral) {
      conflicts.push({
        type: 'hardware_gateway_id_orphan',
        localGatewayId: gateway.id,
        storedHardwareGatewayId: gateway.hardware_gateway_id,
        mac
      });
      continue;
    }
    if (centralGateway?.company_id && centralGateway.company_id !== company?.id) {
      conflicts.push({
        type: 'gateway_owned_by_other_company',
        localGatewayId: gateway.id,
        centralGatewayId: centralGateway.id,
        mac,
        companyCode: centralGateway.company_code
      });
      continue;
    }
    if (centralGateway && !centralGateway.active) {
      conflicts.push({
        type: 'central_gateway_inactive',
        localGatewayId: gateway.id,
        centralGatewayId: centralGateway.id,
        mac
      });
      continue;
    }
    const differences: string[] = [];
    if (centralGateway && centralGateway.rssi_threshold !== gateway.rssi_threshold) differences.push('rssi_threshold');
    if (centralGateway && normalizeGatewayMac(centralGateway.mac_address) !== centralGateway.mac_address) differences.push('mac_format');
    if (centralGateway && gateway.description && centralGateway.name !== gateway.description) differences.push('name_description');
    plans.push({
      local: gateway,
      mac,
      central: centralGateway,
      action: !centralGateway ? 'create' : centralGateway.company_id ? 'reuse' : 'link_unassigned',
      differences
    });
  }

  const matchedMacs = new Set(plans.map((plan) => plan.mac));
  const centralWithoutLocal = centralRows
    .filter((row) => row.company_id === company?.id && !matchedMacs.has(normalizeGatewayMac(row.mac_address) ?? ''))
    .map((row) => ({ id: row.id, mac: row.mac_address }));
  const centralWithoutCompany = centralRows
    .filter((row) => row.company_id === null)
    .map((row) => ({ id: row.id, mac: row.mac_address }));

  return {
    conflicts,
    plans,
    centralWithoutLocal,
    centralWithoutCompany,
    duplicateLocalMacs,
    duplicateCentralMacs
  };
}
