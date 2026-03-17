import { config } from '../config.js';
import { insertReadEvent } from '../db/repositories/eventsRepo.js';
import { findRegisteredTag } from '../db/repositories/registeredTagsRepo.js';
import {
  closeCycleAndResetState,
  getLatestEventTs,
  getSummary,
  getStateByEpc,
  upsertState
} from '../db/repositories/stateRepo.js';
import type { InventoryDeltaPayload, ParsedRead, ReadingEventPayload, SummaryPayload } from '../types.js';
import { mapReadEventPayload } from './dashboardStateService.js';
import { decideReadAction } from './rfidRulesEngine.js';

export interface ProcessedResult {
  reading: ReadingEventPayload;
  summary: SummaryPayload;
  inventoryDelta: InventoryDeltaPayload | null;
  cycleClosed: boolean;
}

export class ToggleService {
  async closeCycleIfInactive(readTs: Date): Promise<boolean> {
    const latestEventTs = await getLatestEventTs();
    if (!latestEventTs) return false;

    const inactivityMs = readTs.getTime() - latestEventTs.getTime();
    if (inactivityMs < config.business.cycleResetAfterMs) {
      return false;
    }

    return closeCycleAndResetState(readTs, inactivityMs);
  }

  async processRead(read: ParsedRead): Promise<ProcessedResult> {
    const cycleClosed = await this.closeCycleIfInactive(read.eventTs);
    const registeredTag = await findRegisteredTag(read.epc);
    const isRegistered = Boolean(registeredTag);

    const previous = await getStateByEpc(read.epc);
    const decision = decideReadAction(
      read,
      previous
        ? {
            epc: previous.epc,
            firstSeenAt: previous.first_seen_at,
            lastSeenAt: previous.last_seen_at,
            lastEventTs: previous.last_event_ts,
            status: previous.last_direction
          }
        : null
    );

    if (decision.action === 'IGNORE') {
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
        reading: mapReadEventPayload(event, previous?.is_active ?? null),
        summary,
        inventoryDelta: null,
        cycleClosed
      };
    }

    const nextDirection: 'IN' | 'OUT' = decision.action === 'ENTRY' ? 'IN' : 'OUT';
    const state = await upsertState({
      epc: read.epc,
      isActive: nextDirection === 'IN',
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
      cycleClosed,
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
