import { db } from '../db/client';
import { rateLimitWindows } from '../db/schema';
import { and, eq, lt, sql } from 'drizzle-orm';
import { plannerLog } from '../observability/plannerContext';

export type SubjectKind = 'USER' | 'GROUP' | 'IP';

export type RateLimitOperation =
  | 'PLAN_GENERATE'
  | 'PLAN_REGENERATE'
  | 'VENUE_DISCOVERY'
  | 'AI_CALL';

interface WindowSpec {
  sizeSec: number;
  max: number;
}

interface OperationLimits {
  perUser: WindowSpec[];
  perGroup: WindowSpec[];
  perIp: WindowSpec[];
}

/**
 * Per-operation tiered limits. Each subject gets its own set of windows so a
 * bursty legitimate user doesn't spill onto a group cap, and a shared IP
 * (office, university lab) doesn't shut down individual users.
 *
 * Numbers are calibrated to be invisible to normal usage: a real user
 * generating a plan every few minutes is nowhere near 10/hr, but a script
 * hammering the endpoint hits the burst cap in one minute.
 */
const LIMITS: Record<RateLimitOperation, OperationLimits> = {
  PLAN_GENERATE: {
    perUser: [
      { sizeSec: 60,      max: 3   },  // 3/min burst
      { sizeSec: 3600,    max: 15  },  // 15/hr rolling
      { sizeSec: 86400,   max: 60  },  // 60/day cap
    ],
    perGroup: [
      { sizeSec: 60,      max: 4   },
      { sizeSec: 3600,    max: 30  },
      { sizeSec: 86400,   max: 120 },
    ],
    perIp: [
      { sizeSec: 60,      max: 8   },  // shared IPs
      { sizeSec: 3600,    max: 60  },
      { sizeSec: 86400,   max: 300 },
    ],
  },
  PLAN_REGENERATE: {
    perUser: [
      { sizeSec: 60,      max: 2   },
      { sizeSec: 3600,    max: 10  },
    ],
    perGroup: [
      { sizeSec: 3600,    max: 20  },
    ],
    perIp: [
      { sizeSec: 3600,    max: 50  },
    ],
  },
  VENUE_DISCOVERY: {
    perUser: [{ sizeSec: 3600, max: 50 }],
    perGroup: [{ sizeSec: 3600, max: 100 }],
    perIp: [{ sizeSec: 3600, max: 200 }],
  },
  AI_CALL: {
    perUser: [{ sizeSec: 3600, max: 100 }],
    perGroup: [{ sizeSec: 3600, max: 200 }],
    perIp: [{ sizeSec: 3600, max: 400 }],
  },
};

export interface RateLimitCheckResult {
  allowed: boolean;
  hit?: {
    subjectKind: SubjectKind;
    subjectId: string;
    windowSizeSec: number;
    max: number;
    current: number;
    retryAfterSec: number;
  };
}

interface RateLimitInput {
  operation: RateLimitOperation;
  userId?: string;
  groupId?: string;
  ip?: string;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function windowStart(nowSec: number, sizeSec: number): number {
  return nowSec - (nowSec % sizeSec);
}

/**
 * Increment (or observe) each configured window for each subject. Returns
 * `allowed: false` on the first window that would exceed its cap. Order is
 * (user → group → ip) so the tightest scope refuses first, which gives a
 * more accurate `retryAfterSec` message.
 */
export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitCheckResult> {
  const limits = LIMITS[input.operation];
  if (!limits) return { allowed: true };

  const subjects: Array<{ kind: SubjectKind; id: string | undefined; windows: WindowSpec[] }> = [
    { kind: 'USER', id: input.userId, windows: limits.perUser },
    { kind: 'GROUP', id: input.groupId, windows: limits.perGroup },
    { kind: 'IP', id: input.ip, windows: limits.perIp },
  ];
  const now = nowUnix();

  for (const subject of subjects) {
    if (!subject.id) continue;
    for (const window of subject.windows) {
      const start = windowStart(now, window.sizeSec);
      const rowId = `${subject.kind}:${subject.id}:${input.operation}:${window.sizeSec}:${start}`;

      // Atomic upsert-and-increment. Returns the resulting count so we know
      // whether we crossed the cap.
      try {
        await db.insert(rateLimitWindows).values({
          id: rowId,
          subjectKind: subject.kind,
          subjectId: subject.id,
          operation: input.operation,
          windowStartUnix: start,
          windowSizeSec: window.sizeSec,
          count: 1,
        }).onConflictDoUpdate({
          target: [
            rateLimitWindows.subjectKind,
            rateLimitWindows.subjectId,
            rateLimitWindows.operation,
            rateLimitWindows.windowStartUnix,
            rateLimitWindows.windowSizeSec,
          ],
          set: { count: sql`${rateLimitWindows.count} + 1` },
        });
      } catch (err) {
        // If the DB is unreachable, fail open — we'd rather serve a real user
        // than block them behind a broken limiter.
        return { allowed: true };
      }

      const row = await db
        .select({ count: rateLimitWindows.count })
        .from(rateLimitWindows)
        .where(and(
          eq(rateLimitWindows.subjectKind, subject.kind),
          eq(rateLimitWindows.subjectId, subject.id),
          eq(rateLimitWindows.operation, input.operation),
          eq(rateLimitWindows.windowStartUnix, start),
          eq(rateLimitWindows.windowSizeSec, window.sizeSec),
        ))
        .then((rows: any[]) => rows[0]);

      const current = row?.count ?? 1;
      if (current > window.max) {
        const retryAfterSec = Math.max(1, (start + window.sizeSec) - now);
        plannerLog({
          event: 'RATE_LIMITED',
          operation: input.operation,
          reason: `${subject.kind}:${subject.id} @ ${window.sizeSec}s`,
          retryAfterSeconds: retryAfterSec,
          metadata: { current, max: window.max },
        });
        return {
          allowed: false,
          hit: {
            subjectKind: subject.kind,
            subjectId: subject.id,
            windowSizeSec: window.sizeSec,
            max: window.max,
            current,
            retryAfterSec,
          },
        };
      }
    }
  }
  return { allowed: true };
}

/**
 * Best-effort cleanup of expired windows so the table doesn't grow forever.
 * Called opportunistically (e.g. from the admin API) or via a cron.
 */
export async function sweepExpiredWindows(): Promise<number> {
  const cutoff = nowUnix() - 3 * 86400; // keep 3 days for the dashboard
  try {
    const result = await db
      .delete(rateLimitWindows)
      .where(lt(rateLimitWindows.windowStartUnix, cutoff));
    return (result as any)?.changes ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Turn a rate-limit hit into a user-facing message. Never leaks internals.
 */
export function rateLimitMessage(hit: NonNullable<RateLimitCheckResult['hit']>): string {
  const mins = Math.ceil(hit.retryAfterSec / 60);
  if (hit.windowSizeSec <= 60) {
    return `You're generating plans too quickly. Try again in about ${hit.retryAfterSec} seconds.`;
  }
  if (hit.windowSizeSec <= 3600) {
    return `You've reached the hourly limit. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`;
  }
  return `You've reached today's plan-generation limit. This resets at midnight UTC.`;
}
