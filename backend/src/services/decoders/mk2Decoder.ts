import { ProcessedDeviceRecord, DecodedDeviceRecord } from '../../types';
import { decodeMk1 } from './mk1Decoder';

interface Mk2DecodedEnvelope {
  gatewayMac?: string;
  records?: Array<Record<string, unknown>>;
}

interface LegacyMk2Payload {
  flag?: string;
  gatewayMac?: string;
  deviceArray?: LegacyScanDevice[];
  records?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

type LegacyScanDevice = Record<string, unknown>;

const { handlePayload }: {
  handlePayload: (value: string, msgType?: unknown, index?: unknown) => LegacyMk2Payload | null;
} = require('../../mkgw4Decoder');

const SCAN_FLAGS = new Set(['30a0', '30b2']);

export const decodeMk2 = (payload: string): ProcessedDeviceRecord[] => {
  const jsonEnvelope = tryDecodeMk2Json(payload);
  if (jsonEnvelope?.gatewayMac && Array.isArray(jsonEnvelope.records)) {
    const gatewayMac = String(jsonEnvelope.gatewayMac).toUpperCase();
    return jsonEnvelope.records
      .map((rec) => convertMk2JsonRecord(rec, gatewayMac))
      .filter((rec): rec is ProcessedDeviceRecord => Boolean(rec));
  }

  const legacyPayload = tryDecodeLegacyPayload(payload);
  if (legacyPayload?.flag === 'mk2-json' && legacyPayload.gatewayMac && Array.isArray(legacyPayload.records)) {
    const gatewayMac = String(legacyPayload.gatewayMac).toUpperCase();
    return legacyPayload.records
      .map((rec) => convertMk2JsonRecord(rec, gatewayMac))
      .filter((rec): rec is ProcessedDeviceRecord => Boolean(rec));
  }

  const flag = typeof legacyPayload?.flag === 'string' ? legacyPayload.flag.toLowerCase() : undefined;
  if (
    legacyPayload?.gatewayMac &&
    typeof legacyPayload.gatewayMac === 'string' &&
    flag &&
    SCAN_FLAGS.has(flag) &&
    Array.isArray(legacyPayload.deviceArray)
  ) {
    const gatewayMac = legacyPayload.gatewayMac.toUpperCase();
    return legacyPayload.deviceArray
      .map((device) => convertLegacyScanDevice(device, gatewayMac))
      .filter((rec): rec is ProcessedDeviceRecord => Boolean(rec));
  }

  try {
    return decodeMk1(payload).map((rec) => ({ ...rec, topic: 'devices/MK2' }));
  } catch (error) {
    return [];
  }
};

const tryDecodeMk2Json = (payload: string): Mk2DecodedEnvelope | null => {
  try {
    return JSON.parse(payload) as Mk2DecodedEnvelope;
  } catch (jsonError) {
    try {
      const base64 = Buffer.from(payload, 'base64').toString('utf8');
      return JSON.parse(base64) as Mk2DecodedEnvelope;
    } catch (base64Error) {
      const hex = payload.replace(/[^0-9a-fA-F]/g, '');
      if (hex.length % 2 === 0 && hex.length !== 0) {
        try {
          const text = Buffer.from(hex, 'hex').toString('utf8');
          return JSON.parse(text) as Mk2DecodedEnvelope;
        } catch {
          return null;
        }
      }
      return null;
    }
  }
};

const tryDecodeLegacyPayload = (payload: string): LegacyMk2Payload | null => {
  try {
    return handlePayload(payload, undefined, undefined);
  } catch {
    return null;
  }
};

const convertMk2JsonRecord = (
  record: Record<string, unknown>,
  gatewayMac: string
): ProcessedDeviceRecord | undefined => {
  const bleMac = record['BLEMAC'] ?? record['mac'] ?? record['tag'];
  const rssi = record['RSSI'] ?? record['rssi'];
  if (!bleMac || typeof bleMac !== 'string' || typeof rssi !== 'number') {
    return undefined;
  }

  const base: DecodedDeviceRecord = {
    bleMac: bleMac.toUpperCase(),
    rssi,
    advType: typeof record['AdvType'] === 'string' ? (record['AdvType'] as string) : undefined,
    rawData: typeof record['RawData'] === 'string' ? formatHexPayload(record['RawData'] as string) : undefined,
    format: typeof record['Format'] === 'string' ? (record['Format'] as string) : undefined,
    additionalData: { ...record }
  };

  if (base.additionalData) {
    delete base.additionalData['BLEMAC'];
    delete base.additionalData['mac'];
    delete base.additionalData['tag'];
    delete base.additionalData['RSSI'];
    delete base.additionalData['rssi'];
    delete base.additionalData['RawData'];
    delete base.additionalData['AdvType'];
    delete base.additionalData['Format'];
  }

  const batteryVoltageMv = normaliseBatteryValue(
    record['BattVoltage'] ?? record['BaTtVol'] ?? record['batteryVoltage'] ?? record['battery']
  );
  if (batteryVoltageMv !== undefined) {
    base.batteryVoltageMv = batteryVoltageMv;
  }

  const temperature = parseNumericValue(record['temperature'] ?? record['temperatureC']);
  if (temperature !== undefined) {
    base.temperatureC = temperature;
  }

  const humidity = parseNumericValue(record['humidity']);
  if (humidity !== undefined) {
    base.humidity = humidity;
  }

  const movement = parseMovementCount(record['movementCount']);
  if (movement !== undefined) {
    base.movementCount = movement;
  }

  return { ...base, gatewayMac, topic: 'devices/MK2' };
};

const convertLegacyScanDevice = (
  device: LegacyScanDevice,
  gatewayMac: string
): ProcessedDeviceRecord | undefined => {
  if (!device || typeof device !== 'object') {
    return undefined;
  }

  const additionalData: Record<string, unknown> = { ...device };

  const macValue = additionalData['mac'];
  if (typeof macValue !== 'string' || macValue.trim().length === 0) {
    return undefined;
  }
  delete additionalData['mac'];

  const rssiValue = additionalData['rssi'];
  if (typeof rssiValue !== 'number' || Number.isNaN(rssiValue)) {
    return undefined;
  }
  delete additionalData['rssi'];

  const record: DecodedDeviceRecord = {
    bleMac: macValue.toUpperCase(),
    rssi: rssiValue
  };

  if (typeof additionalData['type'] === 'string') {
    record.advType = additionalData['type'] as string;
    delete additionalData['type'];
  }

  if (typeof additionalData['advPacket'] === 'string') {
    const formatted = formatHexPayload(additionalData['advPacket'] as string);
    if (formatted) {
      record.rawData = formatted;
    }
    delete additionalData['advPacket'];
  }

  if (typeof additionalData['responsePacket'] === 'string') {
    const formatted = formatHexPayload(additionalData['responsePacket'] as string);
    if (formatted) {
      additionalData['responsePacket'] = formatted;
    } else {
      delete additionalData['responsePacket'];
    }
  }

  const batteryVoltageMv = normaliseBatteryValue(
    additionalData['battVoltage'] ?? additionalData['batteryVoltage'] ?? additionalData['battery']
  );
  if (batteryVoltageMv !== undefined) {
    record.batteryVoltageMv = batteryVoltageMv;
    delete additionalData['battVoltage'];
    delete additionalData['batteryVoltage'];
    delete additionalData['battery'];
  }

  const temperature = parseNumericValue(additionalData['temperature'] ?? additionalData['temperatureC']);
  if (temperature !== undefined) {
    record.temperatureC = temperature;
    delete additionalData['temperature'];
    delete additionalData['temperatureC'];
  }

  const humidity = parseNumericValue(additionalData['humidity']);
  if (humidity !== undefined) {
    record.humidity = humidity;
    delete additionalData['humidity'];
  }

  const movement = parseMovementCount(
    additionalData['movementCount'] ??
      additionalData['motionTriggerEventCount'] ??
      additionalData['movementTriggerEventCount'] ??
      additionalData['triggerCount']
  );
  if (movement !== undefined) {
    record.movementCount = movement;
    delete additionalData['movementCount'];
    delete additionalData['motionTriggerEventCount'];
    delete additionalData['movementTriggerEventCount'];
    delete additionalData['triggerCount'];
  }

  const additionalKeys = Object.keys(additionalData);
  if (additionalKeys.length > 0) {
    record.additionalData = additionalData;
  }

  return { ...record, gatewayMac, topic: 'devices/MK2' };
};

const formatHexPayload = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  const upper = normalized.toUpperCase();
  if (!upper || !/^[0-9A-F]+$/.test(upper)) {
    return undefined;
  }
  return `0x${upper}`;
};

const parseNumericValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = parseFloat(match[0]);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
};

const parseMovementCount = (value: unknown): number | undefined => {
  const numeric = parseNumericValue(value);
  if (numeric === undefined) {
    return undefined;
  }
  const rounded = Math.round(numeric);
  return Number.isNaN(rounded) ? undefined : rounded;
};

const normaliseBatteryValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value > 25 ? Math.round(value) : Math.round(value * 1000);
  }
  if (typeof value === 'string') {
    const numeric = parseNumericValue(value);
    if (numeric === undefined) {
      return undefined;
    }
    const lowered = value.trim().toLowerCase();
    if (lowered.includes('mv') || numeric > 25) {
      return Math.round(numeric);
    }
    return Math.round(numeric * 1000);
  }
  return undefined;
};
