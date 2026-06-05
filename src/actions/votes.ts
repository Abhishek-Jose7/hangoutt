'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { groupRepository } from '@/lib/repositories/group.repository';
import { memberRepository } from '@/lib/repositories/member.repository';
import { voteRepository } from '@/lib/repositories/vote.repository';
import { createVoteSchema } from '@/lib/validators/vote.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError, ForbiddenError, NotFoundError, VoteClosedError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';

export async function createVote(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Validate inputs
    const parsed = createVoteSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, planId } = parsed.data;

    // Check group existence and status
    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (group.votingStatus !== 'OPEN') {
      throw new VoteClosedError('Voting has already closed or is not yet open for this outing.');
    }

    // Check user membership
    const member = await memberRepository.getMember(groupId, user.id);
    if (!member) {
      throw new ForbiddenError('You must be a member of this group to cast a vote.');
    }

    const randomUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    // Upsert vote
    const vote = await voteRepository.upsertVote({
      id: randomUUID(),
      groupId,
      userId: user.id,
      planId,
    });

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(vote);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateVote(rawInput: unknown): ActionResponse<any> {
  // Submission upserts, so createVote handles both initial vote casting and updates
  return createVote(rawInput);
}

export async function countVotes(groupId: string): ActionResponse<any> {
  try {
    const user = await getCurrentUser();

    // Verify member exists
    const member = await memberRepository.getMember(groupId, user.id);
    if (!member) {
      throw new ForbiddenError('You must be a member of this group to view vote counts.');
    }

    const tallies = await voteRepository.countVotes(groupId);
    return apiResponse.success(tallies);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function closeVoting(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    // Verify group
    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    // Verify owner
    if (group.creatorId !== user.id) {
      throw new ForbiddenError('Only the group owner can close the voting session.');
    }

    // Update group voting status to CLOSED
    await groupRepository.update(groupId, {
      votingStatus: 'CLOSED',
    });

    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/planner/${groupId}`);
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

import { ActionResponse } from '@/lib/types/api.types';
