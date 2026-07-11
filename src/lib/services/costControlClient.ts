import { hangoutApi } from '../cloudflare/hangoutApi';

/**
 * HTTP client for the /internal/cost-control/* endpoints served by the
 * Cloudflare Worker. Every call goes directly to remote D1 — there is no
 * local SQLite fallback.
 *
 * All methods are best-effort: they swallow errors so a failing cost-control
 * layer never breaks planning. The failures are logged.
 */

async function safeCall<T>(fn: () => Promise<T>, fallback: T, tag: string): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    console.warn(`[costControlClient:${tag}]`, err?.message ?? err);
    return fallback;
  }
}

// ---------------- Cache -----------------

export async function apiCacheLookup(input: {
  key: string;
  plannerVersion: string;
}): Promise<{
  hit: boolean;
  payloadJson?: string;
  planIdsJson?: string;
  createdAt?: string;
  hits?: number;
  generationTimeMs?: number;
  estimatedCostCents?: number;
}> {
  return safeCall(async () => {
    const res = await hangoutApi<{ success: boolean; data: any }>('/internal/cost-control/cache-lookup', {
      method: 'POST',
      body: input,
    });
    if (!res?.success) return { hit: false };
    return res.data;
  }, { hit: false }, 'cache-lookup');
}

export async function apiCacheStore(input: {
  key: string;
  plannerVersion: string;
  groupId: string;
  planIdsJson: string;
  planPayloadJson: string;
  ttlHours?: number;
  generationTimeMs?: number;
  estimatedCostCents?: number;
}): Promise<void> {
  await safeCall(
    () => hangoutApi<{ success: boolean }>('/internal/cost-control/cache-store', { method: 'POST', body: input }),
    { success: false },
    'cache-store'
  );
}

export async function apiCacheInvalidate(groupId: string): Promise<void> {
  await safeCall(
    () => hangoutApi<{ success: boolean }>('/internal/cost-control/cache-invalidate', { method: 'POST', body: { groupId } }),
    { success: false },
    'cache-invalidate'
  );
}

// ---------------- Rate limit -----------------

export interface RateCheckSubject {
  kind: 'USER' | 'GROUP' | 'IP';
  id: string;
  windows: Array<{ sizeSec: number; max: number }>;
}

export async function apiRateCheck(input: {
  operation: string;
  subjects: RateCheckSubject[];
}): Promise<{ allowed: boolean; hit?: { subjectKind: string; subjectId: string; windowSizeSec: number; max: number; current: number; retryAfterSec: number } }> {
  return safeCall(async () => {
    const res = await hangoutApi<{ success: boolean; data: any }>('/internal/cost-control/rate-check', {
      method: 'POST',
      body: input,
    });
    if (!res?.success) return { allowed: true }; // fail open
    return res.data;
  }, { allowed: true }, 'rate-check');
}

// ---------------- Inflight guard -----------------

export async function apiInflightAcquire(input: {
  key: string;
  operation: string;
  subjectId?: string;
  ttlSec?: number;
}): Promise<{ acquired: boolean }> {
  return safeCall(async () => {
    const res = await hangoutApi<{ success: boolean; data: any }>('/internal/cost-control/inflight-acquire', {
      method: 'POST',
      body: input,
    });
    if (!res?.success) return { acquired: true };
    return res.data;
  }, { acquired: true }, 'inflight-acquire');
}

export async function apiInflightRelease(key: string): Promise<void> {
  await safeCall(
    () => hangoutApi<{ success: boolean }>('/internal/cost-control/inflight-release', { method: 'POST', body: { key } }),
    { success: false },
    'inflight-release'
  );
}

// ---------------- Cost ledger -----------------

export async function apiCostRecord(input: {
  userId?: string | null;
  groupId?: string | null;
  operation: string;
  provider: string;
  units?: number;
  costCents?: number;
  metadata?: unknown;
  cacheHit?: boolean;
}): Promise<void> {
  await safeCall(
    () => hangoutApi<{ success: boolean }>('/internal/cost-control/cost-record', { method: 'POST', body: input }),
    { success: false },
    'cost-record'
  );
}

export async function apiRollupBump(input: {
  subjectKind: 'GLOBAL' | 'USER' | 'GROUP';
  subjectId: string;
  plansGenerated?: number;
  cacheHits?: number;
  cacheMisses?: number;
  aiCalls?: number;
  externalCalls?: number;
  costCents?: number;
  timeSavedMs?: number;
}): Promise<void> {
  await safeCall(
    () => hangoutApi<{ success: boolean }>('/internal/cost-control/rollup-bump', { method: 'POST', body: input }),
    { success: false },
    'rollup-bump'
  );
}

export async function apiUsageSummary(days: number): Promise<any> {
  return safeCall(async () => {
    const res = await hangoutApi<{ success: boolean; data: any }>(`/internal/cost-control/usage-summary?days=${days}`);
    if (!res?.success) return null;
    return res.data;
  }, null, 'usage-summary');
}
