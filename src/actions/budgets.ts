'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { memberRepository } from '@/lib/repositories/member.repository';
import { budgetRepository } from '@/lib/repositories/budget.repository';
import { submitBudgetSchema } from '@/lib/validators/budget.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';

export async function submitBudget(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Validate inputs
    const parsed = submitBudgetSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, maxBudget } = parsed.data;

    // Check that user is a member
    const member = await memberRepository.getMember(groupId, user.id);
    if (!member) {
      throw new NotFoundError('You must be a member of the group to submit a budget.');
    }

    const randomUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    const budget = await budgetRepository.upsertBudget({
      id: randomUUID(),
      groupId,
      userId: user.id,
      maxBudget,
    });

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(budget);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateBudget(rawInput: unknown): ActionResponse<any> {
  // Submission upserts, so submitBudget handles both creation and updates
  return submitBudget(rawInput);
}

import { ActionResponse } from '@/lib/types/api.types';
