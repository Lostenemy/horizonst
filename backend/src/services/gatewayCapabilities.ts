export interface GatewayFirmwareIdentity {
  product_model?: string | null;
  firmware_version?: string | null;
  firmware_evidence?: string | null;
}

const EVIDENCE_REFERENCE = /^(?:inspection|device-info-2002):[A-Za-z0-9._/-]{8,120}$/;

export function hasVerifiedMkgw3V2(gateway: GatewayFirmwareIdentity): boolean {
  return gateway.product_model?.trim().toUpperCase() === 'MKGW3'
    && /^V?2\.\d+(?:\.\d+)?$/i.test(gateway.firmware_version?.trim() ?? '')
    && EVIDENCE_REFERENCE.test(gateway.firmware_evidence?.trim() ?? '');
}

export function requiresMkgw3V2(operation: string, value: unknown): boolean {
  return operation === 'report-interval' || operation === 'scan-mode'
    || (operation === 'filter-relation' && value === 8)
    || (operation === 'phy' && value === 4);
}

export function parseGatewayFirmwareRecord(input: unknown): { productModel: 'MKGW3'; firmwareVersion: string; evidence: string } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'evidence,firmwareVersion,productModel') return null;
  if (typeof value.productModel !== 'string' || value.productModel.trim().toUpperCase() !== 'MKGW3'
      || typeof value.firmwareVersion !== 'string' || !/^V?\d+\.\d+(?:\.\d+)?$/i.test(value.firmwareVersion.trim())
      || typeof value.evidence !== 'string' || !EVIDENCE_REFERENCE.test(value.evidence.trim())) return null;
  return {
    productModel: 'MKGW3',
    firmwareVersion: value.firmwareVersion.trim().toUpperCase(),
    evidence: value.evidence.trim()
  };
}
