import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/utils/apiResponse';
import { requireAuth } from '@/lib/auth/requireAuth';

export async function GET(_req: NextRequest) {
  try {
    // 1. Authenticate user
    await requireAuth();

    // 2. Proxied Ola Maps fetch stub
    return apiResponse.toNextSuccess({
      message: 'Ola Maps API proxy GET endpoint active. Real endpoints will proxy securely to prevent API key exposure.',
    });
  } catch (err) {
    return apiResponse.toNextError(err);
  }
}

export async function POST(_req: NextRequest) {
  try {
    await requireAuth();

    return apiResponse.toNextSuccess({
      message: 'Ola Maps API proxy POST endpoint active.',
    });
  } catch (err) {
    return apiResponse.toNextError(err);
  }
}
