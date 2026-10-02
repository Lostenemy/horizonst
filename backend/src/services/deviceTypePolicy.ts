export interface DeviceTypePolicy {
  known: boolean;
  typeActive: boolean;
  companyAllowed: boolean;
  horneoCompatible: boolean;
}
export const validDeviceTypeCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value);

export function operationalDevicePolicy(device: { active: boolean; status: string; device_type: string; type_policy?: DeviceTypePolicy }): boolean {
  const policy = device.type_policy;
  return device.active && device.status === 'active' && device.device_type === 'b5'
    && policy?.known === true && policy.companyAllowed === true && policy.horneoCompatible === true;
}
