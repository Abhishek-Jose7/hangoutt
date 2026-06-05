import 'server-only';
import { groupRepository } from '../repositories/group.repository';
import { memberRepository } from '../repositories/member.repository';
import { budgetRepository } from '../repositories/budget.repository';
import { locationRepository } from '../repositories/location.repository';
import { planRepository, type PlanWithSlots } from '../repositories/plan.repository';
import { historyRepository } from '../repositories/history.repository';
import { recommendationService } from './recommendation.service';
import { generateItineraries } from '../groq/itineraryService';
import { calculateMidpoint } from '../algorithms/midpoint';
import { reverseGeocode } from '../maps/geocoding';
import { InsufficientLocationsError, NotFoundError, ValidationError } from '../errors';
import { ItineraryPromptContext } from '../types/planner.types';

export const plannerService = {
  async generatePlan(groupId: string): Promise<{ success: boolean; plans: PlanWithSlots[] }> {
    // 1. Verify group exists
    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('The specified planning group does not exist.');
    }

    // 2. Fetch members
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    if (members.length === 0) {
      throw new NotFoundError('No members found in this group.');
    }

    // 3. Check submitted locations (minimum 2 locations required)
    const locations = await locationRepository.getGroupLocations(groupId);
    if (locations.length < 2) {
      throw new InsufficientLocationsError(`Fewer than 2 locations submitted. Currently submitted: ${locations.length}.`);
    }

    // 4. Fetch budget aggregates
    const budgetSummary = await budgetRepository.getGroupBudgetSummary(groupId);
    if (budgetSummary.submittedCount === 0) {
      throw new ValidationError('No member budgets have been submitted yet.');
    }

    // 5. Calculate midpoint
    const midpoint = calculateMidpoint(locations.map(loc => ({ lat: loc.lat, lng: loc.lng })));
    const address = await reverseGeocode(midpoint.lat, midpoint.lng);

    // 6. Gather preferences from member profiles
    // Aggregate favorite activities
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
          // Fallback to comma separated
          const acts = user.favoriteActivities.split(',').map((s: string) => s.trim());
          favoriteCategories.push(...acts);
        }
      }
    }
    const uniquePreferredCategories = Array.from(new Set(favoriteCategories));

    // Parse vibes from group record
    const vibes: string[] = group.vibes ? JSON.parse(group.vibes) : [];

    // Fetch user history for experience freshness checks
    const firstMemberId = members[0].userId;
    const history = await historyRepository.getHistoryForUser(firstMemberId);

    // 7. Venue shortlist (distance-scored & budget-constrained)
    const venues = await recommendationService.getRecommendedVenues(
      midpoint.lat,
      midpoint.lng,
      budgetSummary.min,
      budgetSummary.avg,
      uniquePreferredCategories as any[]
    );

    // 8. Experience shortlist
    const experiences = await recommendationService.getRecommendedExperiences(
      'Bengaluru', // Defaulting to Bengaluru for local activities
      midpoint.lat,
      midpoint.lng,
      group.groupType as any,
      vibes,
      budgetSummary.max,
      uniquePreferredCategories,
      history
    );

    // 9. Groq Itinerary Generation
    const context: ItineraryPromptContext = {
      groupName: group.name,
      groupType: group.groupType as any,
      vibes,
      memberCount: members.length,
      groupMinBudget: budgetSummary.min,
      groupAvgBudget: budgetSummary.avg,
      groupMaxBudget: budgetSummary.max,
      preferredCategories: uniquePreferredCategories,
      midpointAddress: address,
      venues,
      experiences,
    };

    const groqResult = await generateItineraries(context);

    // 10. Persist generated plans and slots atomically
    const randomUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    const dbPlans: any[] = [];
    const dbSlots: any[] = [];

    groqResult.itineraries.forEach((itinerary, index) => {
      const planId = randomUUID();
      dbPlans.push({
        id: planId,
        groupId,
        planIndex: index + 1,
        name: itinerary.name,
        tagline: itinerary.tagline,
        budgetTier: itinerary.budgetTier,
        totalEstimatedCostPerHead: itinerary.totalEstimatedCostPerHead,
        totalDurationMinutes: itinerary.totalDurationMinutes,
        generatedAt: new Date().toISOString(),
      });

      itinerary.slots.forEach(slot => {
        dbSlots.push({
          id: randomUUID(),
          planId,
          slotOrder: slot.order,
          venueId: slot.venueId || null,
          experienceId: slot.experienceId || null,
          venueName: slot.name, // Deprecated, kept populated for compatibility
          name: slot.name,
          category: slot.category,
          arrivalTime: slot.arrivalTime,
          durationMinutes: slot.durationMinutes,
          travelToNextMinutes: slot.travelToNextMinutes || null,
          estimatedCostPerHead: slot.estimatedCostPerHead,
          note: slot.note,
        });
      });
    });

    // Write transaction (deleting previous plans first)
    await planRepository.deletePlansForGroup(groupId);
    await planRepository.savePlans(dbPlans, dbSlots);

    // Automatically set group voting session status to OPEN
    await groupRepository.update(groupId, {
      votingStatus: 'OPEN',
    });

    // Retrieve and return saved plans
    const persistedPlans = await planRepository.getPlansForGroup(groupId);

    return {
      success: true,
      plans: persistedPlans,
    };
  },
};

// Internal DB helper to read user profile activities (avoiding circular dependency)
import { db } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
async function dbSelectUserActivities(userId: string) {
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}

export type PlannerService = typeof plannerService;
