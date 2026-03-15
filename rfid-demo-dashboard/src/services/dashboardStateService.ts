import { config } from '../config.js';
import { listRecentEvents } from '../db/repositories/eventsRepo.js';
import { getSummary, listActiveInventory, listUnregistered } from '../db/repositories/stateRepo.js';
import type { DashboardInitialPayload, InventoryStateRow, ReadEventRow, ReadingEventPayload } from '../types.js';

const mapEvent = (row: ReadEventRow, isActiveNow: boolean | null = null): ReadingEventPayload => ({
  id: row.id,
  epc: row.epc,
  readerMac: row.reader_mac,
  antenna: row.antenna,
  direction: row.direction,
  isRegistered: row.is_registered,
  isActiveNow,
  ignoredByDebounce: row.ignored_by_debounce,
  eventTs: row.event_ts.toISOString(),
  processedAt: row.processed_at.toISOString()
});

const mapActive = (row: InventoryStateRow) => ({
  epc: row.epc,
  isRegistered: row.is_registered,
  lastReaderMac: row.last_reader_mac,
  lastAntenna: row.last_antenna,
  lastDirection: row.last_direction,
  firstSeenAt: row.first_seen_at.toISOString(),
  lastSeenAt: row.last_seen_at.toISOString(),
  lastEventTs: row.last_event_ts.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapUnregistered = (row: InventoryStateRow) => ({
  epc: row.epc,
  isActive: row.is_active,
  lastReaderMac: row.last_reader_mac,
  lastAntenna: row.last_antenna,
  lastDirection: row.last_direction,
  lastSeenAt: row.last_seen_at.toISOString()
});

export const buildDashboardInitial = async (): Promise<DashboardInitialPayload> => {
  const [summary, activeInventory, lastReadings, unregistered] = await Promise.all([
    getSummary(),
    listActiveInventory(config.business.activeLimit),
    listRecentEvents(config.business.recentEventsLimit),
    listUnregistered(config.business.activeLimit)
  ]);

  return {
    summary,
    activeInventory: activeInventory.map(mapActive),
    lastReadings: lastReadings.map((event) => mapEvent(event)),
    unregistered: unregistered.map(mapUnregistered)
  };
};

export const mapReadEventPayload = mapEvent;
