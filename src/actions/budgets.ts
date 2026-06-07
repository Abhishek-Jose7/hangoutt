'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { submitBudgetSchema } from '@/lib/validators/budget.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';
import { getCurrentApiUser, hangoutApi, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export async function submitBudget(rawInput: unknown): ActionResponse<any> {
  try {
    const parsed = submitBudgetSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, maxBudget } = parsed.data;

    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const budget = await hangoutApi<any>(`/groups/${groupId}/budget`, {
        method: 'POST',
        body: {
          clerkId: user.clerkId,
          maxBudget,
        },
      });

      revalidatePath(`/groups/${groupId}`);
      return budget;
    }

    const user = await getCurrentUser();
    const { budgetService } = await import('@/lib/services/budget.service');
    const budget = await budgetService.submitBudget(user.id, groupId, maxBudget);

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(budget);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateBudget(rawInput: unknown): ActionResponse<any> {
  return submitBudget(rawInput);
}
