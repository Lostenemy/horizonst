import { normalizeGatewayMac } from '../utils/mac';
import { GatewayCommandPayload } from './gatewayCommands';

export type BluetoothOperation = 'scan' | 'filter-relation' | 'duplicates' | 'phy' | 'report-interval' | 'scan-mode';

const commandIds: Record<BluetoothOperation, number> = {
  scan: 1040,
  'filter-relation': 1041,
  duplicates: 1057,
  phy: 1060,
  'report-interval': 1063,
  'scan-mode': 1066
};

const definitions: Record<BluetoothOperation, { field: string; allowed?: readonly number[]; min?: number; max?: number }> = {
  scan: { field: 'scan_switch', allowed: [0, 1] },
  'filter-relation': { field: 'relation', allowed: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  duplicates: { field: 'rule', allowed: [0, 1, 2, 3] },
  phy: { field: 'phy_filter', allowed: [0, 1, 2, 3, 4] },
  'report-interval': { field: 'interval', min: 0, max: 86400 },
  'scan-mode': { field: 'scan_mode', allowed: [0, 1] }
};

export function isBluetoothOperation(value: string): value is BluetoothOperation {
  return Object.prototype.hasOwnProperty.call(definitions, value);
}

export function buildBluetoothGatewayCommand(gatewayMacInput: string, operation: BluetoothOperation, input: unknown): GatewayCommandPayload {
  const gatewayMac = normalizeGatewayMac(gatewayMacInput);
  const definition = definitions[operation];
  if (!gatewayMac || !definition || !input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid Bluetooth gateway command');
  }
  const fields = Object.keys(input);
  const value = (input as Record<string, unknown>)[definition.field];
  if (fields.length !== 1 || fields[0] !== definition.field || !Number.isInteger(value) ||
      (definition.allowed && !definition.allowed.includes(value as number)) ||
      (definition.min !== undefined && (value as number) < definition.min) ||
      (definition.max !== undefined && (value as number) > definition.max)) {
    throw new Error(`Invalid ${definition.field} value`);
  }
  return {
    msg_id: commandIds[operation],
    device_info: { mac: gatewayMac.toUpperCase() },
    data: { [definition.field]: value as number }
  };
}
