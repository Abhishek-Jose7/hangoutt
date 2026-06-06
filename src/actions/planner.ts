'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { memberRepository } from '@/lib/repositories/member.repository';
import { planRepository } from '@/lib/repositories/plan.repository';
import { plannerService } from '@/lib/services/planner.service';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ForbiddenError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';

export async function generatePlan(groupId: string): ActionResponse<any> {
  try {
    const user = await getCurrentUser();

    // Verify caller is a member of the group
    const member = await memberRepository.getMember(groupId, user.id);
    if (!member) {
      throw new ForbiddenError('You must be a member of this group to generate plans.');
    }

    // Call service to run calculation and persist plans
    const result = await plannerService.generatePlan(user.id, groupId);

    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/planner/${groupId}`);
    return apiResponse.success(result.plans);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function getPlansForGroupAction(groupId: string): ActionResponse<any[]> {
  try {
    const user = await getCurrentUser();

    // Verify caller is a member of the group
    const member = await memberRepository.getMember(groupId, user.id);
    if (!member) {
      throw new ForbiddenError('You must be a member of this group to view plans.');
    }

    const plansList = await planRepository.getPlansForGroup(groupId);
    return apiResponse.success(plansList);
  } catch (err) {
    return apiResponse.error(err);
  }
}

import { ActionResponse } from '@/lib/types/api.types';
