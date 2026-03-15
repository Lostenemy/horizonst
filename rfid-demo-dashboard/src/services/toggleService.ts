import { config } from '../config.js';
import { insertReadEvent } from '../db/repositories/eventsRepo.js';
import { findRegisteredTag } from '../db/repositories/registeredTagsRepo.js';
import { getSummary, getStateByEpc, upsertState } from '../db/repositories/stateRepo.js';
import type { InventoryDeltaPayload, ParsedRead, ReadingEventPayload, SummaryPayload } from '../types.js';
import { DebounceService } from './debounceService.js';
import { mapReadEventPayload } from './dashboardStateService.js';

export interface ProcessedResult {
  reading: ReadingEventPayload;
  summary: SummaryPayload;
  inventoryDelta: InventoryDeltaPayload | null;
}

export class ToggleService {
  private readonly debounce = new DebounceService(config.business.debounceMs);

  async processRead(read: ParsedRead): Promise<ProcessedResult> {
    const registeredTag = await findRegisteredTag(read.epc);
    const isRegistered = Boolean(registeredTag);

    const ignoredByDebounce = this.debounce.shouldIgnore(read.epc, read.readerMac, read.antenna, read.eventTs);
    if (ignoredByDebounce) {
      const event = await insertReadEvent({
        epc: read.epc,
        readerMac: read.readerMac,
        antenna: read.antenna,
        direction: 'IGNORED',
        isRegistered,
        rawPayload: read.rawPayload,
        eventTs: read.eventTs,
        ignoredByDebounce: true,
        debounceWindowMs: config.business.debounceMs
      });

      const summary = await getSummary();
      return {
        reading: mapReadEventPayload(event, null),
        summary,
        inventoryDelta: null
      };
    }

    const previous = await getStateByEpc(read.epc);
    const nextDirection: 'IN' | 'OUT' = !previous || !previous.is_active ? 'IN' : 'OUT';
    const nextActive = nextDirection === 'IN';

    const state = await upsertState({
      epc: read.epc,
      isActive: nextActive,
      isRegistered,
      readerMac: read.readerMac,
      antenna: read.antenna,
      direction: nextDirection,
      eventTs: read.eventTs
    });

    const event = await insertReadEvent({
      epc: read.epc,
      readerMac: read.readerMac,
      antenna: read.antenna,
      direction: nextDirection,
      isRegistered,
      rawPayload: read.rawPayload,
      eventTs: read.eventTs,
      ignoredByDebounce: false,
      debounceWindowMs: config.business.debounceMs
    });

    const summary = await getSummary();

    return {
      reading: mapReadEventPayload(event, state.is_active),
      summary,
      inventoryDelta: {
        epc: state.epc,
        isActive: state.is_active,
        isRegistered: state.is_registered,
        direction: state.last_direction,
        readerMac: state.last_reader_mac,
        antenna: state.last_antenna,
        firstSeenAt: state.first_seen_at.toISOString(),
        lastSeenAt: state.last_seen_at.toISOString(),
        lastEventTs: state.last_event_ts.toISOString()
      }
    };
  }
}
