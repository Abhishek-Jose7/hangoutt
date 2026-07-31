'use server';

import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { isHangoutApiConfigured, hangoutApi, getCurrentApiUser } from '@/lib/cloudflare/hangoutApi';
import { ActionResponse } from '@/lib/types/api.types';
import type { QuickPlanInput } from '@/lib/services/quickPlan.service';

export async function generateQuickPlanAction(input: QuickPlanInput): ActionResponse<any> {
  try {
    const { quickPlanService } = await import('@/lib/services/quickPlan.service');
    const { checkRateLimit, rateLimitMessage } = await import('@/lib/services/rateLimit');

    let userId: string;
    let email: string | undefined;
    if (isHangoutApiConfigured()) {
      const apiUser = await getCurrentApiUser();
      userId = apiUser.id || apiUser.clerkId;
      email = apiUser.email;
    } else {
      const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
      const user = await getCurrentUser();
      userId = user.id;
      email = (user as any).email;
    }

    // Same generation limit as the group planner; admin emails bypass.
    const rl = await checkRateLimit({
      operation: 'PLAN_GENERATE',
      userId,
      userEmail: email,
    });
    if (!rl.allowed && rl.hit) {
      throw new ValidationError(rateLimitMessage(rl.hit));
    }

    const result = await quickPlanService.generate(userId, input);
    return apiResponse.success(result);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function saveQuickPlanAction(
  plan: any,
  requestMeta: QuickPlanInput
): ActionResponse<{ historyId: string }> {
  try {
    if (isHangoutApiConfigured()) {
      const apiUser = await getCurrentApiUser();
      const response = await hangoutApi<any>('/internal/quick-plan/save', {
        method: 'POST',
        body: {
          clerkId: apiUser.clerkId,
          plan: {
            name: plan.name,
            tagline: plan.tagline,
            meetupZone: plan.meetupZone ?? plan.name,
            budgetTier: plan.budgetTier,
            totalEstimatedCostPerHead: plan.totalEstimatedCostPerHead,
            slots: (plan.slots || []).map((s: any) => ({
              name: s.name,
              category: s.category,
              arrivalTime: s.arrivalTime,
              durationMinutes: s.durationMinutes,
              estimatedCostPerHead: s.estimatedCostPerHead,
              note: s.note,
              venueId: s.venueId,
            })),
          },
          outingDate: requestMeta.outingDate,
          headcount: requestMeta.headcount,
          metadata: requestMeta,
        },
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to save quick plan');
      }
      revalidatePath('/history');
      return apiResponse.success(response.data);
    }

    // Local dev: write history row directly.
    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const { db } = await import('@/lib/db/client');
    const { history } = await import('@/lib/db/schema');
    const user = await getCurrentUser();
    const randomUUID = () =>
      typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID();
    const historyId = randomUUID();
    const now = new Date().toISOString();

    await db.insert(history).values({
      id: historyId,
      groupId: `quickuser_${user.id}`,
      planId: `quickplan_${randomUUID()}`,
      outingDate: requestMeta.outingDate || now.split('T')[0],
      groupName: plan.meetupZone ? `Quick Plan — ${plan.meetupZone}` : 'Quick Plan',
      planName: plan.name,
      planTagline: plan.tagline || '',
      venuesJson: JSON.stringify((plan.slots || []).map((s: any) => ({
        name: s.name,
        category: s.category,
        arrivalTime: s.arrivalTime,
        durationMinutes: s.durationMinutes,
        estimatedCostPerHead: s.estimatedCostPerHead,
        note: s.note,
      }))),
      participantsJson: JSON.stringify(
        Array.from({ length: Math.max(1, requestMeta.headcount || 1) }, (_, i) => ({
          userId: i === 0 ? user.id : `quick_m${i}`,
          name: i === 0 ? 'You' : `Guest ${i}`,
        }))
      ),
      totalCostPerHead: plan.totalEstimatedCostPerHead,
      winningCategories: JSON.stringify((plan.slots || []).map((s: any) => s.category)),
      winningBudgetTier: plan.budgetTier || null,
      winningActivities: JSON.stringify((plan.slots || []).map((s: any) => s.name)),
      source: 'QUICK',
      metadata: JSON.stringify(requestMeta),
      createdAt: now,
    });

    revalidatePath('/history');
    return apiResponse.success({ historyId });
  } catch (err) {
    return apiResponse.error(err);
  }
}
