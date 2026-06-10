'use server';

import { createVoteSchema } from '@/lib/validators/vote.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError, ForbiddenError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';
import { isHangoutApiConfigured, getCurrentApiUser, hangoutApi } from '@/lib/cloudflare/hangoutApi';

export async function createVote(rawInput: unknown): ActionResponse<any> {
  try {
    // Validate inputs
    const parsed = createVoteSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, planId } = parsed.data;

    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const vote = await hangoutApi<any>(`/groups/${groupId}/vote`, {
        method: 'POST',
        body: {
          clerkId: user.clerkId,
          planId,
        },
      });
      
      // Check if all members have voted to automatically finalize voting
      const { getGroupDetailsAction } = await import('@/actions/groups');
      const detailsRes = await getGroupDetailsAction(groupId);
      if (detailsRes.success) {
        const { members } = detailsRes.data;
        const votesRes = await countVotes(groupId);
        if (votesRes.success) {
          const totalVotes = votesRes.data.reduce((sum: number, t: any) => sum + t.count, 0);
          if (totalVotes >= members.length) {
            await closeVoting(groupId);
          }
        }
      }

      revalidatePath(`/groups/${groupId}`);
      return vote;
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
      const response = await hangoutApi<any>(`/groups/${groupId}/votes`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to count votes from D1');
      }
      return apiResponse.success(response.data);
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
      const { getGroupDetailsAction } = await import('@/actions/groups');
      const detailsRes = await getGroupDetailsAction(groupId);
      if (!detailsRes.success) {
        throw new Error(detailsRes.error?.message || 'Failed to fetch group details');
      }

      const { members } = detailsRes.data;
      const { getPlansForGroupAction } = await import('@/actions/planner');
      const plansRes = await getPlansForGroupAction(groupId);
      if (!plansRes.success) {
        throw new Error(plansRes.error?.message || 'Failed to fetch group plans');
      }

      // Local tie breaking winner determination in Next.js
      const { votingService } = await import('@/lib/services/voting.service');
      const winnerPlanId = await votingService.determineWinner(groupId, members);
      if (!winnerPlanId) {
        throw new Error('Could not determine a winning plan');
      }

      const winnerPlan = plansRes.data.find((p: any) => p.id === winnerPlanId);
      if (!winnerPlan) {
        throw new Error('Winning plan details not found');
      }

      const user = await getCurrentApiUser();
      const participants = members.map((m: any) => ({ userId: m.userId, name: m.name, email: m.email }));

      const response = await hangoutApi<any>(`/groups/${groupId}/close-voting`, {
        method: 'PATCH',
        body: {
          clerkId: user.clerkId,
          winnerPlanId,
          outingDate: new Date().toISOString().split('T')[0],
          groupName: detailsRes.data.group.name,
          planName: winnerPlan.name,
          planTagline: winnerPlan.tagline,
          venuesJson: JSON.stringify(winnerPlan.slots.map((s: any) => ({
            name: s.name,
            category: s.category,
            arrivalTime: s.arrivalTime,
            durationMinutes: s.durationMinutes,
            estimatedCostPerHead: s.estimatedCostPerHead,
            note: s.note,
          }))),
          participantsJson: JSON.stringify(participants),
          totalCostPerHead: winnerPlan.totalEstimatedCostPerHead,
        },
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to close voting in D1');
      }

      revalidatePath(`/groups/${groupId}`);
      revalidatePath(`/planner/${groupId}`);
      return apiResponse.success({ success: true });
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
  return closeVoting(groupId);
}

export async function getUserVoteForGroup(groupId: string): ActionResponse<string | null> {
  try {
    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const response = await hangoutApi<any>(`/groups/${groupId}/votes-user?clerkId=${encodeURIComponent(user.clerkId)}`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to get user vote from D1');
      }
      return apiResponse.success(response.data);
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
