'use server';

import { apiResponse } from '@/lib/utils/apiResponse';
import { ForbiddenError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { isHangoutApiConfigured, hangoutApi } from '@/lib/cloudflare/hangoutApi';
import { ActionResponse } from '@/lib/types/api.types';

async function getRequestIp() {
  const h = await headers();
  return h.get('cf-connecting-ip')
    || h.get('x-real-ip')
    || (h.get('x-forwarded-for') ?? '').split(',')[0].trim()
    || undefined;
}

export async function generatePlan(groupId: string, options: string[] = []): ActionResponse<any> {
  try {
    const ip = await getRequestIp();

    if (isHangoutApiConfigured()) {
      const { getCurrentApiUser } = await import('@/lib/cloudflare/hangoutApi');
      const { plannerService } = await import('@/lib/services/planner.service');
      const apiUser = await getCurrentApiUser();
      const result = await plannerService.generatePlan(apiUser.id || apiUser.clerkId, groupId, options, {
        clerkId: apiUser.clerkId,
        email: apiUser.email,
        ip,
      });

      revalidatePath(`/groups/${groupId}`);
      revalidatePath(`/planner/${groupId}`);
      return apiResponse.success((result as any).plans);
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
    const result = await plannerService.generatePlan(user.id, groupId, options, {
      ip,
      email: (user as any).email,
    });

    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/planner/${groupId}`);
    return apiResponse.success((result as any).plans);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function getPlansForGroupAction(groupId: string): ActionResponse<any[]> {
  try {
    let plansList: any[] = [];

    if (isHangoutApiConfigured()) {
      const response = await hangoutApi<any>(`/groups/${groupId}/plans`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch plans from D1');
      }
      plansList = response.data || [];
    } else {
      const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
      const { memberRepository } = await import('@/lib/repositories/member.repository');
      const { planRepository } = await import('@/lib/repositories/plan.repository');
      const user = await getCurrentUser();

      // Verify caller is a member of the group
      const member = await memberRepository.getMember(groupId, user.id);
      if (!member) {
        throw new ForbiddenError('You must be a member of this group to view plans.');
      }

      plansList = await planRepository.getPlansForGroup(groupId);

      // Increment timesViewed locally for the places
      try {
        const { db } = await import('@/lib/db/client');
        const { sql } = await import('drizzle-orm');
        const uniqueVenueIds = Array.from(new Set(plansList.flatMap((p: any) => p.slots.map((s: any) => s.venueId)).filter((id: any) => id && !id.startsWith('fb_') && !id.startsWith('fallback_'))));
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
    }

    return apiResponse.success(plansList);
  } catch (err) {
    return apiResponse.error(err);
  }
}

// Public, unauthenticated read for share links.
export async function getSharedPlanAction(planId: string): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      const response = await hangoutApi<any>(`/public/plans/${encodeURIComponent(planId)}`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Plan not found');
      }
      return apiResponse.success(response.data);
    }

    const { db } = await import('@/lib/db/client');
    const { plans, planSlots, groups } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    const planRow = await db.select().from(plans).where(eq(plans.id, planId)).get();
    if (!planRow) {
      throw new Error('Plan not found');
    }
    const groupRow = await db.select().from(groups).where(eq(groups.id, planRow.groupId)).get();
    const slots = await db.select().from(planSlots).where(eq(planSlots.planId, planId)).orderBy(planSlots.slotOrder);

    let parsedWhy: string[] = [];
    if ((planRow as any).whyRecommended) {
      try {
        parsedWhy = typeof (planRow as any).whyRecommended === 'string'
          ? JSON.parse((planRow as any).whyRecommended)
          : (planRow as any).whyRecommended;
      } catch { parsedWhy = []; }
    }

    return apiResponse.success({
      ...planRow,
      whyRecommended: parsedWhy,
      groupName: groupRow?.name,
      outingDate: groupRow?.outingDate,
      outingTime: groupRow?.outingTime,
      slots,
    });
  } catch (err) {
    return apiResponse.error(err);
  }
}
