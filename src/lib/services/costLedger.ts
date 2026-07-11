import { currentPlannerContext, plannerLog } from '../observability/plannerContext';
import { apiCostRecord, apiRollupBump, apiUsageSummary } from './costControlClient';

/**
 * Cost ledger. Every paid external operation records a row through the
 * worker; there is no local DB fallback.
 */
export type CostProvider = 'GROQ' | 'ANTHROPIC' | 'GOOGLE_PLACES' | 'OLA' | 'INTERNAL';

export type CostOperation =
  | 'PLAN_GENERATE'
  | 'AI_GROQ'
  | 'AI_ANTHROPIC'
  | 'PLACES_TEXTSEARCH'
  | 'PLACES_DETAILS'
  | 'PLACES_NEARBY'
  | 'PLACES_PHOTO'
  | 'OLA_PLACES'
  | 'CACHE_SAVED';

/**
 * Rate cards in millicents per unit (1000 mc = 1 cent = $0.01).
 * Cross-checked with public pricing pages. Update as upstream changes.
 */
const RATE_CARD_MILLICENTS_PER_UNIT: Record<CostOperation, number> = {
  PLAN_GENERATE: 0,
  AI_GROQ: 0.007,
  AI_ANTHROPIC: 3.0,
  PLACES_TEXTSEARCH: 3200,
  PLACES_DETAILS: 1700,
  PLACES_NEARBY: 3200,
  PLACES_PHOTO: 700,
  OLA_PLACES: 500,
  CACHE_SAVED: 0,
};

export function estimateCostCents(op: CostOperation, units: number): number {
  const perUnitMc = RATE_CARD_MILLICENTS_PER_UNIT[op] ?? 0;
  const millicents = perUnitMc * Math.max(0, units);
  return Math.max(0, Math.round(millicents / 1000));
}

export interface RecordCostInput {
  operation: CostOperation;
  provider: CostProvider;
  units?: number;
  userId?: string;
  groupId?: string;
  costCents?: number;
  cacheHit?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Record one paid operation. Fire-and-forget — never throws, never blocks.
 * Errors are swallowed by the client wrapper.
 */
export function recordCost(input: RecordCostInput): void {
  try {
    const ctx = currentPlannerContext();
    const units = input.units ?? 1;
    const costCents = input.costCents ?? estimateCostCents(input.operation, units);
    const userId = input.userId ?? ctx?.userId;
    const groupId = input.groupId ?? ctx?.groupId;

    if (ctx) {
      ctx.costCentsAccumulated += costCents;
    }

    // Structured log is free and always fires.
    plannerLog({
      event: 'COST_RECORDED',
      operation: input.operation,
      provider: input.provider,
      units,
      costCents,
      cacheHit: input.cacheHit,
    });

    // Best-effort DB persistence via the worker.
    void apiCostRecord({
      userId: userId ?? null,
      groupId: groupId ?? null,
      operation: input.operation,
      provider: input.provider,
      units,
      costCents,
      cacheHit: input.cacheHit,
      metadata: input.metadata,
    });
  } catch {
    // Never let cost recording crash the caller.
  }
}

/**
 * Bump the daily rollup for a subject.
 */
export async function bumpDailyRollup(input: {
  subjectKind: 'GLOBAL' | 'USER' | 'GROUP';
  subjectId: string;
  plansGenerated?: number;
  cacheHits?: number;
  cacheMisses?: number;
  aiCalls?: number;
  externalCalls?: number;
  costCents?: number;
  timeSavedMs?: number;
}) {
  await apiRollupBump(input);
}

/**
 * Admin dashboard hooks — all delegate to the worker's aggregate endpoint.
 */
export async function getUsageSummary(days = 7): Promise<any> {
  return apiUsageSummary(days);
}
