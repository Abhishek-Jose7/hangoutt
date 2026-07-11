import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/utils/apiResponse';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { getCurrentApiUser, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';
import { plannerService } from '@/lib/services/planner.service';

export async function POST(req: NextRequest) {
  try {
    // 1. Parse request payload
    const body = await req.json();
    const { groupId } = body;

    if (!groupId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'groupId is required in request body.' },
        },
        { status: 400 }
      );
    }

    // Extract client IP for rate-limit accounting. Prefer forwarded headers
    // (behind Cloudflare / Vercel edge), fall back to the direct remote.
    const ip = req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
      || undefined;

    // 2. Authenticate user and invoke planner service
    if (isHangoutApiConfigured()) {
      const apiUser = await getCurrentApiUser();
      const result = await plannerService.generatePlan(apiUser.id || apiUser.clerkId, groupId, [], {
        clerkId: apiUser.clerkId,
        ip,
        email: apiUser.email,
      });
      return apiResponse.toNextSuccess(result.plans);
    }

    const user = await getCurrentUser();
    const result = await plannerService.generatePlan(user.id, groupId, [], {
      ip,
      email: (user as any).email,
    });
    return apiResponse.toNextSuccess(result.plans);
  } catch (err) {
    return apiResponse.toNextError(err);
  }
}
