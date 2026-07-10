import { createHash, randomUUID } from 'crypto';
import { db } from '../db/client';
import { itineraryCache } from '../db/schema';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { PLANNER_VERSION, currentPlannerContext, plannerLog } from '../observability/plannerContext';

/**
 * All inputs that materially affect planner output. Any change here MUST be
 * paired with a PLANNER_VERSION bump — otherwise stale cache entries would
 * return outputs computed from a different input shape.
 */
export interface CacheKeyInputs {
  groupId: string;
  groupType: string;
  // Members are represented by their location (lat, lng rounded to 3dp,
  // ~110m). Two different users at the same location produce the same key.
  memberLocations: Array<{ lat: number; lng: number }>;
  outingTime: string | null | undefined;
  outingDate: string | null | undefined;
  budget: number;
  preferredCategories: string[];
  requiredPreferences: string[];
  vibes: string[];
  options: string[];
  intent: string | null | undefined;
}

const CACHE_TTL_HOURS = Number(process.env.HANGOUT_CACHE_TTL_HOURS ?? 24);

function canonicalise(inputs: CacheKeyInputs): string {
  // Sort every array so member order / preference order doesn't split the key.
  // Round coordinates so trivial GPS jitter doesn't split the key either.
  const canonical = {
    v: PLANNER_VERSION,
    groupType: (inputs.groupType || 'CUSTOM').toUpperCase(),
    members: [...inputs.memberLocations]
      .map(m => ({ lat: round3(m.lat), lng: round3(m.lng) }))
      .sort((a, b) => (a.lat - b.lat) || (a.lng - b.lng)),
    time: normaliseTime(inputs.outingTime),
    date: inputs.outingDate ?? null,
    budget: Math.round(inputs.budget ?? 0),
    prefs: [...(inputs.preferredCategories ?? [])].map(s => s.toUpperCase()).sort(),
    required: [...(inputs.requiredPreferences ?? [])].map(s => s.toUpperCase()).sort(),
    vibes: [...(inputs.vibes ?? [])].map(s => s.toUpperCase()).sort(),
    options: [...(inputs.options ?? [])].sort(),
    intent: inputs.intent ?? null,
  };
  return JSON.stringify(canonical);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function normaliseTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function computeCacheKey(inputs: CacheKeyInputs): string {
  const canonical = canonicalise(inputs);
  return createHash('sha256').update(canonical).digest('hex');
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export interface CacheHit<T> {
  hit: true;
  payload: T;
  planIds: string[];
  createdAt: string;
  hits: number;
  generationTimeMs: number;
  estimatedCostCents: number;
}

export type CacheLookup<T> = CacheHit<T> | { hit: false };

export async function lookupCache<T = unknown>(key: string): Promise<CacheLookup<T>> {
  const row = await db
    .select()
    .from(itineraryCache)
    .where(and(
      eq(itineraryCache.key, key),
      eq(itineraryCache.plannerVersion, PLANNER_VERSION),
      gte(itineraryCache.expiresAt, new Date().toISOString()),
    ))
    .then((rows: any[]) => rows[0])
    .catch(() => undefined);

  if (!row) return { hit: false };

  // Bump the hit counter — best-effort.
  void db.update(itineraryCache)
    .set({ hits: sql`${itineraryCache.hits} + 1` })
    .where(eq(itineraryCache.key, key))
    .catch(() => {});

  const payload = safeParseJSON<T>(row.planPayloadJson);
  const planIds = safeParseJSON<string[]>(row.planIdsJson) ?? [];
  if (payload === undefined) return { hit: false };

  plannerLog({
    event: 'CACHE_HIT',
    key,
    durationMs: row.generationTimeMs,
    metadata: { hits: row.hits + 1, ageHours: hoursSince(row.createdAt) },
  });

  const ctx = currentPlannerContext();
  if (ctx) ctx.cacheHit = true;

  return {
    hit: true,
    payload,
    planIds,
    createdAt: row.createdAt,
    hits: row.hits + 1,
    generationTimeMs: row.generationTimeMs,
    estimatedCostCents: row.estimatedCostCents,
  };
}

export async function storeCache<T>(input: {
  key: string;
  groupId: string;
  payload: T;
  planIds: string[];
  generationTimeMs: number;
  estimatedCostCents: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 3600 * 1000).toISOString();
  try {
    await db.insert(itineraryCache).values({
      key: input.key,
      plannerVersion: PLANNER_VERSION,
      groupId: input.groupId,
      planIdsJson: JSON.stringify(input.planIds),
      planPayloadJson: JSON.stringify(input.payload),
      expiresAt,
      hits: 0,
      generationTimeMs: input.generationTimeMs,
      estimatedCostCents: input.estimatedCostCents,
    }).onConflictDoUpdate({
      target: itineraryCache.key,
      set: {
        plannerVersion: PLANNER_VERSION,
        planIdsJson: JSON.stringify(input.planIds),
        planPayloadJson: JSON.stringify(input.payload),
        expiresAt,
        generationTimeMs: input.generationTimeMs,
        estimatedCostCents: input.estimatedCostCents,
      },
    });
    plannerLog({
      event: 'CACHE_STORED',
      key: input.key,
      durationMs: input.generationTimeMs,
      costCents: input.estimatedCostCents,
    });
  } catch (err: any) {
    console.warn('[itineraryCache] store failed:', err?.message ?? err);
  }
}

/**
 * Invalidate any cache entries for this group (e.g. members left, budget
 * changed). We purge by groupId rather than by input hash so we don't need
 * to reconstruct the exact request that produced the cached row.
 */
export async function invalidateGroupCache(groupId: string): Promise<number> {
  try {
    const result = await db.delete(itineraryCache).where(eq(itineraryCache.groupId, groupId));
    return (result as any)?.changes ?? 0;
  } catch {
    return 0;
  }
}

export async function sweepExpiredCache(): Promise<number> {
  try {
    const result = await db
      .delete(itineraryCache)
      .where(lt(itineraryCache.expiresAt, new Date().toISOString()));
    return (result as any)?.changes ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function safeParseJSON<T>(text: string | null | undefined): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function hoursSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return 0;
  return Math.round((Date.now() - then) / 3600 / 1000);
}
