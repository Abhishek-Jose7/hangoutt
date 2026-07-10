'use server';

import { apiResponse } from '@/lib/utils/apiResponse';
import { ForbiddenError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { isHangoutApiConfigured, hangoutApi } from '@/lib/cloudflare/hangoutApi';
import { ActionResponse } from '@/lib/types/api.types';

export async function generatePlan(groupId: string, options: string[] = []): ActionResponse<any> {
  try {
    if (isHangoutApiConfigured()) {
      const { getCurrentApiUser } = await import('@/lib/cloudflare/hangoutApi');
      const { plannerService } = await import('@/lib/services/planner.service');
      const apiUser = await getCurrentApiUser();
      const result = await plannerService.generatePlan(apiUser.id || apiUser.clerkId, groupId, options, {
        clerkId: apiUser.clerkId,
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
    let plansList: any[] = [];
    let isRemote = false;

    if (isHangoutApiConfigured()) {
      const response = await hangoutApi<any>(`/groups/${groupId}/plans`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch plans from D1');
      }
      plansList = response.data || [];
      isRemote = true;
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

    // On-the-fly Google Places photo resolution for placeholders or missing slot images
    try {
      const { getVenueImageUrl } = await import('@/lib/maps/places');
      const { db } = await import('@/lib/db/client');
      const { places, planSlots } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');

      for (const plan of plansList) {
        for (const slot of plan.slots) {
          const isPlaceholder = !slot.imageUrl || 
                                slot.imageUrl.includes('unsplash.com') || 
                                slot.imageUrl.includes('placehold.co') || 
                                slot.imageUrl.includes('mumbai_map.png') || 
                                slot.imageUrl.includes('cafe_active.png') ||
                                slot.imageUrl.includes('cafe_1.png') ||
                                slot.imageUrl.includes('cafe_2.png');

          if (isPlaceholder) {
            let searchQuery = slot.name;
            if (!slot.venueId || slot.venueId.startsWith('fb_') || slot.venueId.startsWith('fallback_')) {
              searchQuery = `${slot.category || 'CAFE'} in ${plan.meetupZone || 'Mumbai'}`;
            }

            try {
              const googleImg = await getVenueImageUrl(searchQuery, 'Mumbai', slot.category);
              const isResolved = googleImg && 
                                 !googleImg.includes('mumbai_map.png') && 
                                 !googleImg.includes('unsplash.com') && 
                                 !googleImg.includes('cafe_active.png');

              if (isResolved) {
                // Update in the memory list immediately so the UI receives it
                slot.imageUrl = googleImg;
                
                // If local database mode, persist the cache
                if (!isRemote && slot.id) {
                  // 1. Update the slot row so it is immediately updated in the UI
                  await db.update(planSlots)
                    .set({ imageUrl: googleImg })
                    .where(eq(planSlots.id, slot.id));
                  
                  // 2. Update the master place row to cache it for other groups if there's a real venueId
                  if (slot.venueId && !slot.venueId.startsWith('fb_') && !slot.venueId.startsWith('fallback_')) {
                    await db.update(places)
                      .set({ imageUrl: googleImg })
                      .where(eq(places.id, slot.venueId));
                  }
                }

                console.log(`[ON-THE-FLY IMAGE] Resolved Google Maps photo for "${slot.name}" (query: "${searchQuery}") -> ${googleImg}`);
              }
            } catch (err: any) {
              console.warn(`[ON-THE-FLY IMAGE] Failed to resolve photo for "${slot.name}":`, err.message);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to run on-the-fly photo resolution:', err);
    }

    return apiResponse.success(plansList);
  } catch (err) {
    return apiResponse.error(err);
  }
}
