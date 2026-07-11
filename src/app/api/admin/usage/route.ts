import { NextRequest, NextResponse } from 'next/server';
import { getUsageSummary } from '@/lib/services/costLedger';
import { isAdminEmail } from '@/lib/auth/adminEmails';
import { getCurrentApiUser, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin usage dashboard endpoint.
 *
 * Auth: signed-in admin email OR `x-admin-token` header matching
 * `process.env.ADMIN_API_TOKEN`. Either works.
 *
 * Query params:
 *   - days: how many days back to summarise (default 7, max 90)
 */
export async function GET(req: NextRequest) {
  let authorized = false;

  const adminToken = process.env.ADMIN_API_TOKEN;
  const provided = req.headers.get('x-admin-token');
  if (adminToken && provided === adminToken) {
    authorized = true;
  }
  if (!authorized) {
    try {
      if (isHangoutApiConfigured()) {
        const user = await getCurrentApiUser();
        if (isAdminEmail(user.email)) authorized = true;
      }
    } catch {
      // fall through
    }
  }
  if (!authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const daysParam = parseInt(req.nextUrl.searchParams.get('days') || '7', 10);
  const days = Math.max(1, Math.min(90, isFinite(daysParam) ? daysParam : 7));

  const summary = await getUsageSummary(days);
  if (!summary) {
    return NextResponse.json({ error: 'usage summary not available' }, { status: 503 });
  }
  return NextResponse.json(summary);
}
