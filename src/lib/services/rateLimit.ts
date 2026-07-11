import { plannerLog } from '../observability/plannerContext';
import { isAdminEmail } from '../auth/adminEmails';
import { apiRateCheck } from './costControlClient';

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
 * generating a plan every few minutes is nowhere near 15/hr, but a script
 * hammering the endpoint hits the burst cap in one minute.
 */
const LIMITS: Record<RateLimitOperation, OperationLimits> = {
  PLAN_GENERATE: {
    perUser: [
      { sizeSec: 60,      max: 3   },
      { sizeSec: 3600,    max: 15  },
      { sizeSec: 86400,   max: 60  },
    ],
    perGroup: [
      { sizeSec: 60,      max: 4   },
      { sizeSec: 3600,    max: 30  },
      { sizeSec: 86400,   max: 120 },
    ],
    perIp: [
      { sizeSec: 60,      max: 8   },
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
  /** If provided AND matches the admin allowlist, all limits are bypassed. */
  userEmail?: string | null;
}

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitCheckResult> {
  const limits = LIMITS[input.operation];
  if (!limits) return { allowed: true };

  // Admin bypass — hardcoded emails have no rate limits on any operation.
  if (isAdminEmail(input.userEmail)) {
    plannerLog({
      event: 'RATE_LIMIT_BYPASSED',
      operation: input.operation,
      reason: 'admin_email',
    });
    return { allowed: true };
  }

  const subjects = [
    input.userId ? { kind: 'USER' as const, id: input.userId, windows: limits.perUser } : null,
    input.groupId ? { kind: 'GROUP' as const, id: input.groupId, windows: limits.perGroup } : null,
    input.ip ? { kind: 'IP' as const, id: input.ip, windows: limits.perIp } : null,
  ].filter(Boolean) as Array<{ kind: SubjectKind; id: string; windows: WindowSpec[] }>;

  if (subjects.length === 0) return { allowed: true };

  const result = await apiRateCheck({ operation: input.operation, subjects });
  if (!result.allowed && result.hit) {
    plannerLog({
      event: 'RATE_LIMITED',
      operation: input.operation,
      reason: `${result.hit.subjectKind}:${result.hit.subjectId} @ ${result.hit.windowSizeSec}s`,
      retryAfterSeconds: result.hit.retryAfterSec,
      metadata: { current: result.hit.current, max: result.hit.max },
    });
    return {
      allowed: false,
      hit: {
        subjectKind: result.hit.subjectKind as SubjectKind,
        subjectId: result.hit.subjectId,
        windowSizeSec: result.hit.windowSizeSec,
        max: result.hit.max,
        current: result.hit.current,
        retryAfterSec: result.hit.retryAfterSec,
      },
    };
  }
  return { allowed: true };
}

/**
 * Sweep is now handled server-side. Kept as a no-op for compatibility.
 */
export async function sweepExpiredWindows(): Promise<number> {
  return 0;
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
