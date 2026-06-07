'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { apiResponse } from '@/lib/utils/apiResponse';
import { createGroupSchema, updateGroupSchema } from '@/lib/validators/group.schema';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';
import { getCurrentApiUser, hangoutApi, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export async function createGroup(rawInput: unknown): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      const parsed = createGroupSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new ValidationError('Invalid group inputs', parsed.error.flatten());
      }

      const user = await getCurrentApiUser();
      const response = await hangoutApi<any>('/groups', {
        method: 'POST',
        body: {
          user,
          group: parsed.data,
        },
      });

      revalidatePath('/groups');
      return response;
    }

    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    const newGroup = await groupService.createGroup(user.id, rawInput as any);

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
      return apiResponse.success([]);
    }

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

    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    const { memberRepository } = await import('@/lib/repositories/member.repository');
    const { budgetRepository } = await import('@/lib/repositories/budget.repository');
    const { locationRepository } = await import('@/lib/repositories/location.repository');

    const group = await groupService.getGroupDetails(user.id, groupId);
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    const budgetSummary = await budgetRepository.getGroupBudgetSummary(groupId);
    const budgets = await budgetRepository.getGroupBudgets(groupId);
    const currentUserBudget = budgets.find((b) => b.userId === user.id)?.maxBudget || null;
    const locations = await locationRepository.getGroupLocations(groupId);
    const currentUserLocation = locations.find((l) => l.userId === user.id) || null;
    const callerMember = members.find((m) => m.userId === user.id);
    const callerRole = callerMember ? callerMember.role : 'MEMBER';
    const isReady = await groupService.checkGroupReadiness(groupId);
    const isAdmin = callerRole === 'ADMIN';
    const cleanLocations = locations.map((l) => {
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
      members,
      budgetSummary,
      submittedBudgetUserIds: budgets.map((b) => b.userId),
      locations: cleanLocations,
      currentUser: {
        id: user.id,
        role: callerRole,
        budget: currentUserBudget,
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

    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    const updated = await groupService.startDetailsCollection(user.id, groupId);
    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(updated);
  } catch (err) {
    return apiResponse.error(err);
  }
}
