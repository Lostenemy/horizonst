import { ProcessedDeviceRecord, DecodedDeviceRecord } from '../../types';
import { decodeMk1 } from './mk1Decoder';

interface Mk2DecodedEnvelope {
  gatewayMac?: string;
  records?: Array<Record<string, unknown>>;
}

const normaliseBattery = (record: Record<string, unknown>): number | undefined => {
  const batt = record['BattVoltage'] ?? record['BaTtVol'];
  if (typeof batt === 'number') {
    return Math.round(batt * (batt > 10 ? 1 : 1000));
  }
  if (typeof batt === 'string') {
    const numeric = parseFloat(batt);
    if (!isNaN(numeric)) {
      return Math.round(numeric * (numeric > 10 ? 1 : 1000));
    }
  }
  return undefined;
};

const parsePayload = (payload: string): Mk2DecodedEnvelope => {
  try {
    return JSON.parse(payload) as Mk2DecodedEnvelope;
  } catch (jsonError) {
    try {
      const base64 = Buffer.from(payload, 'base64').toString('utf8');
      return JSON.parse(base64) as Mk2DecodedEnvelope;
    } catch (base64Error) {
      const hex = payload.replace(/[^0-9a-fA-F]/g, '');
      if (hex.length % 2 === 0) {
        try {
          const text = Buffer.from(hex, 'hex').toString('utf8');
          return JSON.parse(text) as Mk2DecodedEnvelope;
        } catch (hexError) {
          throw hexError;
        }
      }
      throw base64Error;
    }
  }
};

export const decodeMk2 = (payload: string): ProcessedDeviceRecord[] => {
  const decoded = parsePayload(payload);
  if (decoded.records && Array.isArray(decoded.records) && decoded.gatewayMac) {
    const gatewayMac = String(decoded.gatewayMac).toUpperCase();
    return decoded.records
      .map((rec) => convertMk2Record(rec, gatewayMac))
      .filter((rec): rec is ProcessedDeviceRecord => Boolean(rec));
  }

  try {
    return decodeMk1(payload).map((rec) => ({ ...rec, topic: 'devices/MK2' }));
  } catch (error) {
    return [];
  }
};

const convertMk2Record = (
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
    rawData: typeof record['RawData'] === 'string' ? (record['RawData'] as string) : undefined,
    format: typeof record['Format'] === 'string' ? (record['Format'] as string) : undefined,
    additionalData: { ...record }
  };

  const batteryVoltageMv = normaliseBattery(record);
  if (batteryVoltageMv !== undefined) {
    base.batteryVoltageMv = batteryVoltageMv;
  }

  return { ...base, gatewayMac, topic: 'devices/MK2' };
};
