export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type InventoryDirection = 'IN' | 'OUT' | 'IGNORED';

export interface ParsedRead {
  epc: string;
  readerMac: string;
  antenna: number | null;
  eventTs: Date;
  rawPayload: Record<string, unknown>;
}

export interface RegisteredTagInfo {
  epc: string;
  name: string | null;
  description: string | null;
  active: boolean;
  createdAt: string;
}

export interface RegisteredTagRow {
  epc: string;
  name: string | null;
  description: string | null;
  active: boolean;
  created_at: Date;
}

export interface InventoryStateRow {
  epc: string;
  is_active: boolean;
  is_registered: boolean;
  last_reader_mac: string;
  last_antenna: number | null;
  last_direction: 'IN' | 'OUT';
  first_seen_at: Date;
  last_seen_at: Date;
  last_event_ts: Date;
  updated_at: Date;
}

export interface ReadEventRow {
  id: number;
  epc: string;
  reader_mac: string;
  antenna: number | null;
  direction: InventoryDirection;
  is_registered: boolean;
  raw_payload: Record<string, unknown>;
  event_ts: Date;
  processed_at: Date;
  ignored_by_debounce: boolean;
  debounce_window_ms: number;
}

export interface ReadingEventPayload {
  id: number;
  epc: string;
  readerMac: string;
  antenna: number | null;
  direction: InventoryDirection;
  isRegistered: boolean;
  isActiveNow: boolean | null;
  ignoredByDebounce: boolean;
  eventTs: string;
  processedAt: string;
}

export interface SummaryPayload {
  activeCount: number;
  registeredActiveCount: number;
  unregisteredActiveCount: number;
  totalReadings24h: number;
}

export interface InventoryDeltaPayload {
  epc: string;
  isActive: boolean;
  isRegistered: boolean;
  direction: 'IN' | 'OUT';
  readerMac: string;
  antenna: number | null;
  lastEventTs: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DashboardInitialPayload {
  summary: SummaryPayload;
  activeInventory: Array<{
    epc: string;
    isRegistered: boolean;
    lastReaderMac: string;
    lastAntenna: number | null;
    lastDirection: 'IN' | 'OUT';
    firstSeenAt: string;
    lastSeenAt: string;
    lastEventTs: string;
    updatedAt: string;
  }>;
  lastReadings: ReadingEventPayload[];
  unregistered: Array<{
    epc: string;
    isActive: boolean;
    lastReaderMac: string;
    lastAntenna: number | null;
    lastDirection: 'IN' | 'OUT';
    lastSeenAt: string;
  }>;
  registeredTags: Array<{
    epc: string;
    name: string | null;
    description: string | null;
    active: boolean;
    createdAt: string;
  }>;
}
