'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { groupRepository } from '@/lib/repositories/group.repository';
import { memberRepository } from '@/lib/repositories/member.repository';
import { joinGroupSchema } from '@/lib/validators/vote.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError, ForbiddenError, NotFoundError, DuplicateError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';

export async function joinGroup(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Validate invite code
    const parsed = joinGroupSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Invalid invite code format', parsed.error.flatten());
    }

    const { inviteCode } = parsed.data;

    // Find group
    const group = await groupRepository.findByInviteCode(inviteCode);
    if (!group) {
      throw new NotFoundError('No group found matching this invite code.');
    }

    if (group.status === 'DELETED') {
      throw new NotFoundError('This group has been deleted.');
    }

    // Check if user is already a member
    const existingMember = await memberRepository.getMember(group.id, user.id);
    if (existingMember) {
      throw new DuplicateError('You are already a member of this planning group.');
    }

    // Check membership limits
    const members = await memberRepository.getMembersWithUserDetails(group.id);
    if (members.length >= group.maxMembers) {
      throw new ForbiddenError('This planning group has reached its maximum member limit.');
    }

    const randomUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    const newMember = await memberRepository.addMember({
      id: randomUUID(),
      groupId: group.id,
      userId: user.id,
      role: 'MEMBER',
      createdAt: new Date().toISOString(),
    });

    revalidatePath(`/groups/${group.id}`);
    revalidatePath('/groups');
    return apiResponse.success(newMember);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function leaveGroup(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    // Verify member exists
    const member = await memberRepository.getMember(groupId, user.id);
    if (!member) {
      throw new NotFoundError('You are not a member of this group.');
    }

    // If owner, cannot leave without transferring ownership
    if (member.role === 'OWNER') {
      throw new ForbiddenError('As the owner, you cannot leave the group. You must transfer group ownership first.');
    }

    await memberRepository.removeMember(groupId, user.id);
    
    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function removeMember(groupId: string, targetUserId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    // Verify caller is owner
    const callerMember = await memberRepository.getMember(groupId, user.id);
    if (!callerMember || callerMember.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner can remove other members.');
    }

    // Cannot remove self
    if (user.id === targetUserId) {
      throw new ForbiddenError('You cannot remove yourself. Use leave group instead.');
    }

    // Check target exists
    const targetMember = await memberRepository.getMember(groupId, targetUserId);
    if (!targetMember) {
      throw new NotFoundError('The specified user is not a member of this group.');
    }

    await memberRepository.removeMember(groupId, targetUserId);
    
    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function transferOwnership(groupId: string, newOwnerId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    // Verify caller is owner
    const callerMember = await memberRepository.getMember(groupId, user.id);
    if (!callerMember || callerMember.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner can transfer ownership.');
    }

    // Verify target is member
    const targetMember = await memberRepository.getMember(groupId, newOwnerId);
    if (!targetMember) {
      throw new NotFoundError('The specified target user is not a member of this group.');
    }

    await memberRepository.transferOwnership(groupId, user.id, newOwnerId);
    
    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

import { ActionResponse } from '@/lib/types/api.types';
