import { config } from '../config.js';
import type { ParsedRead } from '../types.js';

const normalizeEpc = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, '').toUpperCase();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).trim().toUpperCase();
  }

  return null;
};

const normalizeReaderMac = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  const plain = raw.replace(/[^a-f0-9]/g, '');
  if (plain.length === 12) {
    return plain.match(/.{1,2}/g)?.join(':') ?? raw;
  }

  return raw;
};

const mapReaderAlias = (value: string): string => config.mqtt.readerAliases[value] || value;

const normalizeAntenna = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizeRssi = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseTimestamp = (value: unknown): Date | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number.parseInt(value, 10);
    if (!Number.isNaN(asNumber) && /^\d{10,13}$/.test(value.trim())) {
      const millis = value.trim().length >= 13 ? asNumber : asNumber * 1000;
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
};

const parseSimplePayload = (parsed: Record<string, unknown>): ParsedRead[] => {
  const epc = normalizeEpc(parsed.cardId ?? parsed.card_uid ?? parsed.epc ?? parsed.uid);
  if (!epc) return [];

  return [
    {
      epc,
      readerMac: mapReaderAlias(normalizeReaderMac(parsed.readerMac ?? parsed.devmac ?? parsed.mac) || 'unknown_reader'),
      antenna: normalizeAntenna(parsed.antenna ?? parsed.antennaId ?? parsed.antena),
      rssi: normalizeRssi(parsed.rssi ?? parsed.RSSI),
      eventTs: parseTimestamp(parsed.timestamp ?? parsed.ts ?? parsed.time) || new Date(),
      rawPayload: parsed
    }
  ];
};

const parseReaderPayload = (parsed: Record<string, unknown>): ParsedRead[] => {
  const reads = parsed.reads;
  if (!Array.isArray(reads)) {
    return [];
  }

  const readerMac = mapReaderAlias(normalizeReaderMac(parsed.devmac ?? parsed.readerMac ?? parsed.mac) || 'unknown_reader');

  return reads
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const readObj = entry as Record<string, unknown>;
      const epc = normalizeEpc(readObj.EPC ?? readObj.epc ?? readObj.cardId ?? readObj.uid);
      if (!epc) return null;

      const timestamp =
        parseTimestamp(readObj['UTC time']) ||
        parseTimestamp(readObj['Time stamp of the read with the local TimeZone offset']) ||
        parseTimestamp(readObj.timestamp) ||
        new Date();

      return {
        epc,
        readerMac,
        antenna: normalizeAntenna(readObj.Antenna ?? readObj.antenna),
        rssi: normalizeRssi(readObj.RSSI ?? readObj.rssi),
        eventTs: timestamp,
        rawPayload: parsed
      } as ParsedRead;
    })
    .filter((entry): entry is ParsedRead => entry !== null);
};

export const parseRfidMessage = (payload: Buffer): ParsedRead[] => {
  const raw = payload.toString('utf8').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return [];

    const fromReaderPayload = parseReaderPayload(parsed);
    if (fromReaderPayload.length > 0) {
      return fromReaderPayload;
    }

    const fromSimple = parseSimplePayload(parsed);
    if (fromSimple.length > 0) {
      return fromSimple;
    }
  } catch {
    const epc = normalizeEpc(raw);
    if (!epc) return [];
    return [
      {
        epc,
        readerMac: mapReaderAlias('unknown_reader'),
        antenna: null,
        eventTs: new Date(),
        rawPayload: { raw }
      }
    ];
  }

  return [];
};
