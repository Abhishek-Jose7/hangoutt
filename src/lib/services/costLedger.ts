import { randomUUID } from 'crypto';
import { db } from '../db/client';
import { costLedger, usageDailyRollup } from '../db/schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { currentPlannerContext, plannerLog } from '../observability/plannerContext';

/**
 * Estimated per-unit cost for each provider. Kept as integer cents scaled up
 * to avoid floating-point drift. These are approximate — the goal is
 * observability of trends, not exact billing reconciliation. Update as
 * upstream pricing changes.
 */
export type CostProvider = 'GROQ' | 'ANTHROPIC' | 'GOOGLE_PLACES' | 'OLA' | 'INTERNAL';

export type CostOperation =
  | 'PLAN_GENERATE'          // end-to-end plan generation (wraps AI + venue calls)
  | 'AI_GROQ'                // Groq LLM invocation
  | 'AI_ANTHROPIC'           // Anthropic API
  | 'PLACES_TEXTSEARCH'      // Google Places text search
  | 'PLACES_DETAILS'         // Google Places details lookup
  | 'PLACES_NEARBY'          // Google Places nearby search
  | 'PLACES_PHOTO'           // Google Places photo fetch (once, then cached)
  | 'OLA_PLACES'             // Ola Places API
  | 'CACHE_SAVED';           // synthetic op: records estimated dollars saved on hit

/**
 * Rate cards in millicents per unit (1000 mc = 1 cent = $0.01).
 * Using millicents avoids losing single-token precision at scale.
 * Numbers cross-checked with public pricing pages as of 2026-Q1.
 */
