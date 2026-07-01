'use server';

import { revalidatePath } from 'next/cache';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ActionResponse } from '@/lib/types/api.types';
import { isHangoutApiConfigured, getCurrentApiUser } from '@/lib/cloudflare/hangoutApi';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { db } from '@/lib/db/client';
import { itineraryFeedback, venueFeedback, rankingMetrics, placeScores } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export interface VenueRating {
  placeId: string;
  venueName: string;
  rating: number;
  wouldVisitAgain: boolean;
}

export interface OutingFeedbackInput {
  overallRating: number;
  travelRating: number;
  favoriteSlotId?: string;
  venueRatings: VenueRating[];
}

export async function submitOutingFeedback(
  historyId: string,
  groupId: string,
  planId: string | undefined,
  data: OutingFeedbackInput
): ActionResponse<void> {
  try {
    if (!historyId || !groupId) throw new Error('historyId and groupId are required');
    if (data.overallRating < 1 || data.overallRating > 5) throw new Error('overallRating must be 1–5');

    let userId: string;
    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      userId = user.id || user.clerkId;
    } else {
      const user = await getCurrentUser();
      userId = user.id;
    }

    const now = new Date().toISOString();
    const randomUUID = () =>
      typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID();

    // Upsert itinerary-level feedback (one row per user per outing)
    await db.insert(itineraryFeedback).values({
      id: randomUUID(),
      historyId,
      userId,
      planId: planId ?? null,
      overallRating: data.overallRating,
      travelRating: data.travelRating,
      favoriteSlotId: data.favoriteSlotId ?? null,
      createdAt: now,
    }).onConflictDoUpdate({
      target: [itineraryFeedback.userId, itineraryFeedback.historyId],
      set: {
        overallRating: data.overallRating,
        travelRating: data.travelRating,
        favoriteSlotId: data.favoriteSlotId ?? null,
      },
    });

    // Insert per-venue feedback and update learning signals
    for (const vr of data.venueRatings) {
      if (!vr.placeId || vr.rating < 1 || vr.rating > 5) continue;

      await db.insert(venueFeedback).values({
        id: randomUUID(),
        historyId,
        userId,
        placeId: vr.placeId,
        rating: vr.rating,
        wouldVisitAgain: vr.wouldVisitAgain ? 1 : 0,
        createdAt: now,
      }).onConflictDoNothing();

      // Boost popularity for well-rated real venues
      if (vr.rating >= 4 && !vr.placeId.startsWith('fb_') && !vr.placeId.startsWith('fallback_')) {
        await db.update(placeScores)
          .set({ popularity: sql`MIN(1.0, popularity + 0.02)` })
          .where(eq(placeScores.placeId, vr.placeId))
          .catch(() => {});

        await db.update(rankingMetrics)
          .set({ timesViewed: sql`times_viewed + 1` })
          .where(eq(rankingMetrics.placeId, vr.placeId))
          .catch(() => {});
      }
    }

    revalidatePath(`/groups/${groupId}`);
    revalidatePath('/history');
    return apiResponse.success(undefined);
  } catch (err) {
    return apiResponse.error(err);
  }
}
