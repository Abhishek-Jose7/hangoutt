import { createHash } from 'crypto';
import { PLANNER_VERSION, currentPlannerContext, plannerLog } from '../observability/plannerContext';
import { apiCacheInvalidate, apiCacheLookup, apiCacheStore } from './costControlClient';

/**
 * All inputs that materially affect planner output. Any change here MUST be
 * paired with a PLANNER_VERSION bump — otherwise stale cache entries would
 * return outputs computed from a different input shape.
 */
export interface CacheKeyInputs {
  groupId: string;
  groupType: string;
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

function round3(n: number): number { return Math.round(n * 1000) / 1000; }
function normaliseTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function computeCacheKey(inputs: CacheKeyInputs): string {
  return createHash('sha256').update(canonicalise(inputs)).digest('hex');
}

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
  const res = await apiCacheLookup({ key, plannerVersion: PLANNER_VERSION });
  if (!res.hit || !res.payloadJson) return { hit: false };

  let payload: T | undefined;
  let planIds: string[] = [];
  try { payload = JSON.parse(res.payloadJson) as T; } catch { return { hit: false }; }
  try { planIds = JSON.parse(res.planIdsJson ?? '[]') as string[]; } catch {}

  plannerLog({
    event: 'CACHE_HIT',
    key,
    durationMs: res.generationTimeMs ?? 0,
    metadata: { hits: res.hits ?? 0, ageHours: res.createdAt ? hoursSince(res.createdAt) : 0 },
  });

  const ctx = currentPlannerContext();
  if (ctx) ctx.cacheHit = true;

  return {
    hit: true,
    payload: payload as T,
    planIds,
    createdAt: res.createdAt ?? '',
    hits: res.hits ?? 0,
    generationTimeMs: res.generationTimeMs ?? 0,
    estimatedCostCents: res.estimatedCostCents ?? 0,
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
  await apiCacheStore({
    key: input.key,
    plannerVersion: PLANNER_VERSION,
    groupId: input.groupId,
    planIdsJson: JSON.stringify(input.planIds),
    planPayloadJson: JSON.stringify(input.payload),
    ttlHours: CACHE_TTL_HOURS,
    generationTimeMs: input.generationTimeMs,
    estimatedCostCents: input.estimatedCostCents,
  });
  plannerLog({
    event: 'CACHE_STORED',
    key: input.key,
    durationMs: input.generationTimeMs,
    costCents: input.estimatedCostCents,
  });
}

export async function invalidateGroupCache(groupId: string): Promise<number> {
  await apiCacheInvalidate(groupId);
  return 0; // count not exposed
}

export async function sweepExpiredCache(): Promise<number> {
  // Worker sweeps on its own cron; nothing for the Next.js host to do here.
  return 0;
}

function hoursSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return 0;
  return Math.round((Date.now() - then) / 3600 / 1000);
}
