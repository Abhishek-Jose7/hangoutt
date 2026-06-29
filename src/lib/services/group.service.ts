import { groupRepository } from '../repositories/group.repository';
import { memberRepository } from '../repositories/member.repository';
import { inviteRepository } from '../repositories/invite.repository';
import { userRepository } from '../repositories/user.repository';
import { budgetRepository } from '../repositories/budget.repository';
import { locationRepository } from '../repositories/location.repository';
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
    input: {
      name: string;
      groupType: 'FRIENDS' | 'DATE' | 'FAMILY' | 'WORK' | 'CUSTOM';
      description?: string | null;
      vibes?: string[];
      outingDate?: string | null;
      outingTime?: string | null;
      isFastTrack?: boolean;
    }
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

    // 2. Generate unique 8-character invite code (uppercase, readable, no confusables)
    const generateInviteCode = () => {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    };
    
    const inviteCode = generateInviteCode();
    const groupId = uuid();

    const isFastTrackVal = 0;
    const timerExpiresAt = null;

    // 3. Create Group and set Creator as ADMIN in Group Members
    const groupData = {
      id: groupId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      groupType: parsed.data.groupType,
      vibes: input.vibes ? JSON.stringify(input.vibes) : null,
      creatorId: userId,
      inviteCode,
      status: 'COLLECTING_MEMBERS' as const, // Starts in collecting members
      votingStatus: 'CLOSED' as const,
      maxMembers: 20,
      outingDate: parsed.data.outingDate || null,
      outingTime: parsed.data.outingTime || null,
      isFastTrack: isFastTrackVal,
      timerExpiresAt,
    };

    const group = await groupRepository.create(groupData);

    await memberRepository.addMember({
      id: uuid(),
      groupId: group.id,
      userId,
      role: 'ADMIN', // Set as ADMIN
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
    // Verify Caller is ADMIN
    const member = await memberRepository.getMember(groupId, userId);
    if (!member || member.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can update group details.');
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
    if (!member || member.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can delete the group.');
    }

    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('Group not found.');
    }
    validateStatusTransition(group.status, 'DELETED');

    await groupRepository.softDelete(groupId);
  },

  async archiveGroup(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member || member.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can archive the group.');
    }

    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('Group not found.');
    }
    validateStatusTransition(group.status, 'ARCHIVED');

    await groupRepository.update(groupId, {
      status: 'ARCHIVED'
    });
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

    // Block joins if lifecycle status is not COLLECTING_MEMBERS, COLLECTING_DETAILS, or READY_TO_GENERATE
    if (
      groupWithCount.status !== 'COLLECTING_MEMBERS' &&
      groupWithCount.status !== 'COLLECTING_DETAILS' &&
      groupWithCount.status !== 'READY_TO_GENERATE'
    ) {
      throw new ValidationError(`This group is no longer accepting new members (status: ${groupWithCount.status}).`);
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

    // 6. Join as MEMBER
    const newMember = await memberRepository.addMember({
      id: uuid(),
      groupId: invite.groupId,
      userId,
      role: 'MEMBER',
    });

    // If the group was READY_TO_GENERATE, transition it back to COLLECTING_DETAILS
    // since the new member hasn't submitted their budget/location details yet.
    if (groupWithCount.status === 'READY_TO_GENERATE') {
      await groupRepository.update(invite.groupId, {
        status: 'COLLECTING_DETAILS',
      });
    }

    return newMember;
  },

  async leaveGroup(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new NotFoundError('You are not a member of this group.');
    }

    // If owner/admin, force ownership transfer first
    if (member.role === 'ADMIN') {
      throw new ValidationError('Admins cannot leave without transferring ownership first.');
    }

    await memberRepository.removeMember(groupId, userId);
  },

  async removeMember(userId: string, groupId: string, targetUserId: string) {
    const callerMember = await memberRepository.getMember(groupId, userId);
    if (!callerMember || callerMember.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can remove other members.');
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
    if (!callerMember || callerMember.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can transfer ownership.');
    }

    const targetMember = await memberRepository.getMember(groupId, newOwnerId);
    if (!targetMember) {
      throw new NotFoundError('The target user is not a member of this group.');
    }

    await memberRepository.transferOwnership(groupId, userId, newOwnerId);
  },

  async startDetailsCollection(userId: string, groupId: string) {
    const member = await memberRepository.getMember(groupId, userId);
    if (!member || member.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can lock the member list and start details collection.');
    }

    const group = await groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundError('Group not found.');
    }
    validateStatusTransition(group.status, 'COLLECTING_DETAILS');

    const updateData: any = {
      status: 'COLLECTING_DETAILS',
    };

    return groupRepository.update(groupId, updateData);
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

  // Check if all active members have submitted budget and location
  async checkGroupReadiness(groupId: string): Promise<boolean> {
    const group = await groupRepository.findById(groupId);
    if (!group || group.status === 'DELETED') {
      throw new NotFoundError('Group not found.');
    }

    // Already past the collection phase — treat as ready
    if (!['COLLECTING_DETAILS', 'READY_TO_GENERATE'].includes(group.status)) {
      return ['READY_TO_GENERATE', 'GENERATING', 'VOTING', 'COMPLETED', 'ARCHIVED'].includes(group.status);
    }

    const members = await memberRepository.getMembersWithUserDetails(groupId);
    if (members.length === 0) return false;

    const activeUserIds = members.map((m) => m.userId);

    // Check which members have submitted both a budget and a location
    const [groupBudgets, groupLocations] = await Promise.all([
      budgetRepository.getGroupBudgets(groupId),
      locationRepository.getGroupLocations(groupId),
    ]);

    const submittedCount = activeUserIds.filter(
      (id) => groupBudgets.some((b) => b.userId === id) && groupLocations.some((l) => l.userId === id)
    ).length;

    const isReady = submittedCount >= members.length;

    if (isReady && group.status === 'COLLECTING_DETAILS') {
      await groupRepository.update(groupId, { status: 'READY_TO_GENERATE' });
    }

    return isReady;
  },
};

export function validateStatusTransition(currentStatus: string, nextStatus: string) {
  const STATUS_ORDER = ['COLLECTING_MEMBERS', 'COLLECTING_DETAILS', 'READY_TO_GENERATE', 'GENERATING', 'VOTING', 'COMPLETED', 'ARCHIVED', 'DELETED'];
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  const nextIndex = STATUS_ORDER.indexOf(nextStatus);

  if (currentIndex === -1 || nextIndex === -1) {
    throw new Error(`Invalid status name: current=${currentStatus}, next=${nextStatus}`);
  }

  // Allow fallback from GENERATING to READY_TO_GENERATE on failure
  if (currentStatus === 'GENERATING' && nextStatus === 'READY_TO_GENERATE') {
    return;
  }

  // Allow fallback from VOTING to GENERATING on regeneration
  if (currentStatus === 'VOTING' && nextStatus === 'GENERATING') {
    return;
  }

  if (nextIndex <= currentIndex) {
    throw new ValidationError(`Invalid lifecycle transition from ${currentStatus} to ${nextStatus}. Status can only move forward.`);
  }
}

export type GroupService = typeof groupService;
