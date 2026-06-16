import { voteRepository } from '../repositories/vote.repository';
import { memberRepository } from '../repositories/member.repository';
import { groupRepository } from '../repositories/group.repository';
import { planRepository } from '../repositories/plan.repository';
import { createVoteSchema } from '../validators/vote.schema';
import { ForbiddenError, ValidationError, NotFoundError, VoteClosedError } from '../errors';
import { db, safeTransaction } from '../db/client';
import { groups, history } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { validateStatusTransition } from './group.service';

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

    if (group.status !== 'VOTING' || group.votingStatus !== 'OPEN') {
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
    const result = await voteRepository.upsertVote({
      id: uuid(),
      groupId,
      userId,
      planId,
    });

    // Increment timesVoted locally for the places
    try {
      if (plan && plan.slots) {
        for (const slot of plan.slots) {
          if (slot.venueId && !slot.venueId.startsWith('fallback_')) {
            await db.run(sql`
              INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
              VALUES (${slot.venueId}, 0, 0, 1, 0)
              ON CONFLICT(place_id)
              DO UPDATE SET times_voted = times_voted + 1
            `);
          }
        }
      }
    } catch (err) {
      console.error('Failed to increment local timesVoted:', err);
    }

    // 6. Check if all active members have voted. If so, automatically finalize voting.
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    const tallies = await voteRepository.countVotes(groupId);
    const totalVotes = tallies.reduce((sum, t) => sum + t.count, 0);

    if (totalVotes >= members.length) {
      await this.finalizeVoting(userId, groupId, false);
    }

    return result;
  },

  async tallyVotes(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not a member of this planning group.');
    }

    return voteRepository.countVotes(groupId);
  },

  async closeVoting(userId: string, groupId: string) {
    // Manually close voting (delegates to finalizeVoting as admin-triggered)
    await this.finalizeVoting(userId, groupId, true);
  },

  async finalizeVoting(userId: string, groupId: string, isManualClose = false) {
    const group = await groupRepository.findById(groupId);
    if (!group || group.status === 'DELETED') {
      throw new NotFoundError('Group not found.');
    }

    if (group.status !== 'VOTING') {
      throw new ValidationError('Group is not in VOTING state.');
    }

    // 1. If it's a manual close, verify caller is ADMIN
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    if (isManualClose) {
      const caller = members.find(m => m.userId === userId);
      if (!caller || caller.role !== 'ADMIN') {
        throw new ForbiddenError('Only the group admin can manually finalize voting.');
      }
    }

    // 2. Determine winner using tie-breaking logic
    const winnerPlanId = await this.determineWinner(groupId, members);
    if (!winnerPlanId) {
      throw new ValidationError('Could not determine a winning plan (no plans exist).');
    }

    validateStatusTransition(group.status, 'COMPLETED');

    // 3. Save winning plan details and transition group state to COMPLETED inside a transaction
    await safeTransaction(async (tx: any) => {
      // Update group status to COMPLETED, voting status to CLOSED, and record winningPlanId
      await tx
        .update(groups)
        .set({
          status: 'COMPLETED',
          votingStatus: 'CLOSED',
          winningPlanId: winnerPlanId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(groups.id, groupId));

      // Fetch plan details and log to history
      const plan = await planRepository.getPlanWithSlots(winnerPlanId);
      if (plan) {
        const slots = plan.slots;
        const participants = members.map(m => ({ userId: m.userId, name: m.name, email: m.email }));
        const uuid = () => {
          if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
          }
          return require('crypto').randomUUID();
        };

        await tx.insert(history).values({
          id: uuid(),
          groupId,
          planId: winnerPlanId,
          outingDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
          groupName: group.name,
          planName: plan.name,
          planTagline: plan.tagline,
          venuesJson: JSON.stringify(slots.map(s => ({
            name: s.name,
            category: s.category,
            arrivalTime: s.arrivalTime,
            durationMinutes: s.durationMinutes,
            estimatedCostPerHead: s.estimatedCostPerHead,
            note: s.note,
          }))),
          participantsJson: JSON.stringify(participants),
          totalCostPerHead: plan.totalEstimatedCostPerHead,
          winningCategories: JSON.stringify(slots.map(s => s.category)),
          winningBudgetTier: plan.budgetTier,
          winningActivities: JSON.stringify(slots.map(s => s.name)),
        });

        // Increment timesWon locally for the places
        for (const slot of slots) {
          if (slot.venueId && !slot.venueId.startsWith('fallback_')) {
            await tx.run(sql`
              INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
              VALUES (${slot.venueId}, 0, 0, 0, 1)
              ON CONFLICT(place_id)
              DO UPDATE SET times_won = times_won + 1
            `);
          }
        }
      }
    });
  },

  async determineWinner(groupId: string, members: any[]): Promise<string | null> {
    const tallies = await voteRepository.countVotes(groupId);
    if (tallies.length === 0) {
      // If no votes have been cast, pick the first generated plan as the fallback
      const plansList = await planRepository.getPlansForGroup(groupId);
      return plansList[0]?.id || null;
    }

    // Sort descending by vote count
    tallies.sort((a, b) => b.count - a.count);

    const maxCount = tallies[0].count;
    const topTallies = tallies.filter(t => t.count === maxCount);

    if (topTallies.length === 1) {
      return topTallies[0].planId;
    }

    // TIE-BREAKING ALGORITHM
    // 1. Most recent vote timestamp: compare the latest vote timestamp for each tied plan (most recent wins)
    const allVotes = await voteRepository.getVotesForGroup(groupId);
    
    const planLatestTimestamps = topTallies.map(tally => {
      const planVotes = allVotes.filter(v => v.planId === tally.planId);
      const latestVote = planVotes.reduce((latest, current) => {
        return new Date(current.updatedAt) > new Date(latest.updatedAt) ? current : latest;
      }, planVotes[0]);
      return {
        planId: tally.planId,
        latestTimestamp: latestVote ? new Date(latestVote.updatedAt).getTime() : 0,
      };
    });

    planLatestTimestamps.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
    
    const maxTimestamp = planLatestTimestamps[0].latestTimestamp;
    const tiedByTimestamp = planLatestTimestamps.filter(p => p.latestTimestamp === maxTimestamp);

    if (tiedByTimestamp.length === 1) {
      return tiedByTimestamp[0].planId;
    }

    // 2. Itinerary Score: if still tied, compare itinerary score column
    const plansWithSlots = await planRepository.getPlansForGroup(groupId);
    const planScores = tiedByTimestamp.map(item => {
      const plan = plansWithSlots.find(p => p.id === item.planId);
      return {
        planId: item.planId,
        score: plan ? plan.score : 0,
      };
    });

    planScores.sort((a, b) => b.score - a.score);

    const maxScore = planScores[0].score;
    const tiedByScore = planScores.filter(p => p.score === maxScore);

    if (tiedByScore.length === 1) {
      return tiedByScore[0].planId;
    }

    // 3. Random deterministic seed: deterministic hash of plan ID
    const stringHash = (str: string) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash);
    };

    const hashTied = tiedByScore.map(item => ({
      planId: item.planId,
      hashValue: stringHash(item.planId),
    }));

    hashTied.sort((a, b) => a.hashValue - b.hashValue);

    return hashTied[0].planId;
  },
};

export type VotingService = typeof votingService;
