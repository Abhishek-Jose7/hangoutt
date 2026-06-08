'use server';

import { createVoteSchema } from '@/lib/validators/vote.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';
import { isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export async function createVote(rawInput: unknown): ActionResponse<any> {
  try {
    // Validate inputs
    const parsed = createVoteSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, planId } = parsed.data;

    if (isHangoutApiConfigured()) {
      throw new ValidationError('Voting is not available through the D1 Worker API yet.');
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { votingService } = await import('@/lib/services/voting.service');
    const user = await getCurrentUser();

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
    if (isHangoutApiConfigured()) {
      return apiResponse.success([]);
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { votingService } = await import('@/lib/services/voting.service');
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
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Voting is not available through the D1 Worker API yet.');
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { votingService } = await import('@/lib/services/voting.service');
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

export async function finalizeVotingAction(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Voting is not available through the D1 Worker API yet.');
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { votingService } = await import('@/lib/services/voting.service');
    const user = await getCurrentUser();

    // Manually finalize voting as admin
    await votingService.finalizeVoting(user.id, groupId, true);

    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/planner/${groupId}`);
    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function getUserVoteForGroup(groupId: string): ActionResponse<string | null> {
  try {
    if (isHangoutApiConfigured()) {
      return apiResponse.success(null);
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { voteRepository } = await import('@/lib/repositories/vote.repository');
    const user = await getCurrentUser();
    const allVotes = await voteRepository.getVotesForGroup(groupId);
    const userVote = allVotes.find(v => v.userId === user.id);
    return apiResponse.success(userVote ? userVote.planId : null);
  } catch (err) {
    return apiResponse.error(err);
  }
}
