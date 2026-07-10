import { db } from '../db/client';
import { inflightRequests } from '../db/schema';
import { eq, lt } from 'drizzle-orm';
import { plannerLog } from '../observability/plannerContext';

/**
 * Two-tier single-flight registry.
 *
 * Tier 1 (in-memory Map): dedupes concurrent calls WITHIN the same Node
 * process. This is the fast path — no DB round-trip.
 *
 * Tier 2 (DB row): dedupes concurrent calls ACROSS processes. Insert with
 * ON CONFLICT DO NOTHING; if we lost the race, another worker is already
 * generating, so we poll for the cache to populate. Row auto-expires so a
 * crashed worker can't wedge the key forever.
 */

const inMemory = new Map<string, Promise<any>>();

const DB_TTL_MS = 30_000;             // how long the DB guard holds
const POLL_INTERVAL_MS = 250;
const MAX_POLL_ATTEMPTS = 40;         // 40 × 250ms = 10s ceiling

export interface RunCoalescedInput<T> {
  key: string;
  operation: string;
  subjectId?: string;
  fn: () => Promise<T>;
  /**
   * Called when we detect another process holds the guard. Return the cached
   * result if it appeared, or null if you still want to keep polling. If
   * this returns non-null we short-circuit and use it.
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
    const dbAcquired = await tryAcquireDbGuard(input.key, input.operation, input.subjectId);
    if (!dbAcquired && input.onCrossProcessCoalesce) {
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
      // Fell through — the other worker is probably dead. Try to acquire
      // anyway and run the fn ourselves.
      await releaseDbGuard(input.key);
    }
    try {
      return await input.fn();
    } finally {
      await releaseDbGuard(input.key);
    }
  })();

  inMemory.set(input.key, promise);
  try {
    return await promise;
  } finally {
    inMemory.delete(input.key);
  }
}

async function tryAcquireDbGuard(key: string, operation: string, subjectId?: string): Promise<boolean> {
  const expiresAtUnix = Math.floor((Date.now() + DB_TTL_MS) / 1000);
  try {
    await db.insert(inflightRequests).values({
      key,
      operation,
      subjectId: subjectId ?? null,
      expiresAtUnix,
    });
    return true;
  } catch {
    // PK collision — either a live worker holds it or a stale row is sitting
    // there. Check if the row is expired and, if so, take it over.
    const row = await db.select().from(inflightRequests).where(eq(inflightRequests.key, key)).then((rows: any[]) => rows[0]);
    if (!row) return true; // race — assume acquired
    if (row.expiresAtUnix < Math.floor(Date.now() / 1000)) {
      await db.delete(inflightRequests).where(eq(inflightRequests.key, key)).catch(() => {});
      return tryAcquireDbGuard(key, operation, subjectId);
    }
    return false;
  }
}

async function releaseDbGuard(key: string): Promise<void> {
  try {
    await db.delete(inflightRequests).where(eq(inflightRequests.key, key));
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sweep expired guards. Cronable.
 */
export async function sweepExpiredInflightGuards(): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const result = await db.delete(inflightRequests).where(lt(inflightRequests.expiresAtUnix, nowSec));
    return (result as any)?.changes ?? 0;
  } catch {
    return 0;
  }
}
