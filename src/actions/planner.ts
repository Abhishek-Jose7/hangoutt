'use server';

import { apiResponse } from '@/lib/utils/apiResponse';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';
import { ActionResponse } from '@/lib/types/api.types';

export async function generatePlan(groupId: string): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      throw new ValidationError('Plan generation is not available through the D1 Worker API yet.');
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { memberRepository } = await import('@/lib/repositories/member.repository');
    const { plannerService } = await import('@/lib/services/planner.service');
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
    if (isHangoutApiConfigured()) {
      return apiResponse.success([]);
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { memberRepository } = await import('@/lib/repositories/member.repository');
    const { planRepository } = await import('@/lib/repositories/plan.repository');
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
