import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/utils/apiResponse';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { plannerService } from '@/lib/services/planner.service';

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUser();

    // 2. Parse request payload
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

    // 3. Invoke planner service
    const result = await plannerService.generatePlan(user.id, groupId);
    return apiResponse.toNextSuccess(result.plans);
  } catch (err) {
    return apiResponse.toNextError(err);
  }
}
