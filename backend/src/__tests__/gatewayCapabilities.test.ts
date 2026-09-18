import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { hasVerifiedMkgw3V2, parseGatewayFirmwareRecord, requiresMkgw3V2 } from '../services/gatewayCapabilities';

test('MKGW3 V2 capabilities require model, parseable version and traceable evidence', () => {
  assert.equal(hasVerifiedMkgw3V2({ product_model: 'MKGW3', firmware_version: 'V2.4', firmware_evidence: 'inspection:ticket-12345678' }), true);
  for (const record of [
    {},
    { product_model: 'MKGW3', firmware_version: 'V2.4' },
    { product_model: 'MKGW3', firmware_version: 'V1.9', firmware_evidence: 'inspection:ticket-12345678' },
    { product_model: 'MKGW4', firmware_version: 'V2.4', firmware_evidence: 'inspection:ticket-12345678' },
    { product_model: 'MKGW3', firmware_version: 'unverified', firmware_evidence: 'inspection:ticket-12345678' }
  ]) assert.equal(hasVerifiedMkgw3V2(record), false);
  assert.equal(requiresMkgw3V2('report-interval', 0), true);
  assert.equal(requiresMkgw3V2('scan-mode', 1), true);
  assert.equal(requiresMkgw3V2('filter-relation', 8), true);
  assert.equal(requiresMkgw3V2('phy', 4), true);
  assert.equal(requiresMkgw3V2('scan', 1), false);
  assert.equal(requiresMkgw3V2('filter-relation', 7), false);
});

test('firmware records accept only an audited reference, not arbitrary free text or secrets', () => {
  assert.deepEqual(parseGatewayFirmwareRecord({
    productModel: 'mkgw3', firmwareVersion: 'v2.4', evidence: 'inspection:ticket-12345678'
  }), { productModel: 'MKGW3', firmwareVersion: 'V2.4', evidence: 'inspection:ticket-12345678' });
  assert.equal(parseGatewayFirmwareRecord({ productModel: 'MKGW3', firmwareVersion: 'V2.4', evidence: 'password=secret123' }), null);
  assert.equal(parseGatewayFirmwareRecord({ productModel: 'MKGW3', firmwareVersion: '2.4', evidence: 'inspection:ticket-12345678', extra: true }), null);
  const migration = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '007_gateway_model_firmware_connection.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS product_model/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS firmware_version/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS connection_state/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:gateways|hardware_gateway_commands)\b/i);
});
