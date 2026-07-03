'use server';

import { apiResponse } from '@/lib/utils/apiResponse';
import { createGroupSchema, updateGroupSchema } from '@/lib/validators/group.schema';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';
import { getCurrentApiUser, hangoutApi, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export async function createGroup(rawInput: unknown): ActionResponse<any> {
  try {
    const parsed = createGroupSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Invalid group inputs', parsed.error.flatten());
    }

    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const response = await hangoutApi<any>('/groups', {
        method: 'POST',
        body: {
          user,
          group: parsed.data,
        },
      });

      return response;
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    const newGroup = await groupService.createGroup(user.id, parsed.data as any);

    revalidatePath('/groups');
    return apiResponse.success(newGroup);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateGroup(rawInput: unknown): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Group updates are not available through the D1 Worker API yet.');
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const parsed = updateGroupSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupService } = await import('@/lib/services/group.service');
    const { groupId, ...fields } = parsed.data;
    const updated = await groupService.updateGroup(user.id, groupId, fields);

    revalidatePath(`/groups/${groupId}`);
    revalidatePath('/groups');
    return apiResponse.success(updated);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function deleteGroup(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Deleting groups is not available through the D1 Worker API yet.');
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    await groupService.deleteGroup(user.id, groupId);

    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function archiveGroup(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Archiving groups is not available through the D1 Worker API yet.');
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    await groupService.archiveGroup(user.id, groupId);

    revalidatePath(`/groups/${groupId}`);
    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function getUserGroupsAction(): ActionResponse<any[]> {
  try {
    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      return hangoutApi<any>(`/groups?clerkId=${encodeURIComponent(user.clerkId)}`);
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const { groupRepository } = await import('@/lib/repositories/group.repository');
    const groupsList = await groupRepository.getUserGroups(user.id);

    const groupsWithDetails = await Promise.all(
      groupsList.map(async (g) => {
        const details = await groupRepository.getGroupWithMemberCount(g.id);
        return details || { ...g, memberCount: 1 };
      })
    );

    return apiResponse.success(groupsWithDetails);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function getUserHistoryAction(): ActionResponse<any[]> {
  try {
    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const response = await hangoutApi<any>(`/users/history?clerkId=${encodeURIComponent(user.clerkId)}`);
      if (!response.success) {
        // Worker may not expose this endpoint yet; return empty rather than throw
        console.warn('[getUserHistoryAction] D1 history endpoint unavailable:', response.error?.message);
        return apiResponse.success([]);
      }
      return apiResponse.success(response.data ?? []);
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const { historyRepository } = await import('@/lib/repositories/history.repository');
    const historyList = await historyRepository.getHistoryForUser(user.id);
    return apiResponse.success(historyList);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function getGroupDetailsAction(groupId: string): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      return hangoutApi<any>(`/groups/${groupId}?clerkId=${encodeURIComponent(user.clerkId)}`);
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    const { memberRepository } = await import('@/lib/repositories/member.repository');
    const { budgetRepository } = await import('@/lib/repositories/budget.repository');
    const { locationRepository } = await import('@/lib/repositories/location.repository');

    const group = await groupService.getGroupDetails(user.id, groupId);
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    
    // Force all members to be present for the outing
    members.forEach((m) => {
      m.isPresent = 1;
    });

    const presentMembers = members;
    const presentUserIds = presentMembers.map(m => m.userId);

    const budgets = await budgetRepository.getGroupBudgets(groupId);
    const presentBudgetsList = budgets.filter(b => presentUserIds.includes(b.userId));

    const cleanMembers = members.map((m) => {
      const budgetRec = presentBudgetsList.find((b) => b.userId === m.userId);
      return {
        ...m,
        budget: budgetRec ? budgetRec.maxBudget : null
      };
    });

    const presentBudgets = presentBudgetsList.map(b => b.maxBudget);
    const budgetSummary = {
      min: presentBudgets.length > 0 ? Math.min(...presentBudgets) : 0,
      avg: presentBudgets.length > 0 ? Math.round(presentBudgets.reduce((sum, b) => sum + b, 0) / presentBudgets.length) : 0,
      max: presentBudgets.length > 0 ? Math.max(...presentBudgets) : 0,
      total: presentBudgets.length > 0 ? presentBudgets.reduce((sum, b) => sum + b, 0) : 0,
      submittedCount: presentBudgetsList.length,
      totalMembers: presentMembers.length,
    };

    const userBudgetRecord = budgets.find((b) => b.userId === user.id);
    const currentUserBudget = userBudgetRecord?.maxBudget || null;
    const currentUserTravelIncluded = userBudgetRecord ? userBudgetRecord.travelIncluded === 1 : true;
    const locations = await locationRepository.getGroupLocations(groupId);
    const presentLocations = locations.filter(l => presentUserIds.includes(l.userId));
    const currentUserLocation = locations.find((l) => l.userId === user.id) || null;
    const callerMember = members.find((m) => m.userId === user.id);
    const callerRole = callerMember ? callerMember.role : 'MEMBER';
    const isReady = await groupService.checkGroupReadiness(groupId);
    const isAdmin = callerRole === 'ADMIN';
    const cleanLocations = presentLocations.map((l) => {
      const member = members.find((m) => m.userId === l.userId);
      return {
        name: member ? member.name : 'Participant',
        locationName: l.locationName || `${l.lat.toFixed(2)}, ${l.lng.toFixed(2)}`,
        lat: isAdmin || l.userId === user.id ? l.lat : 0,
        lng: isAdmin || l.userId === user.id ? l.lng : 0,
        userId: l.userId,
      };
    });

    return apiResponse.success({
      group: {
        ...group,
        isReady,
      },
      members: cleanMembers,
      budgetSummary,
      submittedBudgetUserIds: presentBudgetsList.map((b) => b.userId),
      locations: cleanLocations,
      currentUser: {
        id: user.id,
        role: callerRole,
        budget: currentUserBudget,
        travelIncluded: currentUserTravelIncluded,
        location: currentUserLocation,
      },
    });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function startDetailsCollectionAction(groupId: string): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const updated = await hangoutApi<any>(`/groups/${groupId}/start-details`, {
        method: 'PATCH',
        body: { clerkId: user.clerkId },
      });

      revalidatePath(`/groups/${groupId}`);
      return updated;
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    const updated = await groupService.startDetailsCollection(user.id, groupId);
    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(updated);
  } catch (err) {
    return apiResponse.error(err);
  }
}
