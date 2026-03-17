import { config } from '../config.js';
import { listRecentEvents } from '../db/repositories/eventsRepo.js';
import { listRegisteredTags } from '../db/repositories/registeredTagsRepo.js';
import { getSummary, listActiveInventory, listCycleHistory, listUnregistered } from '../db/repositories/stateRepo.js';
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
  ignoredReason: row.ignored_by_debounce ? 'DEBOUNCE' : null,
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
  const [summary, activeInventory, lastReadings, unregistered, registeredTags, cycleHistory] = await Promise.all([
    getSummary(),
    listActiveInventory(config.business.activeLimit),
    listRecentEvents(config.business.recentEventsLimit),
    listUnregistered(config.business.activeLimit),
    listRegisteredTags(config.business.activeLimit),
    listCycleHistory(20)
  ]);

  return {
    summary,
    activeInventory: activeInventory.map(mapActive),
    lastReadings: lastReadings.map((event) => mapEvent(event)),
    unregistered: unregistered.map(mapUnregistered),
    registeredTags,
    cycleHistory: cycleHistory.map((item) => ({
      id: item.id,
      cycleStartedAt: item.cycle_started_at.toISOString(),
      cycleClosedAt: item.cycle_closed_at.toISOString(),
      inactivityMs: item.inactivity_ms,
      activeTagsCount: item.active_tags_count,
      eventCount: item.event_count,
      snapshot: item.snapshot,
      createdAt: item.created_at.toISOString()
    }))
  };
};

export const mapReadEventPayload = mapEvent;
