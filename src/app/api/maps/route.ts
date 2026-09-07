import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/utils/apiResponse';
import { requireAuth } from '@/lib/auth/requireAuth';

export async function GET(_req: NextRequest) {
  try {
    await requireAuth();
    return apiResponse.toNextError(new Error('Maps provider integration disabled; use sourced venue catalog links.'));
  } catch (err) {
    return apiResponse.toNextError(err);
  }
}

export async function POST(_req: NextRequest) {
  try {
    await requireAuth();
    return apiResponse.toNextError(new Error('Maps provider integration disabled; use sourced venue catalog links.'));
  } catch (err) {
    return apiResponse.toNextError(err);
  }
}
