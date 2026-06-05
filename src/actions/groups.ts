'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { groupRepository } from '@/lib/repositories/group.repository';
import { memberRepository } from '@/lib/repositories/member.repository';
import { createGroupSchema, updateGroupSchema } from '@/lib/validators/group.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';

// Helper to generate 8-character alphanumeric invite code
function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function createGroup(rawInput: unknown): ActionResponse<any> {
  try {
    // 1. Authenticate user
    const user = await getCurrentUser();
    
    // 2. Validate input
    const parsed = createGroupSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }
    
    const { name, groupType, description } = parsed.data;

    // 3. Generate unique invite code (checks database for collisions)
    let inviteCode = generateInviteCode();
    let collision = await groupRepository.findByInviteCode(inviteCode);
    let attempts = 0;
    while (collision && attempts < 10) {
      inviteCode = generateInviteCode();
      collision = await groupRepository.findByInviteCode(inviteCode);
      attempts++;
    }

    const randomUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    const groupId = randomUUID();
    const now = new Date().toISOString();

    // 4. Create group and add owner as member in a transaction/sequentially
    const newGroup = await groupRepository.create({
      id: groupId,
      name,
      groupType,
      description,
      creatorId: user.id,
      inviteCode,
      status: 'ACTIVE',
      maxMembers: 20,
      createdAt: now,
      updatedAt: now,
    });

    await memberRepository.addMember({
      id: randomUUID(),
      groupId,
      userId: user.id,
      role: 'OWNER',
      createdAt: now,
    });

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

    // Verify group exists
    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    // Verify user is owner
    if (group.creatorId !== user.id) {
      throw new ForbiddenError('Only the group creator can update the group details.');
    }

    const updated = await groupRepository.update(groupId, fields);
    
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

    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (group.creatorId !== user.id) {
      throw new ForbiddenError('Only the group creator can delete the group.');
    }

    await groupRepository.softDelete(groupId);
    
    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function archiveGroup(groupId: string): ActionResponse<{ success: boolean }> {
  try {
    const user = await getCurrentUser();

    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (group.creatorId !== user.id) {
      throw new ForbiddenError('Only the group creator can archive the group.');
    }

    await groupRepository.archive(groupId);
    
    revalidatePath(`/groups/${groupId}`);
    revalidatePath('/groups');
    return apiResponse.success({ success: true });
  } catch (err) {
    return apiResponse.error(err);
  }
}

import { ActionResponse } from '@/lib/types/api.types';
