import { plannerLog } from '../observability/plannerContext';
import { apiInflightAcquire, apiInflightRelease } from './costControlClient';

/**
 * Two-tier single-flight registry.
 *
 * Tier 1 (in-memory Map): dedupes concurrent calls WITHIN the same Node
 * process. This is the fast path — no network round-trip.
 *
 * Tier 2 (worker-backed DB row): dedupes concurrent calls ACROSS processes.
 * Row expires after ttlSec so a crashed worker doesn't wedge the key.
 */

const inMemory = new Map<string, Promise<any>>();

const DB_TTL_SEC = 30;
const POLL_INTERVAL_MS = 250;
const MAX_POLL_ATTEMPTS = 40;         // 40 × 250ms = 10s ceiling

export interface RunCoalescedInput<T> {
  key: string;
  operation: string;
  subjectId?: string;
  fn: () => Promise<T>;
  /**
   * Called when we detect another process holds the guard. Return the cached
   * result if it appeared, or null if you still want to keep polling.
   */
  onCrossProcessCoalesce?: () => Promise<T | null>;
}

export async function runCoalesced<T>(input: RunCoalescedInput<T>): Promise<T> {
  const existing = inMemory.get(input.key);
  if (existing) {
    plannerLog({
      event: 'INFLIGHT_COALESCED',
      operation: input.operation,
      key: input.key,
      metadata: { tier: 'IN_PROCESS' },
    });
    return existing as Promise<T>;
  }

  const promise = (async () => {
    const acquire = await apiInflightAcquire({
      key: input.key,
      operation: input.operation,
      subjectId: input.subjectId,
      ttlSec: DB_TTL_SEC,
    });
    if (!acquire.acquired && input.onCrossProcessCoalesce) {
      plannerLog({
        event: 'INFLIGHT_COALESCED',
        operation: input.operation,
        key: input.key,
        metadata: { tier: 'CROSS_PROCESS' },
      });
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        const result = await input.onCrossProcessCoalesce();
        if (result !== null) return result;
      }
      // Fell through — the other worker is probably dead. Retry acquire
      // (worker will free stale rows).
      await apiInflightRelease(input.key);
    }
    try {
      return await input.fn();
    } finally {
      await apiInflightRelease(input.key);
    }
  })();

  inMemory.set(input.key, promise);
  try {
    return await promise;
  } finally {
    inMemory.delete(input.key);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sweep is worker-side now. No-op for compatibility.
 */
export async function sweepExpiredInflightGuards(): Promise<number> {
  return 0;
}
