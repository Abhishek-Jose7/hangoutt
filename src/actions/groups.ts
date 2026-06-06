'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { groupService } from '@/lib/services/group.service';
import { apiResponse } from '@/lib/utils/apiResponse';
import { updateGroupSchema } from '@/lib/validators/group.schema';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';

export async function createGroup(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Create group via service
    const newGroup = await groupService.createGroup(user.id, rawInput as any);

    revalidatePath('/groups');
    return apiResponse.success(newGroup);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateGroup(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    const parsed = updateGroupSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

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
    const user = await getCurrentUser();

    await groupService.deleteGroup(user.id, groupId);
    
    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function archiveGroup(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    await groupService.archiveGroup(user.id, groupId);
    
    revalidatePath(`/groups/${groupId}`);
    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

import { groupRepository } from '@/lib/repositories/group.repository';
import { historyRepository } from '@/lib/repositories/history.repository';

export async function getUserGroupsAction(): ActionResponse<any[]> {
  try {
    const user = await getCurrentUser();
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
    const user = await getCurrentUser();
    const historyList = await historyRepository.getHistoryForUser(user.id);
    return apiResponse.success(historyList);
  } catch (err) {
    return apiResponse.error(err);
  }
}

import { memberRepository } from '@/lib/repositories/member.repository';
import { budgetRepository } from '@/lib/repositories/budget.repository';
import { locationRepository } from '@/lib/repositories/location.repository';

export async function getGroupDetailsAction(groupId: string): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Fetch group details
    const group = await groupService.getGroupDetails(user.id, groupId);
    
    // Fetch members detail
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    
    // Fetch budget aggregates
    const budgetSummary = await budgetRepository.getGroupBudgetSummary(groupId);
    
    // Fetch budgets list to see who submitted (and get the current user's submitted budget)
    const budgets = await budgetRepository.getGroupBudgets(groupId);
    const currentUserBudget = budgets.find(b => b.userId === user.id)?.maxBudget || null;

    // Fetch locations list to see who submitted (and get current user's submitted coordinates)
    const locations = await locationRepository.getGroupLocations(groupId);
    const currentUserLocation = locations.find(l => l.userId === user.id) || null;

    // Fetch caller role
    const callerMember = members.find(m => m.userId === user.id);
    const callerRole = callerMember ? callerMember.role : 'MEMBER';

    // Verify readiness
    const isReady = await groupService.checkGroupReadiness(groupId);

    // Apply coordinate privacy envelope
    const isAdmin = callerRole === 'ADMIN';
    const cleanLocations = locations.map(l => {
      const member = members.find(m => m.userId === l.userId);
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
      submittedBudgetUserIds: budgets.map(b => b.userId),
      locations: cleanLocations,
      currentUser: {
        id: user.id,
        role: callerRole,
        budget: currentUserBudget,
        location: currentUserLocation,
      }
    });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function startDetailsCollectionAction(groupId: string): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    const updated = await groupService.startDetailsCollection(user.id, groupId);
    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(updated);
  } catch (err) {
    return apiResponse.error(err);
  }
}
