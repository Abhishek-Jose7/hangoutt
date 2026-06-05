'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { budgetService } from '@/lib/services/budget.service';
import { submitBudgetSchema } from '@/lib/validators/budget.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';

export async function submitBudget(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Validate inputs
    const parsed = submitBudgetSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, maxBudget } = parsed.data;

    const budget = await budgetService.submitBudget(user.id, groupId, maxBudget);

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(budget);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateBudget(rawInput: unknown): ActionResponse<any> {
  // Submission handles both create and update (upsert)
  return submitBudget(rawInput);
}
