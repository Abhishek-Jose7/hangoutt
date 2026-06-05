import { groupRepository } from '../repositories/group.repository';
import { memberRepository } from '../repositories/member.repository';
import { budgetRepository } from '../repositories/budget.repository';
import { locationRepository } from '../repositories/location.repository';
import { planRepository, type PlanWithSlots } from '../repositories/plan.repository';
import { MOCK_PLANS } from '../utils/mockData';
import { InsufficientLocationsError, NotFoundError } from '../errors';

export const plannerService = {
  async generatePlan(groupId: string): Promise<{ success: boolean; plans: PlanWithSlots[] }> {
    // 1. Verify group exists
    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('The specified planning group does not exist.');
    }

    // 2. Fetch all members
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

    // 5. Generate plans (Phase 1 Foundation: map mock itineraries to group and persist to D1/SQLite)
    const randomUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    const savedPlansData = MOCK_PLANS.map((mockPlan, index) => {
      const planId = randomUUID();
      const dbPlan = {
        id: planId,
        groupId,
        planIndex: index + 1,
        name: mockPlan.name,
        tagline: mockPlan.tagline,
        totalEstimatedCostPerHead: mockPlan.totalEstimatedCostPerHead,
        totalDurationMinutes: mockPlan.totalDurationMinutes,
        generatedAt: new Date().toISOString(),
      };

      const dbSlots = mockPlan.slots.map(slot => ({
        id: randomUUID(),
        planId,
        slotOrder: slot.order,
        venueId: slot.venueId,
        venueName: slot.venueName,
        category: slot.category,
        arrivalTime: slot.arrivalTime,
        durationMinutes: slot.durationMinutes,
        travelToNextMinutes: slot.travelToNextMinutes,
        estimatedCostPerHead: slot.estimatedCostPerHead,
        note: slot.note,
      }));

      return { dbPlan, dbSlots };
    });

    const dbPlans = savedPlansData.map(s => s.dbPlan);
    const dbSlots = savedPlansData.flatMap(s => s.dbSlots);

    // Atomically save to the database (deleting previous plans for this group if they existed)
    await planRepository.deletePlansForGroup(groupId);
    await planRepository.savePlans(dbPlans, dbSlots);

    // Fetch and return the newly saved plans with their slots
    const persistedPlans = await planRepository.getPlansForGroup(groupId);

    return {
      success: true,
      plans: persistedPlans,
    };
  },
};

// Import validation error class
import { ValidationError } from '../errors';
export type PlannerService = typeof plannerService;
