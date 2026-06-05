import { groupRepository } from '../repositories/group.repository';
import { memberRepository } from '../repositories/member.repository';
import { inviteRepository } from '../repositories/invite.repository';
import { userRepository } from '../repositories/user.repository';
import { createGroupSchema, updateGroupSchema } from '../validators/group.schema';
import { joinGroupSchema } from '../validators/vote.schema';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  DuplicateError,
  InviteExpiredError
} from '../errors';

export const groupService = {
  async createGroup(
    userId: string,
    input: { name: string; groupType: 'FRIENDS' | 'DATE' | 'FAMILY' | 'WORK' | 'CUSTOM'; description?: string | null; vibes?: string[] }
  ) {
    // 1. Validate inputs via Zod
    const parsed = createGroupSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError('Invalid group inputs', parsed.error.flatten());
    }

    const uuid = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    // 2. Generate unique 8-character invite code
    const generateInviteCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    };
    
    const inviteCode = generateInviteCode();
    const groupId = uuid();

    // 3. Create Group and set Creator as OWNER in Group Members
    const groupData = {
      id: groupId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      groupType: parsed.data.groupType,
      vibes: input.vibes ? JSON.stringify(input.vibes) : null,
      creatorId: userId,
      inviteCode,
      status: 'ACTIVE' as const,
      votingStatus: 'CLOSED' as const,
      maxMembers: 20,
    };

    const group = await groupRepository.create(groupData);

    await memberRepository.addMember({
      id: uuid(),
      groupId: group.id,
      userId,
      role: 'OWNER',
    });

    // Create invite tracking entry (expires in 7 days)
    const sevenDaysInSeconds = 7 * 24 * 60 * 60;
    const expiresAt = Math.floor(Date.now() / 1000) + sevenDaysInSeconds;
    await inviteRepository.create({
      id: uuid(),
      groupId: group.id,
      inviteCode,
      expiresAt,
      revoked: 0,
    });

    return group;
  },

  async updateGroup(
    userId: string,
    groupId: string,
    input: { name?: string; groupType?: 'FRIENDS' | 'DATE' | 'FAMILY' | 'WORK' | 'CUSTOM'; description?: string | null; vibes?: string[] }
  ) {
    // Verify Caller is OWNER
    const member = await memberRepository.getMember(groupId, userId);
    if (!member || member.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner can update group details.');
    }

    // Validate inputs
    const parsed = updateGroupSchema.safeParse({ ...input, groupId });
    if (!parsed.success) {
      throw new ValidationError('Invalid update settings', parsed.error.flatten());
    }

    const { vibes, ...fields } = input;
    const updateData: any = { ...fields };
    if (vibes) {
      updateData.vibes = JSON.stringify(vibes);
    }

    return groupRepository.update(groupId, updateData);
  },

  async deleteGroup(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member || member.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner can delete the group.');
    }

    await groupRepository.softDelete(groupId);
  },

  async archiveGroup(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member || member.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner can archive the group.');
    }

    await groupRepository.archive(groupId);
  },

  async joinGroup(userId: string, inviteCode: string) {
    // 1. Validate inviteCode
    const parsed = joinGroupSchema.safeParse({ inviteCode });
    if (!parsed.success) {
      throw new ValidationError('Invalid invite code format');
    }

    // 2. Lookup invite
    const invite = await inviteRepository.findByCode(inviteCode);
    if (!invite || invite.revoked === 1) {
      throw new NotFoundError('Active invite code not found.');
    }

    // 3. Expiry check (7 days)
    const currentUnix = Math.floor(Date.now() / 1000);
    if (currentUnix > invite.expiresAt) {
      throw new InviteExpiredError();
    }

    // 4. Verify group exists & count members
    const groupWithCount = await groupRepository.getGroupWithMemberCount(invite.groupId);
    if (!groupWithCount || groupWithCount.status === 'DELETED') {
      throw new NotFoundError('Group does not exist.');
    }

    if (groupWithCount.memberCount >= groupWithCount.maxMembers) {
      throw new ValidationError('Group has reached maximum member limit.');
    }

    // 5. Verify user is not already a member
    const existingMember = await memberRepository.getMember(invite.groupId, userId);
    if (existingMember) {
      throw new DuplicateError('You are already a member of this group.');
    }

    const uuid = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    // 6. Join
    return memberRepository.addMember({
      id: uuid(),
      groupId: invite.groupId,
      userId,
      role: 'MEMBER',
    });
  },

  async leaveGroup(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new NotFoundError('You are not a member of this group.');
    }

    // If owner, force ownership transfer first
    if (member.role === 'OWNER') {
      throw new ValidationError('Owners cannot leave without transferring ownership first.');
    }

    await memberRepository.removeMember(groupId, userId);
  },

  async removeMember(userId: string, groupId: string, targetUserId: string) {
    const callerMember = await memberRepository.getMember(groupId, userId);
    if (!callerMember || callerMember.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner can remove other members.');
    }

    if (userId === targetUserId) {
      throw new ForbiddenError('You cannot remove yourself. Use leave group instead.');
    }

    const targetMember = await memberRepository.getMember(groupId, targetUserId);
    if (!targetMember) {
      throw new NotFoundError('The specified user is not a member of this group.');
    }

    await memberRepository.removeMember(groupId, targetUserId);
  },

  async transferOwnership(userId: string, groupId: string, newOwnerId: string) {
    const callerMember = await memberRepository.getMember(groupId, userId);
    if (!callerMember || callerMember.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner can transfer ownership.');
    }

    const targetMember = await memberRepository.getMember(groupId, newOwnerId);
    if (!targetMember) {
      throw new NotFoundError('The target user is not a member of this group.');
    }

    await memberRepository.transferOwnership(groupId, userId, newOwnerId);
  },

  async getGroupDetails(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not authorized to view this group.');
    }

    const group = await groupRepository.getGroupWithMemberCount(groupId);
    if (!group || group.status === 'DELETED') {
      throw new NotFoundError('Group not found.');
    }

    return group;
  },
};

export type GroupService = typeof groupService;
