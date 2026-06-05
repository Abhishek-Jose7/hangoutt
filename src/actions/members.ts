'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { groupService } from '@/lib/services/group.service';
import { joinGroupSchema } from '@/lib/validators/vote.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';

export async function joinGroup(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Validate invite code
    const parsed = joinGroupSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Invalid invite code format', parsed.error.flatten());
    }

    const { inviteCode } = parsed.data;
    const newMember = await groupService.joinGroup(user.id, inviteCode);

    // Get group id of the new member to revalidate
    const groupId = newMember.groupId;

    revalidatePath(`/groups/${groupId}`);
    revalidatePath('/groups');
    return apiResponse.success(newMember);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function leaveGroup(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    await groupService.leaveGroup(user.id, groupId);
    
    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function removeMember(groupId: string, targetUserId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    await groupService.removeMember(user.id, groupId, targetUserId);
    
    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function transferOwnership(groupId: string, newOwnerId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    await groupService.transferOwnership(user.id, groupId, newOwnerId);
    
    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}
