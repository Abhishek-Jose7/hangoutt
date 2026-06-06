import 'server-only';
import { groupRepository } from '../repositories/group.repository';
import { memberRepository } from '../repositories/member.repository';
import { budgetRepository } from '../repositories/budget.repository';
import { locationRepository } from '../repositories/location.repository';
import { planRepository, type PlanWithSlots } from '../repositories/plan.repository';
import { historyRepository } from '../repositories/history.repository';
import { recommendationService } from './recommendation.service';
import { generateItineraries } from '../groq/itineraryService';
import { selectCandidateZones, getHaversineDistance } from '../algorithms/zoneSelection';
import { db } from '../db/client';
import { users, groups, plans, planSlots, memberTravelMetrics } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { InsufficientLocationsError, NotFoundError, ValidationError, ForbiddenError } from '../errors';
import { ItineraryPromptContext } from '../types/planner.types';
import { validateStatusTransition } from './group.service';

export const plannerService = {
  async generatePlan(userId: string, groupId: string): Promise<{ success: boolean; plans: PlanWithSlots[] }> {
    // 1. Verify group exists
    const group = await groupRepository.findById(groupId);
    if (!group || group.status === 'DELETED') {
      throw new NotFoundError('The specified planning group does not exist.');
    }

    // 2. Verify caller is ADMIN
    const callerMember = await memberRepository.getMember(groupId, userId);
    if (!callerMember || callerMember.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can generate itineraries.');
    }

    // 3. Verify group status is READY_TO_GENERATE
    if (group.status !== 'READY_TO_GENERATE') {
      throw new ValidationError(`Group is not in a state ready for itinerary generation (current status: ${group.status}).`);
    }

    // 4. Fetch members
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    if (members.length === 0) {
      throw new NotFoundError('No members found in this group.');
    }

    // 5. Check submitted locations (minimum 2 locations required)
    const locations = await locationRepository.getGroupLocations(groupId);
    if (locations.length < 2) {
      throw new InsufficientLocationsError(`Fewer than 2 locations submitted. Currently submitted: ${locations.length}.`);
    }

    // 6. Fetch budgets list and check if everyone has submitted
    const budgetsList = await budgetRepository.getGroupBudgets(groupId);
    const budgetSummary = await budgetRepository.getGroupBudgetSummary(groupId);
    if (budgetSummary.submittedCount === 0) {
      throw new ValidationError('No member budgets have been submitted yet.');
    }

    const allSubmitted = members.every(member => {
      const hasBudget = budgetsList.some(b => b.userId === member.userId);
      const hasLocation = locations.some(l => l.userId === member.userId);
      return hasBudget && hasLocation;
    });

    if (!allSubmitted) {
      throw new ValidationError('Not all group members have submitted their budget and location details.');
    }

    // Set group status to GENERATING
    validateStatusTransition(group.status, 'GENERATING');
    await groupRepository.update(groupId, {
      status: 'GENERATING',
    });

    try {
      // 7. Calculate 3-4 candidate meetup zones based on member coordinates
      const memberCoords = locations.map(loc => ({ lat: loc.lat, lng: loc.lng }));
      const candidateZones = selectCandidateZones(memberCoords);

      // 8. Gather preferences and vibes
      const favoriteCategories: string[] = [];
      for (const m of members) {
        const user = await dbSelectUserActivities(m.userId);
        if (user && user.favoriteActivities) {
          try {
            const acts = JSON.parse(user.favoriteActivities);
            if (Array.isArray(acts)) {
              favoriteCategories.push(...acts);
            }
          } catch (_e) {
            const acts = user.favoriteActivities.split(',').map((s: string) => s.trim());
            favoriteCategories.push(...acts);
          }
        }
      }
      const uniquePreferredCategories = Array.from(new Set(favoriteCategories));

      // Collect vibes
      const aggregatedVibes = new Set<string>();
      for (const m of members) {
        if (m.vibes) {
          try {
            const memberVibes = JSON.parse(m.vibes);
            if (Array.isArray(memberVibes)) {
              memberVibes.forEach(v => aggregatedVibes.add(v));
            }
          } catch (_e) {}
        }
      }
      const vibes = Array.from(aggregatedVibes);
      if (vibes.length === 0 && group.vibes) {
        try {
          const groupVibes = JSON.parse(group.vibes);
          if (Array.isArray(groupVibes)) {
            groupVibes.forEach(v => vibes.push(v));
          }
        } catch (_e) {}
      }

      const firstMemberId = members[0].userId;
      const historyEntries = await historyRepository.getHistoryForUser(firstMemberId);
      const city = locations[0].lat > 16.0 ? 'Mumbai' : 'Bengaluru';

      const dbPlans: any[] = [];
      const dbSlots: any[] = [];
      const dbMemberTravels: any[] = [];

      const randomUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return require('crypto').randomUUID();
      };

      // 9. Generate one itinerary per candidate zone
      for (let i = 0; i < candidateZones.length; i++) {
        const zone = candidateZones[i];
        
        // Fetch venues and experiences near this zone
        const venues = await recommendationService.getRecommendedVenues(
          zone.lat,
          zone.lng,
          budgetSummary.min,
          budgetSummary.avg,
          uniquePreferredCategories as any[]
        );

        const experiences = await recommendationService.getRecommendedExperiences(
          city,
          zone.lat,
          zone.lng,
          group.groupType as any,
          vibes,
          budgetSummary.max,
          uniquePreferredCategories,
          historyEntries
        );

        // Build generator context
        const context: ItineraryPromptContext = {
          groupName: group.name,
          groupType: group.groupType as any,
          vibes,
          memberCount: members.length,
          groupMinBudget: budgetSummary.min,
          groupAvgBudget: budgetSummary.avg,
          groupMaxBudget: budgetSummary.max,
          preferredCategories: uniquePreferredCategories,
          midpointAddress: zone.name,
          venues,
          experiences,
        };

        const groqResult = await generateItineraries(context);
        
        // Extract 1 itinerary for this candidate zone (loop index wraps if fewer generated)
        const itinerary = groqResult.itineraries[i % groqResult.itineraries.length];
        const planId = randomUUID();

        // 10. Travel Analysis for every member to this zone
        const memberTravelsForPlan: any[] = [];
        const trainTimes: number[] = [];
        const cabTimes: number[] = [];
        const trainCosts: number[] = [];
        const cabCosts: number[] = [];

        for (const loc of locations) {
          const dist = getHaversineDistance({ lat: loc.lat, lng: loc.lng }, { lat: zone.lat, lng: zone.lng });
          
          const trainTime = Math.round(dist * 2.5) + 10;
          const trainCost = dist < 5 ? 10 : dist < 15 ? 15 : dist < 30 ? 20 : 30;
          const cabTime = Math.round(dist * 3.0) + 5;
          const cabCost = Math.round(150 + dist * 15);
          const walkTime = Math.round(dist * 12.0);

          trainTimes.push(trainTime);
          cabTimes.push(cabTime);
          trainCosts.push(trainCost);
          cabCosts.push(cabCost);

          memberTravelsForPlan.push({
            id: randomUUID(),
            planId,
            userId: loc.userId,
            trainTime,
            trainCost,
            cabTime,
            cabCost,
            walkTime,
          });
        }

        dbMemberTravels.push(...memberTravelsForPlan);

        // Calculate aggregates
        const avgTrainTime = Math.round(trainTimes.reduce((sum, t) => sum + t, 0) / trainTimes.length);
        const avgCabTime = Math.round(cabTimes.reduce((sum, t) => sum + t, 0) / cabTimes.length);
        const avgTrainCost = Math.round(trainCosts.reduce((sum, c) => sum + c, 0) / trainCosts.length);
        const avgCabCost = Math.round(cabCosts.reduce((sum, c) => sum + c, 0) / cabCosts.length);
        const longestTravelTime = Math.max(...cabTimes);
        const shortestTravelTime = Math.min(...cabTimes);

        // Calculate Travel Fairness Score (penalizing high standard deviation)
        const variance = cabTimes.reduce((sum, t) => sum + Math.pow(t - avgCabTime, 2), 0) / cabTimes.length;
        const stdDev = Math.sqrt(variance);

        let travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30);
        
        // Disadvantage penalty: if any member travels >90 minutes while average is <30 mins
        if (longestTravelTime > 90 && avgCabTime < 30) {
          travelFairnessScore = Math.max(0.0, travelFairnessScore - 0.40);
        }

        // 11. Multi-factor Plan Scoring
        const experienceScore = 0.85; // proxy rating
        const travelScore = Math.max(0.0, 1.0 - (avgCabTime / 90));
        const budgetScore = 1.0 - (itinerary.totalEstimatedCostPerHead / budgetSummary.max);
        const popularityScore = 0.90;
        const groupTypeMatchScore = 1.0;
        const vibeMatchScore = 1.0;
        
        const compositeScore = Number(
          (
            experienceScore * 0.20 +
            travelScore * 0.20 +
            budgetScore * 0.20 +
            travelFairnessScore * 0.20 +
            vibeMatchScore * 0.20
          ).toFixed(2)
        );

        dbPlans.push({
          id: planId,
          groupId,
          planIndex: i + 1,
          name: itinerary.name,
          tagline: itinerary.tagline,
          meetupZone: zone.name,
          budgetTier: itinerary.budgetTier,
          totalEstimatedCostPerHead: itinerary.totalEstimatedCostPerHead,
          totalDurationMinutes: itinerary.totalDurationMinutes,
          score: compositeScore,
          
          experienceScore,
          travelScore,
          budgetScore,
          fairnessScore: travelFairnessScore,
          popularityScore,
          groupTypeMatchScore,
          vibeMatchScore,
          compositeScore,

          avgTrainTime,
          avgCabTime,
          avgTrainCost,
          avgCabCost,
          longestTravelTime,
          shortestTravelTime,
          travelFairnessScore,
          generatedAt: new Date().toISOString(),
        });

        itinerary.slots.forEach(slot => {
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: slot.order,
            venueId: slot.venueId || null,
            experienceId: slot.experienceId || null,
            venueName: slot.name,
            name: slot.name,
            category: slot.category,
            arrivalTime: slot.arrivalTime,
            durationMinutes: slot.durationMinutes,
            travelToNextMinutes: slot.travelToNextMinutes || null,
            estimatedCostPerHead: slot.estimatedCostPerHead,
            note: slot.note,
          });
        });
      }

      // 12. Transactional Release: delete old plans, write new ones, set status to VOTING
      validateStatusTransition('GENERATING', 'VOTING');
      
      await db.transaction(async (tx: any) => {
        // Delete old member travel metrics first
        const persistedPlans = await tx.select().from(plans).where(eq(plans.groupId, groupId));
        if (persistedPlans.length > 0) {
          const planIds = persistedPlans.map((p: any) => p.id);
          await tx
            .delete(memberTravelMetrics)
            .where(sql`plan_id IN (${sql.join(planIds.map((id: any) => sql`${id}`), sql`, `)})`);
        }
        await tx.delete(plans).where(eq(plans.groupId, groupId));

        if (dbPlans.length > 0) {
          await tx.insert(plans).values(dbPlans);
        }
        if (dbSlots.length > 0) {
          await tx.insert(planSlots).values(dbSlots);
        }
        if (dbMemberTravels.length > 0) {
          await tx.insert(memberTravelMetrics).values(dbMemberTravels);
        }
        
        await tx
          .update(groups)
          .set({
            status: 'VOTING',
            votingStatus: 'OPEN',
            updatedAt: new Date().toISOString(),
          })
          .where(eq(groups.id, groupId));
      });

      const persistedPlans = await planRepository.getPlansForGroup(groupId);

      return {
        success: true,
        plans: persistedPlans,
      };
    } catch (err) {
      await groupRepository.update(groupId, {
        status: 'READY_TO_GENERATE',
      });
      throw err;
    }
  },
};

async function dbSelectUserActivities(userId: string) {
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}
