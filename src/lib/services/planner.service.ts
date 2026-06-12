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
import { db, safeTransaction } from '../db/client';
import { users, groups, plans, planSlots, memberTravelMetrics } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { InsufficientLocationsError, NotFoundError, ValidationError, ForbiddenError } from '../errors';
import { ItineraryPromptContext } from '../types/planner.types';
import { validateStatusTransition } from './group.service';
import { getVenueImageUrl } from '../maps/places';

export const plannerService = {
  async generatePlan(userId: string, groupId: string): Promise<{ success: boolean; plans: PlanWithSlots[] }> {
    const { isHangoutApiConfigured, hangoutApi } = await import('../cloudflare/hangoutApi');
    if (isHangoutApiConfigured()) {
      const { getGroupDetailsAction } = await import('../../actions/groups');
      const detailsRes = await getGroupDetailsAction(groupId);
      if (!detailsRes.success) {
        throw new Error(detailsRes.error?.message || 'Failed to fetch group details');
      }

      const { group: groupData, members, budgetSummary, locations, currentUser } = detailsRes.data;
      if (currentUser.role !== 'ADMIN') {
        throw new ForbiddenError('Only the group admin can generate itineraries.');
      }

      if (!['COLLECTING_MEMBERS', 'COLLECTING_DETAILS', 'READY_TO_GENERATE', 'VOTING'].includes(groupData.status)) {
        throw new ValidationError(`Group is not in a state ready for itinerary generation (current status: ${groupData.status}).`);
      }

      // Force all members to be present
      const presentMembers = members;
      const presentUserIds = presentMembers.map((m: any) => m.userId);
      const presentLocations = locations.filter((loc: any) => presentUserIds.includes(loc.userId));

      if (presentLocations.length < 1) {
        presentLocations.push({
          userId: presentMembers[0]?.userId || 'default-user',
          lat: 19.0760,
          lng: 72.8777,
          locationName: 'Mumbai Centroid (Default)',
        });
      }

      const minBudget = budgetSummary.min || 1000;
      const avgBudget = budgetSummary.avg || 2000;
      const maxBudget = budgetSummary.max || 5000;

      // Calculate candidate zones based on present member coordinates
      const memberCoords = presentLocations.map((loc: any) => ({ lat: loc.lat, lng: loc.lng }));
      const candidateZones = selectCandidateZones(memberCoords);

      // Aggregate vibes
      const aggregatedVibes = new Set<string>();
      for (const m of presentMembers) {
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
      if (vibes.length === 0 && groupData.vibes) {
        try {
          const groupVibes = JSON.parse(groupData.vibes);
          if (Array.isArray(groupVibes)) {
            groupVibes.forEach(v => vibes.push(v));
          }
        } catch (_e) {}
      }

      // Fetch preferred activities from users in parallel
      const favoriteCategories: string[] = [];
      try {
        const userResponses = await Promise.all(
          presentMembers.map((m: any) =>
            hangoutApi<any>(`/users?clerkId=${m.clerkId}`).catch((err: any) => {
              console.error(`Error fetching user activities for ${m.clerkId}:`, err);
              return null;
            })
          )
        );
        for (const userRes of userResponses) {
          if (userRes && userRes.success && userRes.data?.favoriteActivities) {
            try {
              const acts = JSON.parse(userRes.data.favoriteActivities);
              if (Array.isArray(acts)) {
                favoriteCategories.push(...acts);
              }
            } catch (_e) {}
          }
        }
      } catch (err) {
        console.error('Error in parallel activities fetch:', err);
      }
      const uniquePreferredCategories = Array.from(new Set(favoriteCategories));
      const city = 'Mumbai';

      const dbPlans: any[] = [];
      const dbSlots: any[] = [];
      const dbMemberTravels: any[] = [];

      const randomUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return require('crypto').randomUUID();
      };

      // Generate itineraries for all candidate zones in parallel
      const zonePromises = candidateZones.map(async (zone, i) => {
        // Fetch venues and experiences near this zone
        const venues = await recommendationService.getRecommendedVenues(
          zone.lat,
          zone.lng,
          minBudget,
          avgBudget,
          uniquePreferredCategories as any[]
        );

        const experiences = await recommendationService.getRecommendedExperiences(
          city,
          zone.lat,
          zone.lng,
          groupData.groupType as any,
          vibes,
          maxBudget,
          uniquePreferredCategories,
          [] // empty history for worker API
        );

        // Build generator context
        const context: ItineraryPromptContext = {
          groupName: groupData.name,
          groupType: groupData.groupType as any,
          vibes,
          memberCount: presentMembers.length,
          groupMinBudget: minBudget,
          groupAvgBudget: avgBudget,
          groupMaxBudget: maxBudget,
          preferredCategories: uniquePreferredCategories,
          midpointAddress: zone.name,
          venues,
          experiences,
        };

        const groqResult = await generateItineraries(context);
        
        // Extract 1 itinerary for this candidate zone
        const itinerary = groqResult.itineraries[i % groqResult.itineraries.length];
        const planId = randomUUID();

        // Travel Analysis for every member to this zone
        const memberTravelsForPlan: any[] = [];
        const trainTimes: number[] = [];
        const cabTimes: number[] = [];
        const trainCosts: number[] = [];
        const cabCosts: number[] = [];

        for (const loc of presentLocations) {
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

        // Calculate aggregates
        const avgTrainTime = Math.round(trainTimes.reduce((sum, t) => sum + t, 0) / trainTimes.length);
        const avgCabTime = Math.round(cabTimes.reduce((sum, t) => sum + t, 0) / cabTimes.length);
        const avgTrainCost = Math.round(trainCosts.reduce((sum, c) => sum + c, 0) / trainCosts.length);
        const avgCabCost = Math.round(cabCosts.reduce((sum, c) => sum + c, 0) / cabCosts.length);
        const longestTravelTime = Math.max(...cabTimes);
        const shortestTravelTime = Math.min(...cabTimes);

        // Calculate Travel Fairness Score
        const variance = cabTimes.reduce((sum, t) => sum + Math.pow(t - avgCabTime, 2), 0) / cabTimes.length;
        const stdDev = Math.sqrt(variance);

        let travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30);
        if (longestTravelTime > 90 && avgCabTime < 30) {
          travelFairnessScore = Math.max(0.0, travelFairnessScore - 0.40);
        }

        // Scoring
        const experienceScore = 0.85;
        const travelScore = Math.max(0.0, 1.0 - (avgCabTime / 90));
        const budgetScore = 1.0 - (itinerary.totalEstimatedCostPerHead / maxBudget);
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

        const planObj = {
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
        };

        const slotsPromises = itinerary.slots.map(async (slot) => {
          let travelToNextCost = null;
          if (slot.travelToNextMinutes) {
            const distEst = slot.travelToNextMinutes / 3.0;
            const totalAutoCost = Math.round(30 + Math.max(0, distEst - 1.5) * 15);
            travelToNextCost = Math.ceil(totalAutoCost / Math.min(3, members.length));
          }

          // Prioritize fetching real place image from Ola Places API
          let img = await getVenueImageUrl(slot.name, city, slot.category);
          if (!img || img.includes('unsplash.com') || img.includes('placehold.co')) {
            if (slot.imageUrl && !slot.imageUrl.includes('unsplash.com')) {
              img = slot.imageUrl;
            }
          }

          let linkUrl = slot.link;
          if (!linkUrl) {
            linkUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(slot.name)}`;
          }

          return {
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
            travelToNextCost,
            imageUrl: img,
            link: linkUrl,
          };
        });

        const resolvedSlots = await Promise.all(slotsPromises);

        return {
          plan: planObj,
          slots: resolvedSlots,
          memberTravels: memberTravelsForPlan
        };
      });

      const zoneResults = await Promise.all(zonePromises);
      for (const res of zoneResults) {
        dbPlans.push(res.plan);
        dbSlots.push(...res.slots);
        dbMemberTravels.push(...res.memberTravels);
      }

      // Save to worker D1 database
      const saveRes = await hangoutApi<any>(`/groups/${groupId}/plans`, {
        method: 'POST',
        body: {
          plans: dbPlans,
          slots: dbSlots,
          memberTravels: dbMemberTravels,
        },
      });

      if (!saveRes.success) {
        throw new Error(saveRes.error?.message || 'Failed to save generated plans to D1');
      }

      // Re-fetch saved plans to return
      const savedPlans = await hangoutApi<any>(`/groups/${groupId}/plans`);
      return {
        success: true,
        plans: savedPlans.data,
      };
    }

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

    // 3. Verify group status is ready for generation
    if (!['COLLECTING_MEMBERS', 'COLLECTING_DETAILS', 'READY_TO_GENERATE', 'VOTING'].includes(group.status)) {
      throw new ValidationError(`Group is not in a state ready for itinerary generation (current status: ${group.status}).`);
    }

    // 4. Fetch members
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    if (members.length === 0) {
      throw new NotFoundError('No members found in this group.');
    }

    const presentMembers = members;
    const presentUserIds = presentMembers.map(m => m.userId);

    // 5. Check submitted locations (fallback to Mumbai centroid if none)
    const locations = await locationRepository.getGroupLocations(groupId);
    const presentLocations = locations.filter(l => presentUserIds.includes(l.userId));
    if (presentLocations.length < 1) {
      presentLocations.push({
        id: 'default-loc',
        groupId,
        userId: presentMembers[0]?.userId || 'default-user',
        lat: 19.0760,
        lng: 72.8777,
        locationName: 'Mumbai Centroid (Default)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    // 6. Fetch budgets list (fallback to default 2000 if none)
    const budgetsList = await budgetRepository.getGroupBudgets(groupId);
    const presentBudgetsList = budgetsList.filter(b => presentUserIds.includes(b.userId));
    const presentBudgets = presentBudgetsList.map(b => b.maxBudget);
    
    if (presentBudgets.length === 0) {
      presentBudgets.push(2000);
    }

    const presentBudgetSummary = {
      min: Math.min(...presentBudgets),
      avg: Math.round(presentBudgets.reduce((sum, b) => sum + b, 0) / presentBudgets.length),
      max: Math.max(...presentBudgets),
      submittedCount: presentBudgets.length,
      totalMembers: presentMembers.length,
    };

    // Set group status to GENERATING
    validateStatusTransition(group.status, 'GENERATING');
    await groupRepository.update(groupId, {
      status: 'GENERATING',
    });

    try {
      // 7. Calculate 3-4 candidate meetup zones based on member coordinates
      const memberCoords = presentLocations.map(loc => ({ lat: loc.lat, lng: loc.lng }));
      const candidateZones = selectCandidateZones(memberCoords);

      // 8. Gather preferences and vibes
      const favoriteCategories: string[] = [];
      try {
        const userResults = await Promise.all(presentMembers.map(m => dbSelectUserActivities(m.userId)));
        for (const user of userResults) {
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
      } catch (err) {
        console.error('Error fetching user activities in parallel:', err);
      }
      const uniquePreferredCategories = Array.from(new Set(favoriteCategories));

      // Collect vibes
      const aggregatedVibes = new Set<string>();
      for (const m of presentMembers) {
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

      const firstMemberId = presentMembers[0].userId;
      const historyEntries = await historyRepository.getHistoryForUser(firstMemberId);
      const city = 'Mumbai';

      const dbPlans: any[] = [];
      const dbSlots: any[] = [];
      const dbMemberTravels: any[] = [];

      const randomUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return require('crypto').randomUUID();
      };

      // 9. Generate itineraries for all candidate zones in parallel
      const zonePromises = candidateZones.map(async (zone, i) => {
        // Fetch venues and experiences near this zone
        const venues = await recommendationService.getRecommendedVenues(
          zone.lat,
          zone.lng,
          presentBudgetSummary.min,
          presentBudgetSummary.avg,
          uniquePreferredCategories as any[]
        );

        const experiences = await recommendationService.getRecommendedExperiences(
          city,
          zone.lat,
          zone.lng,
          group.groupType as any,
          vibes,
          presentBudgetSummary.max,
          uniquePreferredCategories,
          historyEntries
        );

        // Build generator context
        const context: ItineraryPromptContext = {
          groupName: group.name,
          groupType: group.groupType as any,
          vibes,
          memberCount: presentMembers.length,
          groupMinBudget: presentBudgetSummary.min,
          groupAvgBudget: presentBudgetSummary.avg,
          groupMaxBudget: presentBudgetSummary.max,
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

        for (const loc of presentLocations) {
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
        const budgetScore = 1.0 - (itinerary.totalEstimatedCostPerHead / presentBudgetSummary.max);
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

        const planObj = {
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
        };

        const slotsPromises = itinerary.slots.map(async (slot) => {
          let travelToNextCost = null;
          if (slot.travelToNextMinutes) {
            const distEst = slot.travelToNextMinutes / 3.0;
            const totalAutoCost = Math.round(30 + Math.max(0, distEst - 1.5) * 15);
            travelToNextCost = Math.ceil(totalAutoCost / Math.min(3, members.length));
          }

          // Prioritize fetching real place image from Ola Places API
          let img = await getVenueImageUrl(slot.name, city, slot.category);
          if (!img || img.includes('unsplash.com') || img.includes('placehold.co')) {
            if (slot.imageUrl && !slot.imageUrl.includes('unsplash.com')) {
              img = slot.imageUrl;
            }
          }

          let linkUrl = slot.link;
          if (!linkUrl) {
            linkUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(slot.name)}`;
          }

          return {
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
            travelToNextCost,
            imageUrl: img,
            link: linkUrl,
          };
        });

        const resolvedSlots = await Promise.all(slotsPromises);

        return {
          plan: planObj,
          slots: resolvedSlots,
          memberTravels: memberTravelsForPlan
        };
      });

      const zoneResults = await Promise.all(zonePromises);
      for (const res of zoneResults) {
        dbPlans.push(res.plan);
        dbSlots.push(...res.slots);
        dbMemberTravels.push(...res.memberTravels);
      }

      // 12. Transactional Release: delete old plans, write new ones, set status to VOTING
      validateStatusTransition('GENERATING', 'VOTING');
      
      await safeTransaction(async (tx: any) => {
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
            timerExpiresAt: null,
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