const RATE_CARD_MILLICENTS_PER_UNIT: Record<CostOperation, number> = {
  PLAN_GENERATE: 0,          // aggregate of nested calls; not billed directly
  AI_GROQ: 0.007,            // ~$0.07 / M tokens (Llama on Groq)
  AI_ANTHROPIC: 3.0,         // ~$3 / M tokens for Claude Haiku input (conservative)
  PLACES_TEXTSEARCH: 3200,   // ~$32 / 1k requests
  PLACES_DETAILS: 1700,      // ~$17 / 1k requests
  PLACES_NEARBY: 3200,       // ~$32 / 1k requests
  PLACES_PHOTO: 700,         // ~$7 / 1k requests (cached aggressively)
  OLA_PLACES: 500,           // Ola Maps pricing (conservative estimate)
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
  costCents?: number;      // override; otherwise derived from rate card
  cacheHit?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Record one paid external operation. Fire-and-forget — never blocks the
 * caller, never throws. On DB errors it logs and drops the row rather than
 * propagating the failure into user-facing code.
 */
export function recordCost(input: RecordCostInput): void {
  const ctx = currentPlannerContext();
  const units = input.units ?? 1;
  const costCents = input.costCents ?? estimateCostCents(input.operation, units);
  const userId = input.userId ?? ctx?.userId;
  const groupId = input.groupId ?? ctx?.groupId;

  if (ctx) {
    ctx.costCentsAccumulated += costCents;
  }

  plannerLog({
    event: 'COST_RECORDED',
    operation: input.operation,
    provider: input.provider,
    units,
    costCents,
    cacheHit: input.cacheHit,
  });

  void db.insert(costLedger).values({
    id: randomUUID(),
    userId: userId ?? null,
    groupId: groupId ?? null,
    operation: input.operation,
    provider: input.provider,
    units,
    costCents,
    cacheHit: input.cacheHit ? 1 : 0,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  }).catch((err: any) => console.warn('[costLedger] insert failed:', err?.message ?? err));
}

// ---------------------------------------------------------------------------
// Aggregate queries — powering the admin dashboard.
// ---------------------------------------------------------------------------

export interface UsageWindow {
  from: string; // ISO
  to: string;   // ISO
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartUtc(): string {
  return new Date().toISOString().slice(0, 7) + '-01';
}

export async function getGlobalUsage(window: UsageWindow) {
  const rows = await db
    .select({
      operation: costLedger.operation,
      provider: costLedger.provider,
      units: sql<number>`sum(${costLedger.units})`,
      costCents: sql<number>`sum(${costLedger.costCents})`,
      calls: sql<number>`count(*)`,
      cacheHits: sql<number>`sum(${costLedger.cacheHit})`,
    })
    .from(costLedger)
    .where(and(gte(costLedger.at, window.from), lte(costLedger.at, window.to)))
    .groupBy(costLedger.operation, costLedger.provider);
  return rows;
}

export async function getTopCostSubjects(
  kind: 'USER' | 'GROUP',
  window: UsageWindow,
  limit = 10
) {
  const idColumn = kind === 'USER' ? costLedger.userId : costLedger.groupId;
  const rows = await db
    .select({
      subjectId: idColumn,
      costCents: sql<number>`sum(${costLedger.costCents})`,
      calls: sql<number>`count(*)`,
    })
    .from(costLedger)
    .where(and(
      gte(costLedger.at, window.from),
      lte(costLedger.at, window.to),
      sql`${idColumn} IS NOT NULL`,
    ))
    .groupBy(idColumn)
    .orderBy(sql`sum(${costLedger.costCents}) desc`)
    .limit(limit);
  return rows;
}

export async function todaySpendCents(): Promise<number> {
  const today = todayUtc();
  const row = await db
    .select({ total: sql<number>`sum(${costLedger.costCents})` })
    .from(costLedger)
    .where(gte(costLedger.at, today))
    .then((rows: any[]) => rows[0]);
  return row?.total ?? 0;
}

export async function monthSpendCents(): Promise<number> {
  const monthStart = monthStartUtc();
  const row = await db
    .select({ total: sql<number>`sum(${costLedger.costCents})` })
    .from(costLedger)
    .where(gte(costLedger.at, monthStart))
    .then((rows: any[]) => rows[0]);
  return row?.total ?? 0;
}

/**
 * Insert or bump a rollup row. Call from generatePlan at the end of a
 * request. Ignore errors — the raw ledger is always the source of truth.
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
  const day = todayUtc();
  const rowId = `${day}:${input.subjectKind}:${input.subjectId}`;
  try {
    await db.insert(usageDailyRollup).values({
      id: rowId,
      dayUtc: day,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      plansGenerated: input.plansGenerated ?? 0,
      cacheHits: input.cacheHits ?? 0,
      cacheMisses: input.cacheMisses ?? 0,
      aiCalls: input.aiCalls ?? 0,
      externalCalls: input.externalCalls ?? 0,
      costCents: input.costCents ?? 0,
      timeSavedMs: input.timeSavedMs ?? 0,
    }).onConflictDoUpdate({
      target: [usageDailyRollup.dayUtc, usageDailyRollup.subjectKind, usageDailyRollup.subjectId],
      set: {
        plansGenerated: sql`${usageDailyRollup.plansGenerated} + ${input.plansGenerated ?? 0}`,
        cacheHits: sql`${usageDailyRollup.cacheHits} + ${input.cacheHits ?? 0}`,
        cacheMisses: sql`${usageDailyRollup.cacheMisses} + ${input.cacheMisses ?? 0}`,
        aiCalls: sql`${usageDailyRollup.aiCalls} + ${input.aiCalls ?? 0}`,
        externalCalls: sql`${usageDailyRollup.externalCalls} + ${input.externalCalls ?? 0}`,
        costCents: sql`${usageDailyRollup.costCents} + ${input.costCents ?? 0}`,
        timeSavedMs: sql`${usageDailyRollup.timeSavedMs} + ${input.timeSavedMs ?? 0}`,
      },
    });
  } catch (err: any) {
    console.warn('[costLedger] rollup upsert failed:', err?.message ?? err);
  }
}
