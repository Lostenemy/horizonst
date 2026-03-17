import type { ParsedRead } from '../types.js';

const IGNORE_WINDOW_MS = 20_000;

export type RuleDecision =
  | { action: 'ENTRY' }
  | { action: 'EXIT' }
  | { action: 'IGNORE'; reason: 'DEBOUNCE' };

export interface TagCycleState {
  epc: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastEventTs: Date;
  status: 'IN' | 'OUT';
}

export const decideReadAction = (read: ParsedRead, previous: TagCycleState | null): RuleDecision => {
  if (!previous) {
    return { action: 'ENTRY' };
  }

  const diffMs = read.eventTs.getTime() - previous.lastEventTs.getTime();
  if (diffMs <= IGNORE_WINDOW_MS) {
    return { action: 'IGNORE', reason: 'DEBOUNCE' };
  }

  if (previous.status === 'IN') {
    return { action: 'EXIT' };
  }

  return { action: 'ENTRY' };
};
