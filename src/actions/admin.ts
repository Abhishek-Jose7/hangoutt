'use server';

import { apiResponse, ApiResponse } from '@/lib/utils/apiResponse';
import { ActionResponse } from '@/lib/types/api.types';
import { getCurrentApiUser, hangoutApi, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export async function getAdminPlaces(): ActionResponse<any[]> {
  try {
    if (isHangoutApiConfigured()) {
      // Fetch from Cloudflare worker
      const res = await hangoutApi<ApiResponse<any[]>>('/api/admin/places');
      return res;
    }

    // Otherwise, fetch from local SQLite
    const { db } = await import('@/lib/db/client');
    const { places, placeCosts, placeScores, placeCategories } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    const dbPlaces = await db.select().from(places);
    
    // Fetch costs, scores, categories and join them in memory to keep it simple and correct
    const results = await Promise.all(dbPlaces.map(async (p: any) => {
      const costs = await db.select().from(placeCosts).where(eq(placeCosts.placeId, p.id)).limit(1);
      const scores = await db.select().from(placeScores).where(eq(placeScores.placeId, p.id)).limit(1);
      const cats = await db.select().from(placeCategories).where(eq(placeCategories.placeId, p.id));
      
      return {
        id: p.id,
        name: p.name,
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        rating: p.rating,
        reviewCount: p.reviewCount,
        mandatoryCost: costs[0]?.mandatoryCost ?? 0,
        optionalCostMin: costs[0]?.optionalCostMin ?? 0,
        optionalCostMax: costs[0]?.optionalCostMax ?? 0,
        popularity: scores[0]?.popularity ?? 0,
        budgetFriendliness: scores[0]?.budgetFriendliness ?? 0,
        overall: scores[0]?.overall ?? 0,
        categories: cats.map((c: any) => c.category).join(', ')
      };
    }));

    return apiResponse.success(results);
  } catch (err) {
    return apiResponse.error(err);
  }
}
