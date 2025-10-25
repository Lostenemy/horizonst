import { DecodedDeviceRecord, ProcessedDeviceRecord } from '../../types';
import { hexToBuffer, parseTemperatureFromEddystone, parseUInt16 } from './utils';

interface Mk1MessageEntry {
  TimeStamp: string;
  Format: string;
  GatewayMAC?: string;
  BLEMAC?: string;
  RSSI?: number;
  AdvType?: string;
  RawData?: string;
  BLEName?: string;
}

export const decodeMk1 = (payload: string): ProcessedDeviceRecord[] => {
  const parsed = JSON.parse(payload) as Mk1MessageEntry[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [];
  }

  const gatewayEntry = parsed.find((entry) => entry.Format === 'Gateway');
  if (!gatewayEntry || !gatewayEntry.GatewayMAC) {
    return [];
  }

  const gatewayMac = gatewayEntry.GatewayMAC.toUpperCase();
  const records: ProcessedDeviceRecord[] = [];

  for (const entry of parsed) {
    if (entry.Format !== 'RawData' || !entry.BLEMAC || typeof entry.RSSI !== 'number') {
      continue;
    }
    const record: DecodedDeviceRecord = {
      bleMac: entry.BLEMAC.toUpperCase(),
      rssi: entry.RSSI,
      advType: entry.AdvType,
      rawData: entry.RawData,
      format: entry.Format,
      additionalData: { sourceTimestamp: entry.TimeStamp, bleName: entry.BLEName }
    };

    if (entry.RawData) {
      const raw = entry.RawData.replace(/^0x/i, '');
      try {
        const buffer = hexToBuffer(raw);
        let partial: Partial<DecodedDeviceRecord> = {};
        if (raw.includes('AAFE20')) {
          partial = decodeEddystoneTlm(buffer);
        } else if (raw.includes('E2C5') || raw.includes('E2C56DB5DFFB48D2B060D0F5A71096E0')) {
          partial = decodeDxSmart(buffer);
        }

        if (partial.additionalData) {
          record.additionalData = {
            ...(record.additionalData || {}),
            ...partial.additionalData
          };
        }

        const { additionalData, ...rest } = partial;
        Object.assign(record, rest);
      } catch (error) {
        record.additionalData = {
          ...record.additionalData,
          decodeError: (error as Error).message
        };
      }
    }

    records.push({ ...record, gatewayMac, topic: 'devices/MK1' });
  }

  return records;
};

const decodeEddystoneTlm = (buffer: Buffer): Partial<DecodedDeviceRecord> => {
  const index = buffer.indexOf(Buffer.from('AAFE20', 'hex'));
  if (index === -1) {
    return {};
  }
  const start = index + 3;
  const tlmFrame = buffer.subarray(start);
  if (tlmFrame.length < 14) {
    return {};
  }
  const version = tlmFrame.readUInt8(0);
  const batteryVoltageMv = parseUInt16(tlmFrame, 1);
  const temperatureC = parseTemperatureFromEddystone(tlmFrame, 3);
  const advCount = tlmFrame.readUInt32BE(5);
  const uptimeSeconds = tlmFrame.readUInt32BE(9);

  return {
    batteryVoltageMv,
    temperatureC,
    additionalData: {
      ...('additionalData' in tlmFrame ? {} : {}),
      tlmVersion: version,
      advCount,
      uptimeSeconds
    }
  };
};

const decodeDxSmart = (buffer: Buffer): Partial<DecodedDeviceRecord> => {
  const manufacturerIndex = buffer.indexOf(Buffer.from('E2C5', 'hex'));
  if (manufacturerIndex === -1) {
    return {};
  }
  const slice = buffer.subarray(manufacturerIndex - 2);
  const data: Record<string, unknown> = {};
  if (slice.length >= 16) {
    const batteryVoltageMv = slice.readUInt16BE(4);
    data['movementCounter'] = slice.readUInt16BE(6);
    data['intervalCounter'] = slice.readUInt32BE(8);
    return {
      batteryVoltageMv,
      additionalData: data
    };
  }
  return { additionalData: data };
};
