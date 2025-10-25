import { DecodedDeviceRecord, ProcessedDeviceRecord } from '../../types';

interface Mk3Envelope {
  gateway: string;
  devices: Array<Record<string, unknown>>;
}

export const decodeMk3 = (payload: string): ProcessedDeviceRecord[] => {
  const envelope = parseEnvelope(payload);
  if (!envelope) {
    return [];
  }

  return envelope.devices
    .map((device) => convertDevice(device, envelope.gateway))
    .filter((record): record is ProcessedDeviceRecord => Boolean(record));
};

const parseEnvelope = (payload: string): Mk3Envelope | null => {
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed)) {
      const gateway = parsed.find((item) => typeof item === 'object' && item !== null && 'GatewayMAC' in item);
      if (gateway && typeof gateway.GatewayMAC === 'string') {
        return {
          gateway: gateway.GatewayMAC.toUpperCase(),
          devices: parsed.filter(
            (item) => typeof item === 'object' && item !== null && 'BLEMAC' in item
          )
        } as Mk3Envelope;
      }
    }
    if (parsed && typeof parsed === 'object' && 'gateway' in parsed && 'devices' in parsed) {
      const gateway = String(parsed.gateway).toUpperCase();
      const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
      return { gateway, devices } as Mk3Envelope;
    }
    return null;
  } catch (error) {
    const parts = payload.split('\n').map((line) => line.trim()).filter(Boolean);
    if (parts.length > 1) {
      const [gatewayLine, ...deviceLines] = parts;
      const gateway = gatewayLine.split(',')[0]?.toUpperCase();
      const devices = deviceLines.map((line) => {
        const [mac, rssi, battery] = line.split(',');
        return { BLEMAC: mac, RSSI: rssi ? Number(rssi) : undefined, BattVoltage: battery };
      });
      if (gateway) {
        return { gateway, devices };
      }
    }
    return null;
  }
};

const convertDevice = (
  device: Record<string, unknown>,
  gateway: string
): ProcessedDeviceRecord | undefined => {
  const bleMac = device['BLEMAC'] ?? device['mac'];
  const rssi = device['RSSI'] ?? device['rssi'];
  if (!bleMac || typeof bleMac !== 'string' || typeof rssi !== 'number') {
    return undefined;
  }

  const base: DecodedDeviceRecord = {
    bleMac: bleMac.toUpperCase(),
    rssi,
    advType: typeof device['AdvType'] === 'string' ? (device['AdvType'] as string) : undefined,
    rawData: typeof device['RawData'] === 'string' ? (device['RawData'] as string) : undefined,
    format: typeof device['Format'] === 'string' ? (device['Format'] as string) : undefined,
    additionalData: { ...device }
  };

  const batt = device['BattVoltage'] ?? device['BaTtVol'];
  if (typeof batt === 'number') {
    base.batteryVoltageMv = Math.round(batt * (batt > 10 ? 1 : 1000));
  } else if (typeof batt === 'string') {
    const numeric = parseFloat(batt);
    if (!isNaN(numeric)) {
      base.batteryVoltageMv = Math.round(numeric * (numeric > 10 ? 1 : 1000));
    }
  }

  return { ...base, gatewayMac: gateway, topic: 'devices/MK3' };
};
