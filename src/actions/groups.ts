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
