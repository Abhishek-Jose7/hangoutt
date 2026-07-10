import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { costLedger, itineraryCache, usageDailyRollup } from '@/lib/db/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  getGlobalUsage,
  getTopCostSubjects,
  monthSpendCents,
  todaySpendCents,
} from '@/lib/services/costLedger';
import { sweepExpiredCache } from '@/lib/services/itineraryCache';
import { sweepExpiredWindows } from '@/lib/services/rateLimit';
import { sweepExpiredInflightGuards } from '@/lib/services/inflightRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin usage dashboard endpoint.
 *
 * Auth: requires header `x-admin-token` matching `process.env.ADMIN_API_TOKEN`.
 * Not user-facing — used by internal dashboards / on-call scripts.
 *
 * Query params:
 *   - days: how many days back to summarise (default 7, max 90)
 *   - sweep: if '1', opportunistically cleans expired cache / rate-limit / inflight rows
 */
export async function GET(req: NextRequest) {
  const adminToken = process.env.ADMIN_API_TOKEN;
  const provided = req.headers.get('x-admin-token');
  if (!adminToken || provided !== adminToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl;
  const daysParam = parseInt(url.searchParams.get('days') || '7', 10);
  const days = Math.max(1, Math.min(90, isFinite(daysParam) ? daysParam : 7));
  const sweep = url.searchParams.get('sweep') === '1';

  const now = Date.now();
  const from = new Date(now - days * 86400 * 1000).toISOString();
  const to = new Date(now).toISOString();
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    // ---- Global operational counters ----------
    const [spendToday, spendMonth, opBreakdown, topUsers, topGroups] = await Promise.all([
      todaySpendCents(),
      monthSpendCents(),
      getGlobalUsage({ from, to }),
      getTopCostSubjects('USER', { from, to }, 10),
      getTopCostSubjects('GROUP', { from, to }, 10),
    ]);

    // ---- Cache stats -----------------------------
    const cacheStatsRow = await db
      .select({
        entries: sql<number>`count(*)`,
        totalHits: sql<number>`sum(${itineraryCache.hits})`,
        avgAgeHours: sql<number>`avg((julianday(current_timestamp) - julianday(${itineraryCache.createdAt})) * 24)`,
        estimatedSavedCents: sql<number>`sum(${itineraryCache.hits} * ${itineraryCache.estimatedCostCents})`,
        estimatedTimeSavedMs: sql<number>`sum(${itineraryCache.hits} * ${itineraryCache.generationTimeMs})`,
      })
      .from(itineraryCache)
      .then((rows: any[]) => rows[0] || {});

    // ---- Daily rollup for the last N days --------
    const cutoff = new Date(now - days * 86400 * 1000).toISOString().slice(0, 10);
    const rollup = await db
      .select()
      .from(usageDailyRollup)
      .where(and(
        eq(usageDailyRollup.subjectKind, 'GLOBAL'),
        gte(usageDailyRollup.dayUtc, cutoff),
      ))
      .orderBy(desc(usageDailyRollup.dayUtc));

    const totalPlans = rollup.reduce((s: number, r: any) => s + (r.plansGenerated || 0), 0);
    const totalHits = rollup.reduce((s: number, r: any) => s + (r.cacheHits || 0), 0);
    const totalMisses = rollup.reduce((s: number, r: any) => s + (r.cacheMisses || 0), 0);
    const totalRequests = totalHits + totalMisses;
    const cacheHitPct = totalRequests > 0 ? Math.round((totalHits / totalRequests) * 1000) / 10 : 0;

    // ---- Daily active users (distinct userId in cost ledger, per day) ----
    const dauRow = await db
      .select({ count: sql<number>`count(distinct ${costLedger.userId})` })
      .from(costLedger)
      .where(and(
        gte(costLedger.at, todayIso),
        sql`${costLedger.userId} IS NOT NULL`,
      ))
      .then((rows: any[]) => rows[0] || { count: 0 });

    // ---- AI vs external splits (last window) -----
    const aiOps = ['AI_GROQ', 'AI_ANTHROPIC'];
    const externalOps = ['PLACES_TEXTSEARCH', 'PLACES_DETAILS', 'PLACES_NEARBY', 'PLACES_PHOTO', 'OLA_PLACES'];
    const opsMap = new Map<string, { calls: number; costCents: number; units: number; cacheHits: number }>();
    for (const row of opBreakdown as any[]) {
      opsMap.set(row.operation, {
        calls: Number(row.calls || 0),
        costCents: Number(row.costCents || 0),
        units: Number(row.units || 0),
        cacheHits: Number(row.cacheHits || 0),
      });
    }
    const sum = (ops: string[]) => ops.reduce((acc, op) => acc + (opsMap.get(op)?.calls ?? 0), 0);
    const aiCalls = sum(aiOps);
    const externalCalls = sum(externalOps);

    // ---- Sweep if requested ----------------------
    let sweeps: Record<string, number> | undefined;
    if (sweep) {
      const [cache, rate, inflight] = await Promise.all([
        sweepExpiredCache(),
        sweepExpiredWindows(),
        sweepExpiredInflightGuards(),
      ]);
      sweeps = { cacheEntries: cache, rateLimitWindows: rate, inflightGuards: inflight };
    }

    const avgCostPerItineraryCents = totalPlans > 0
      ? Math.round((rollup.reduce((s: number, r: any) => s + (r.costCents || 0), 0) / totalPlans) * 100) / 100
      : 0;
    const avgCostPerActiveUserCents = dauRow.count > 0 && spendToday > 0
      ? Math.round((spendToday / dauRow.count) * 100) / 100
      : 0;

    return NextResponse.json({
      windowDays: days,
      generatedAt: new Date().toISOString(),
      spend: {
        todayCents: spendToday,
        monthCents: spendMonth,
      },
      daily: {
        activeUsers: dauRow.count,
        plansGenerated: totalPlans,
        cacheHits: totalHits,
        cacheMisses: totalMisses,
        cacheHitPct,
        aiRequestsWindow: aiCalls,
        externalRequestsWindow: externalCalls,
      },
      cost: {
        avgCostPerItineraryCents,
        avgCostPerActiveUserCents,
      },
      cache: {
        entriesLive: Number(cacheStatsRow.entries || 0),
        totalHitsAllTime: Number(cacheStatsRow.totalHits || 0),
        avgAgeHours: Math.round((Number(cacheStatsRow.avgAgeHours || 0)) * 10) / 10,
        estimatedSavedCentsAllTime: Number(cacheStatsRow.estimatedSavedCents || 0),
        estimatedTimeSavedMsAllTime: Number(cacheStatsRow.estimatedTimeSavedMs || 0),
      },
      rollupByDay: rollup,
      operationBreakdown: opBreakdown,
      topUsersByCost: topUsers,
      topGroupsByCost: topGroups,
      sweeps,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'usage lookup failed' }, { status: 500 });
  }
}
