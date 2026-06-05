'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { votingService } from '@/lib/services/voting.service';
import { createVoteSchema } from '@/lib/validators/vote.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';

export async function createVote(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Validate inputs
    const parsed = createVoteSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, planId } = parsed.data;

    // Delegate to service
    const vote = await votingService.castVote(user.id, groupId, planId);

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(vote);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateVote(rawInput: unknown): ActionResponse<any> {
  // Submission upserts, so createVote handles both initial casting and updates
  return createVote(rawInput);
}

export async function countVotes(groupId: string): ActionResponse<any> {
  try {
    const user = await getCurrentUser();

    // Delegate to service
    const tallies = await votingService.tallyVotes(user.id, groupId);
    return apiResponse.success(tallies);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function closeVoting(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    // Delegate to service
    await votingService.closeVoting(user.id, groupId);

    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/planner/${groupId}`);
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}
