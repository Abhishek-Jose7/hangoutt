'use server';

import { apiResponse } from '@/lib/utils/apiResponse';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { isHangoutApiConfigured, hangoutApi } from '@/lib/cloudflare/hangoutApi';
import { ActionResponse } from '@/lib/types/api.types';

export async function generatePlan(groupId: string, options: string[] = []): ActionResponse<any> {
  try {
    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { memberRepository } = await import('@/lib/repositories/member.repository');
    const { plannerService } = await import('@/lib/services/planner.service');
    const user = await getCurrentUser();

    // Verify caller is a member of the group
    const member = await memberRepository.getMember(groupId, user.id);
    if (!member && !isHangoutApiConfigured()) {
      throw new ForbiddenError('You must be a member of this group to generate plans.');
    }

    // Call service to run calculation and persist plans
    const result = await plannerService.generatePlan(user.id, groupId, options);

    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/planner/${groupId}`);
    return apiResponse.success((result as any).plans);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function getPlansForGroupAction(groupId: string): ActionResponse<any[]> {
  try {
    if (isHangoutApiConfigured()) {
      const response = await hangoutApi<any>(`/groups/${groupId}/plans`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch plans from D1');
      }
      return apiResponse.success(response.data);
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

    // Increment timesViewed locally for the places
    try {
      const { db } = await import('@/lib/db/client');
      const { sql } = await import('drizzle-orm');
      const uniqueVenueIds = Array.from(new Set(plansList.flatMap(p => p.slots.map(s => s.venueId)).filter(id => id && !id.startsWith('fallback_'))));
      for (const venueId of uniqueVenueIds) {
        await db.run(sql`
          INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
          VALUES (${venueId}, 0, 1, 0, 0)
          ON CONFLICT(place_id)
          DO UPDATE SET times_viewed = times_viewed + 1
        `);
      }
    } catch (err) {
      console.error('Failed to increment local timesViewed:', err);
    }

    return apiResponse.success(plansList);
  } catch (err) {
    return apiResponse.error(err);
  }
}
