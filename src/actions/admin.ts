'use server';

import { apiResponse, ApiResponse } from '@/lib/utils/apiResponse';
import { ActionResponse } from '@/lib/types/api.types';
import { getCurrentApiUser, hangoutApi, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

const ADMIN_EMAILS = new Set([
  'abhishekjose780@gmail.com',
  'johannjoseph232006@gmail.com',
]);

async function checkAdminAuth() {
  const user = await getCurrentApiUser();
  if (!user.email || !ADMIN_EMAILS.has(user.email.toLowerCase())) {
    throw new Error('Forbidden: Administrative privileges required.');
  }
}

export async function getAdminPlaces(): ActionResponse<any[]> {
  try {
    await checkAdminAuth();
    if (isHangoutApiConfigured()) {
      // Fetch from Cloudflare worker
      const res = await hangoutApi<ApiResponse<any[]>>('/api/admin/places');
      return res;
    }

    // Otherwise, fetch from local SQLite
    const { db } = await import('@/lib/db/client');
    const { places, placeCosts, placeScores, placeCategories, zones } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    const dbPlaces = await db.select().from(places);
    const dbZones = await db.select().from(zones).catch(() => []);

    function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
      const R = 6371; // km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }
    
    // Fetch costs, scores, categories and join them in memory to keep it simple and correct
    const results = await Promise.all(dbPlaces.map(async (p: any) => {
      const costs = await db.select().from(placeCosts).where(eq(placeCosts.placeId, p.id)).limit(1);
      const scores = await db.select().from(placeScores).where(eq(placeScores.placeId, p.id)).limit(1);
      const cats = await db.select().from(placeCategories).where(eq(placeCategories.placeId, p.id));
      
      let zoneName = 'Mumbai';
      let minD = Infinity;
      for (const z of dbZones) {
        const d = getDistance(p.lat, p.lng, z.centerLat, z.centerLng);
        if (d < minD) {
          minD = d;
          zoneName = z.name;
        }
      }

      return {
        id: p.id,
        name: p.name,
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        rating: p.rating,
        reviewCount: p.reviewCount,
        isFeatured: p.isFeatured === 1 || p.isFeatured === true ? 1 : 0,
        isHidden: p.isHidden === 1 || p.isHidden === true ? 1 : 0,
        boostFactor: typeof p.boostFactor === 'number' ? p.boostFactor : 1.0,
        mandatoryCost: costs[0]?.mandatoryCost ?? 0,
        optionalCostMin: costs[0]?.optionalCostMin ?? 0,
        optionalCostMax: costs[0]?.optionalCostMax ?? 0,
        popularity: scores[0]?.popularity ?? 0,
        budgetFriendliness: scores[0]?.budgetFriendliness ?? 0,
        overall: scores[0]?.overall ?? 0,
        categories: cats.map((c: any) => rCategoryToVibe(c.category)).join(', '),
        zoneName
      };
    }));

    return apiResponse.success(results);
  } catch (err) {
    return apiResponse.error(err);
  }
}

function rCategoryToVibe(cat: string): string {
  return cat;
}

export async function curatePlaceAction(
  placeId: string,
  isFeatured: boolean | number,
  isHidden: boolean | number,
  boostFactor: number
): ActionResponse<void> {
  try {
    await checkAdminAuth();
    const isFeaturedVal = isFeatured === true || isFeatured === 1 ? 1 : 0;
    const isHiddenVal = isHidden === true || isHidden === 1 ? 1 : 0;
    const boostFactorVal = typeof boostFactor === 'number' ? boostFactor : 1.0;

    if (isHangoutApiConfigured()) {
      // PATCH to Cloudflare worker
      const res = await hangoutApi<ApiResponse<void>>(`/api/admin/places/${encodeURIComponent(placeId)}/curate`, {
        method: 'PATCH',
        body: {
          isFeatured: isFeaturedVal,
          isHidden: isHiddenVal,
          boostFactor: boostFactorVal
        }
      });
      if (!res.success) {
        return res;
      }
    }

    // Also update local SQLite
    const { db } = await import('@/lib/db/client');
    const { places } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    await db
      .update(places)
      .set({
        isFeatured: isFeaturedVal,
        isHidden: isHiddenVal,
        boostFactor: boostFactorVal,
        updatedAt: new Date().toISOString()
      })
      .where(eq(places.id, placeId));

    return apiResponse.success(undefined);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function addPlaceAction(data: any): ActionResponse<string> {
  try {
    await checkAdminAuth();
    const { randomUUID } = await import('crypto');
    const placeId = data.id || `MANUAL_${randomUUID()}`;
    const name = data.name || 'Unknown Place';
    const address = data.address || '';
    const lat = Number(data.lat || 0);
    const lng = Number(data.lng || 0);
    const rating = Number(data.rating || 0);
    const reviewCount = Number(data.reviewCount || 0);
    const isFeaturedVal = data.isFeatured === true || data.isFeatured === 1 ? 1 : 0;
    const isHiddenVal = data.isHidden === true || data.isHidden === 1 ? 1 : 0;
    const boostFactorVal = typeof data.boostFactor === 'number' ? data.boostFactor : 1.0;
    const now = new Date().toISOString();

    const mandatoryCost = Number(data.mandatoryCost || 0);
    const optionalCostMin = Number(data.optionalCostMin || 0);
    const optionalCostMax = Number(data.optionalCostMax || 0);

    const popularity = Number(data.popularity || 0);
    const budgetFriendliness = Number(data.budgetFriendliness || 0);
    const conversation = Number(data.conversation || 0);
    const groupSuitability = Number(data.groupSuitability || 0);
    const dateSuitability = Number(data.dateSuitability || 0);
    const friendsSuitability = Number(data.friendsSuitability || 0);
    const familySuitability = Number(data.familySuitability || 0);
    const weatherSuitability = Number(data.weatherSuitability || 0);
    const uniqueness = Number(data.uniqueness || 0);
    const experienceScore = Number(data.experienceScore || 0);
    const overall = Number(data.overall || 0);

    // 1. Update remote D1
    if (isHangoutApiConfigured()) {
      const res = await hangoutApi<ApiResponse<{ id: string }>>('/api/admin/places', {
        method: 'POST',
        body: {
          id: placeId,
          name,
          address,
          lat,
          lng,
          rating,
          reviewCount,
          isFeatured: isFeaturedVal,
          isHidden: isHiddenVal,
          boostFactor: boostFactorVal,
          mandatoryCost,
          optionalCostMin,
          optionalCostMax,
          popularity,
          budgetFriendliness,
          conversation,
          groupSuitability,
          dateSuitability,
          friendsSuitability,
          familySuitability,
          weatherSuitability,
          uniqueness,
          experienceScore,
          overall,
          categories: data.categories
        }
      });
      if (!res.success) {
        return res;
      }
    }

    // 2. Local SQLite write
    const { db } = await import('@/lib/db/client');
    const { places, placeCategories, placeCosts, placeScores } = await import('@/lib/db/schema');

    await db.insert(places).values({
      id: placeId,
      name,
      address,
      lat,
      lng,
      rating,
      reviewCount,
      sourceName: 'MANUAL',
      sourcePlaceId: placeId,
      lastVerified: now,
      verifiedAt: now,
      isFeatured: isFeaturedVal,
      isHidden: isHiddenVal,
      boostFactor: boostFactorVal,
      createdAt: now,
      updatedAt: now
    });

    await db.insert(placeCosts).values({
      placeId,
      mandatoryCost,
      optionalCostMin,
      optionalCostMax
    });

    await db.insert(placeScores).values({
      placeId,
      popularity,
      budgetFriendliness,
      conversation,
      groupSuitability,
      dateSuitability,
      friendsSuitability,
      familySuitability,
      weatherSuitability,
      uniqueness,
      experienceScore,
      overall
    });

    const categories = Array.isArray(data.categories)
      ? data.categories
      : (typeof data.categories === 'string' ? data.categories.split(',').map((c: string) => c.trim()) : []);

    for (const cat of categories) {
      if (cat) {
        await db.insert(placeCategories).values({
          id: randomUUID(),
          placeId,
          category: cat.toUpperCase()
        });
      }
    }

    return apiResponse.success(placeId);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updatePlaceAction(placeId: string, data: any): ActionResponse<void> {
  try {
    await checkAdminAuth();
    const name = data.name;
    const address = data.address;
    const lat = data.lat !== undefined ? Number(data.lat) : undefined;
    const lng = data.lng !== undefined ? Number(data.lng) : undefined;
    const rating = data.rating !== undefined ? Number(data.rating) : undefined;
    const reviewCount = data.reviewCount !== undefined ? Number(data.reviewCount) : undefined;
    const isFeaturedVal = data.isFeatured !== undefined ? (data.isFeatured === true || data.isFeatured === 1 ? 1 : 0) : undefined;
    const isHiddenVal = data.isHidden !== undefined ? (data.isHidden === true || data.isHidden === 1 ? 1 : 0) : undefined;
    const boostFactorVal = data.boostFactor !== undefined ? Number(data.boostFactor) : undefined;
    const now = new Date().toISOString();

    const mandatoryCost = data.mandatoryCost !== undefined ? Number(data.mandatoryCost) : undefined;
    const optionalCostMin = data.optionalCostMin !== undefined ? Number(data.optionalCostMin) : undefined;
    const optionalCostMax = data.optionalCostMax !== undefined ? Number(data.optionalCostMax) : undefined;

    const popularity = data.popularity !== undefined ? Number(data.popularity) : undefined;
    const budgetFriendliness = data.budgetFriendliness !== undefined ? Number(data.budgetFriendliness) : undefined;
    const conversation = data.conversation !== undefined ? Number(data.conversation) : undefined;
    const groupSuitability = data.groupSuitability !== undefined ? Number(data.groupSuitability) : undefined;
    const dateSuitability = data.dateSuitability !== undefined ? Number(data.dateSuitability) : undefined;
    const friendsSuitability = data.friendsSuitability !== undefined ? Number(data.friendsSuitability) : undefined;
    const familySuitability = data.familySuitability !== undefined ? Number(data.familySuitability) : undefined;
    const weatherSuitability = data.weatherSuitability !== undefined ? Number(data.weatherSuitability) : undefined;
    const uniqueness = data.uniqueness !== undefined ? Number(data.uniqueness) : undefined;
    const experienceScore = data.experienceScore !== undefined ? Number(data.experienceScore) : undefined;
    const overall = data.overall !== undefined ? Number(data.overall) : undefined;

    // 1. Update remote D1
    if (isHangoutApiConfigured()) {
      const res = await hangoutApi<ApiResponse<void>>(`/api/admin/places/${encodeURIComponent(placeId)}`, {
        method: 'PATCH',
        body: {
          name,
          address,
          lat,
          lng,
          rating,
          reviewCount,
          isFeatured: isFeaturedVal,
          isHidden: isHiddenVal,
          boostFactor: boostFactorVal,
          mandatoryCost,
          optionalCostMin,
          optionalCostMax,
          popularity,
          budgetFriendliness,
          conversation,
          groupSuitability,
          dateSuitability,
          friendsSuitability,
          familySuitability,
          weatherSuitability,
          uniqueness,
          experienceScore,
          overall,
          categories: data.categories
        }
      });
      if (!res.success) {
        return res;
      }
    }

    // 2. Local SQLite write
    const { db } = await import('@/lib/db/client');
    const { places, placeCategories, placeCosts, placeScores } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    // Update places
    const placesSet: any = { updatedAt: now };
    if (name !== undefined) placesSet.name = name;
    if (address !== undefined) placesSet.address = address;
    if (lat !== undefined) placesSet.lat = lat;
    if (lng !== undefined) placesSet.lng = lng;
    if (rating !== undefined) placesSet.rating = rating;
    if (reviewCount !== undefined) placesSet.reviewCount = reviewCount;
    if (isFeaturedVal !== undefined) placesSet.isFeatured = isFeaturedVal;
    if (isHiddenVal !== undefined) placesSet.isHidden = isHiddenVal;
    if (boostFactorVal !== undefined) placesSet.boostFactor = boostFactorVal;

    await db.update(places).set(placesSet).where(eq(places.id, placeId));

    // Update costs
    const costsSet: any = {};
    if (mandatoryCost !== undefined) costsSet.mandatoryCost = mandatoryCost;
    if (optionalCostMin !== undefined) costsSet.optionalCostMin = optionalCostMin;
    if (optionalCostMax !== undefined) costsSet.optionalCostMax = optionalCostMax;
    if (Object.keys(costsSet).length > 0) {
      await db.update(placeCosts).set(costsSet).where(eq(placeCosts.placeId, placeId));
    }

    // Update scores
    const scoresSet: any = {};
    if (popularity !== undefined) scoresSet.popularity = popularity;
    if (budgetFriendliness !== undefined) scoresSet.budgetFriendliness = budgetFriendliness;
    if (conversation !== undefined) scoresSet.conversation = conversation;
    if (groupSuitability !== undefined) scoresSet.groupSuitability = groupSuitability;
    if (dateSuitability !== undefined) scoresSet.dateSuitability = dateSuitability;
    if (friendsSuitability !== undefined) scoresSet.friendsSuitability = friendsSuitability;
    if (familySuitability !== undefined) scoresSet.familySuitability = familySuitability;
    if (weatherSuitability !== undefined) scoresSet.weatherSuitability = weatherSuitability;
    if (uniqueness !== undefined) scoresSet.uniqueness = uniqueness;
    if (experienceScore !== undefined) scoresSet.experienceScore = experienceScore;
    if (overall !== undefined) scoresSet.overall = overall;
    if (Object.keys(scoresSet).length > 0) {
      await db.update(placeScores).set(scoresSet).where(eq(placeScores.placeId, placeId));
    }

    // Update categories
    if (data.categories !== undefined) {
      await db.delete(placeCategories).where(eq(placeCategories.placeId, placeId));
      const categories = Array.isArray(data.categories)
        ? data.categories
        : (typeof data.categories === 'string' ? data.categories.split(',').map((c: string) => c.trim()) : []);

      const { randomUUID } = await import('crypto');
      for (const cat of categories) {
        if (cat) {
          await db.insert(placeCategories).values({
            id: randomUUID(),
            placeId,
            category: cat.toUpperCase()
          });
        }
      }
    }

    return apiResponse.success(undefined);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function deletePlaceAction(placeId: string): ActionResponse<void> {
  try {
    await checkAdminAuth();

    // 1. Delete from remote D1
    if (isHangoutApiConfigured()) {
      const res = await hangoutApi<ApiResponse<void>>(`/api/admin/places/${encodeURIComponent(placeId)}`, {
        method: 'DELETE'
      });
      if (!res.success) {
        return res;
      }
    }

    // 2. Local SQLite write
    const { db } = await import('@/lib/db/client');
    const { places, placeCategories, placeCosts, placeScores, rankingMetrics } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    await db.delete(placeCategories).where(eq(placeCategories.placeId, placeId));
    await db.delete(placeCosts).where(eq(placeCosts.placeId, placeId));
    await db.delete(placeScores).where(eq(placeScores.placeId, placeId));
    await db.delete(rankingMetrics).where(eq(rankingMetrics.placeId, placeId));
    await db.delete(places).where(eq(places.id, placeId));

    return apiResponse.success(undefined);
  } catch (err) {
    return apiResponse.error(err);
  }
}

