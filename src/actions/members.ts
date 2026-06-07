'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { joinGroupSchema } from '@/lib/validators/vote.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';
import { z } from 'zod';
import { getCurrentApiUser, hangoutApi, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export async function joinGroup(rawInput: unknown): ActionResponse<any> {
  try {
    const parsed = joinGroupSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Invalid invite code format', parsed.error.flatten());
    }

    const { inviteCode } = parsed.data;

    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const newMember = await hangoutApi<any>('/groups/join', {
        method: 'POST',
        body: {
          user,
          inviteCode,
        },
      });

      if (newMember.success) {
        revalidatePath(`/groups/${newMember.data.groupId}`);
      }
      revalidatePath('/groups');
      return newMember;
    }

    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    const newMember = await groupService.joinGroup(user.id, inviteCode);
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
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Leaving groups is not available through the D1 Worker API yet.');
    }

    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    await groupService.leaveGroup(user.id, groupId);

    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function removeMember(groupId: string, targetUserId: string): ActionResponse<{ success: boolean }> {
  try {
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Removing members is not available through the D1 Worker API yet.');
    }

    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    await groupService.removeMember(user.id, groupId, targetUserId);

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function transferOwnership(groupId: string, newOwnerId: string): ActionResponse<{ success: boolean }> {
  try {
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Transferring ownership is not available through the D1 Worker API yet.');
    }

    const user = await getCurrentUser();
    const { groupService } = await import('@/lib/services/group.service');
    await groupService.transferOwnership(user.id, groupId, newOwnerId);

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function submitMemberVibes(groupId: string, vibes: string[]): ActionResponse<any> {
  try {
    const parsedGroupId = z.string().uuid().parse(groupId);
    const parsedVibes = z.array(z.string()).parse(vibes);

    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const updatedMember = await hangoutApi<any>(`/groups/${parsedGroupId}/vibes`, {
        method: 'POST',
        body: {
          clerkId: user.clerkId,
          vibes: parsedVibes,
        },
      });

      revalidatePath(`/groups/${parsedGroupId}`);
      return updatedMember;
    }

    const user = await getCurrentUser();
    const { memberRepository } = await import('@/lib/repositories/member.repository');
    const member = await memberRepository.getMember(parsedGroupId, user.id);
    if (!member) {
      throw new ValidationError('You are not a member of this planning group.');
    }

    const updatedMember = await memberRepository.updateVibes(parsedGroupId, user.id, parsedVibes);

    revalidatePath(`/groups/${parsedGroupId}`);
    return apiResponse.success(updatedMember);
  } catch (err) {
    return apiResponse.error(err);
  }
}
