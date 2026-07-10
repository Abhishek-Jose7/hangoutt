import { AsyncLocalStorage } from 'async_hooks';

/**
 * The planner version — bumped whenever any change to the planner logic
 * would produce a different output for the same input. Cache entries stamped
 * with an older version are considered stale and ignored on read.
 *
 * When you change any of these, bump the version:
 *  - archetype list / mustInclude
 *  - constraint stack / RELAXATION_ORDER
 *  - scoring weights
 *  - candidate-generation shape
 *  - transit / cost model
 *  - venue-filtering rules (isHangoutWorthyCandidate)
 */
export const PLANNER_VERSION = 'v6.1.0';

export interface PlannerRequestContext {
  userId?: string;
  groupId?: string;
  ip?: string;
  requestId: string;
  startedAtMs: number;
  /**
   * Cumulative cost in cents recorded by all instrumented calls during this
   * request. Used for both the cache row and the cost ledger.
   */
  costCentsAccumulated: number;
  /** Was this request served from the cache? */
  cacheHit: boolean;
  /** Was this request coalesced onto an in-flight generation? */
  coalesced: boolean;
}

const store = new AsyncLocalStorage<PlannerRequestContext>();

export function runWithPlannerContext<T>(ctx: PlannerRequestContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

export function currentPlannerContext(): PlannerRequestContext | undefined {
  return store.getStore();
}

/**
 * Structured logger for all planner-related infrastructure events. Emits a
 * single JSON line per event to stdout with a consistent shape so a log
 * pipeline (Datadog, Loki, CloudWatch Insights) can index it. Falls back to
 * plain console.log if JSON serialisation fails.
 */
export interface PlannerLogEvent {
  event: string;
  requestId?: string;
  userId?: string;
  groupId?: string;
  ip?: string;
  key?: string;
  operation?: string;
  provider?: string;
  costCents?: number;
  units?: number;
  durationMs?: number;
  cacheHit?: boolean;
  retryAfterSeconds?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export function plannerLog(event: PlannerLogEvent): void {
  const ctx = currentPlannerContext();
  const payload = {
    ts: new Date().toISOString(),
    plannerVersion: PLANNER_VERSION,
    requestId: event.requestId ?? ctx?.requestId,
    userId: event.userId ?? ctx?.userId,
    groupId: event.groupId ?? ctx?.groupId,
    ip: event.ip ?? ctx?.ip,
    ...event,
  };
  try {
    console.log(`[PLANNER_METRIC] ${JSON.stringify(payload)}`);
  } catch {
    console.log('[PLANNER_METRIC] serialization-failed', event.event);
  }
}
