export type Role = 'ADMIN' | 'USER';

export interface JwtPayload {
  userId: number;
  role: Role;
}

export interface GatewayMessage {
  topic: string;
  gatewayMac: string;
  receivedAt: Date;
  payload: unknown;
}

export interface DecodedDeviceRecord {
  bleMac: string;
  rssi: number;
  advType?: string;
  rawData?: string;
  format?: string;
  temperatureC?: number | null;
  batteryVoltageMv?: number | null;
  humidity?: number | null;
  movementCount?: number | null;
  firmware?: string | null;
  txPower?: number | null;
  additionalData?: Record<string, unknown>;
}

export interface ProcessedDeviceRecord extends DecodedDeviceRecord {
  gatewayMac: string;
  topic: string;
}
