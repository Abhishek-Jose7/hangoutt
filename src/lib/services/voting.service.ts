import { voteRepository } from '../repositories/vote.repository';
import { memberRepository } from '../repositories/member.repository';
import { groupRepository } from '../repositories/group.repository';
import { planRepository } from '../repositories/plan.repository';
import { createVoteSchema } from '../validators/vote.schema';
import { ForbiddenError, ValidationError, NotFoundError, VoteClosedError } from '../errors';

export const votingService = {
  async castVote(userId: string, groupId: string, planId: string) {
    // 1. Verify user is member
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not a member of this planning group.');
    }

    // 2. Validate input
    const parsed = createVoteSchema.safeParse({ groupId, planId });
    if (!parsed.success) {
      throw new ValidationError('Invalid vote parameters', parsed.error.flatten());
    }

    // 3. Verify group voting status is OPEN
    const group = await groupRepository.findById(groupId);
    if (!group || group.status === 'DELETED') {
      throw new NotFoundError('Group not found.');
    }

    if (group.votingStatus !== 'OPEN') {
      throw new VoteClosedError('Voting is currently closed for this group outing.');
    }

    // 4. Verify plan exists
    const plan = await planRepository.getPlanWithSlots(planId);
    if (!plan || plan.groupId !== groupId) {
      throw new NotFoundError('Selected itinerary plan not found in this group.');
    }

    const uuid = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    // 5. Upsert vote (enforcing one vote per member)
    return voteRepository.upsertVote({
      id: uuid(),
      groupId,
      userId,
      planId,
    });
  },

  async tallyVotes(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not a member of this planning group.');
    }

    return voteRepository.countVotes(groupId);
  },

  async closeVoting(userId: string, groupId: string) {
    // Only group OWNER can manually close voting
    const member = await memberRepository.getMember(groupId, userId);
    if (!member || member.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner can close the voting session.');
    }

    const group = await groupRepository.findById(groupId);
    if (!group || group.status === 'DELETED') {
      throw new NotFoundError('Group not found.');
    }

    // Update status to CLOSED
    await groupRepository.update(groupId, {
      votingStatus: 'CLOSED',
    });
  },

  async getWinner(groupId: string): Promise<string | null> {
    const tallies = await voteRepository.countVotes(groupId);
    if (tallies.length === 0) return null;

    // Sort descending by vote count
    tallies.sort((a, b) => b.count - a.count);

    const maxCount = tallies[0].count;
    const topPlans = tallies.filter(t => t.count === maxCount);

    if (topPlans.length === 1) {
      return topPlans[0].planId;
    }

    // In case of a tie: resolve by creator's pick
    const group = await groupRepository.findById(groupId);
    if (!group) return null;

    const creatorVote = await voteRepository.findByGroupAndUser(groupId, group.creatorId);
    if (creatorVote && topPlans.some(p => p.planId === creatorVote.planId)) {
      return creatorVote.planId;
    }

    // Default to the first tied plan
    return topPlans[0].planId;
  },
};

export type VotingService = typeof votingService;
