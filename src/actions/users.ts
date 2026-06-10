'use server';

import { apiResponse } from '@/lib/utils/apiResponse';
import { ActionResponse } from '@/lib/types/api.types';
import { getCurrentApiUser, hangoutApi, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export async function updateUserProfile(
  name: string,
  preferredBudgetMin?: number,
  preferredBudgetMax?: number,
  favoriteActivities?: string[]
): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const updatedUser = await hangoutApi<any>('/users/profile', {
        method: 'PATCH',
        body: {
          clerkId: user.clerkId,
          name,
          preferredBudgetMin,
          preferredBudgetMax,
          favoriteActivities,
        },
      });
      return updatedUser;
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { userRepository } = await import('@/lib/repositories/user.repository');
    const user = await getCurrentUser();

    const updated = await userRepository.update(user.id, {
      name,
      preferredBudgetMin,
      preferredBudgetMax,
      favoriteActivities: favoriteActivities ? JSON.stringify(favoriteActivities) : undefined,
    });

    return apiResponse.success(updated);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function getUserPreferencesAction(): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const dbUser = await hangoutApi<any>(`/users?clerkId=${encodeURIComponent(user.clerkId)}`);
      return dbUser;
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { userRepository } = await import('@/lib/repositories/user.repository');
    const user = await getCurrentUser();
    const dbUser = await userRepository.findById(user.id);

    return apiResponse.success(dbUser);
  } catch (err) {
    return apiResponse.error(err);
  }
}
