import 'server-only';
import { Venue, VenueCategory } from '../types/planner.types';
import { experienceRepository, type Experience } from '../repositories/experience.repository';
import { rankVenues, rankExperiences } from '../algorithms/scoring';
import { db } from '../db/client';
import { venuesCache } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { searchNearbyVenues } from '../maps/places';
import { getHaversineDistance } from '../algorithms/zoneSelection';

// Helper to round coordinate to 2 decimal places (approx 1.1km grid spacing)
function getCacheKey(category: string, lat: number, lng: number): string {
  return `${category}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

export const recommendationService = {
  // 1. Venue Engine: Search, Cache, and Rank nearby venues
  async getRecommendedVenues(
    lat: number,
    lng: number,
    minBudget: number,
    avgBudget: number,
    preferredCategories: VenueCategory[]
  ): Promise<Venue[]> {
    const categories: VenueCategory[] = [
      'CAFE', 'RESTAURANT', 'PARK', 'ARCADE', 'BOWLING', 
      'ESCAPE_ROOM', 'MOVIE', 'MALL', 'DESSERT', 'SPORTS', 'MUSEUM'
    ];

    const allCandidates: Venue[] = [];

    const categoryPromises = categories.map(async (category) => {
      const cacheKey = getCacheKey(category, lat, lng);
      
      // Try DB cache first
      let cachedData: string | null = null;
      try {
        const cacheRecord = await db
          .select()
          .from(venuesCache)
          .where(
            and(
              eq(venuesCache.cacheKey, cacheKey),
              sql`expires_at > ${Math.floor(Date.now() / 1000)}`
            )
          )
          .limit(1);
        if (cacheRecord[0]) {
          cachedData = cacheRecord[0].data;
        }
      } catch (err) {
        console.error('Error checking venues cache:', err);
      }

      let categoryVenues: Venue[] = [];
      if (cachedData) {
        try {
          categoryVenues = JSON.parse(cachedData);
        } catch (err) {
          console.error('Error parsing cached venues:', err);
        }
      } else {
        // Cache miss -> call Ola Maps Nearby Search
        try {
          const olaResults = await searchNearbyVenues(lat, lng, category);
          if (olaResults && olaResults.length > 0) {
            categoryVenues = olaResults.map((item: any, index: number) => {
              const venueLat = item.geometry?.location?.lat || lat;
              const venueLng = item.geometry?.location?.lng || lng;
              const dist = getHaversineDistance({ lat, lng }, { lat: venueLat, lng: venueLng });
              
              let cost = 300;
              if (category === 'RESTAURANT') cost = 600;
              else if (category === 'CAFE') cost = 250;
              else if (category === 'DESSERT') cost = 150;
              else if (category === 'PARK') cost = 0;
              else if (category === 'ARCADE' || category === 'BOWLING') cost = 400;
              else if (category === 'ESCAPE_ROOM') cost = 700;

              return {
                id: item.place_id || `ola_${category}_${index}`,
                name: item.name || item.structured_formatting?.main_text || 'Local Venue',
                category: category,
                rating: item.rating || null,
                distanceKm: Number(dist.toFixed(2)),
                estimatedCostPerHead: cost,
                openNow: item.opening_hours?.open_now ?? true,
                address: item.vicinity || item.formatted_address || item.description || item.structured_formatting?.secondary_text || '',
              };
            });
          }
        } catch (err) {
          console.error(`Ola Nearby search failed for ${category}:`, err);
        }

        // No mock fallback allowed to ensure we never invent businesses.

        // Write to DB cache (1-hour TTL)
        try {
          const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : require('crypto').randomUUID();

          const expiresAt = Math.floor(Date.now() / 1000) + 3600;

          await db
            .insert(venuesCache)
            .values({
              id: uuid,
              category,
              lat,
              lng,
              cacheKey,
              data: JSON.stringify(categoryVenues),
              expiresAt,
            })
            .onConflictDoUpdate({
              target: venuesCache.cacheKey,
              set: {
                data: JSON.stringify(categoryVenues),
                expiresAt,
              },
            });
        } catch (err) {
          console.error('Error writing to venues cache:', err);
        }
      }

      return categoryVenues;
    });

    const results = await Promise.all(categoryPromises);
    for (const categoryVenues of results) {
      allCandidates.push(...categoryVenues);
    }

    // Rank candidate venues using the 4-factor formula
    const ranked = rankVenues(
      allCandidates,
      avgBudget,
      minBudget,
      preferredCategories as string[]
    );

    // Return top 15 shortlisted venues
    return ranked.slice(0, 15);
  },

  // 2. Experience Engine: Retrieve, Filter, and Rank local events/activities
  async getRecommendedExperiences(
    city: string,
    lat: number,
    lng: number,
    groupType: 'FRIENDS' | 'DATE' | 'FAMILY' | 'WORK' | 'CUSTOM',
    vibes: string[],
    maxBudget: number,
    preferredCategories: string[],
    history: any[] = [],
    outingDate?: string | null
  ): Promise<(Experience & { distanceKm: number; score: number })[]> {
    // Fetch experiences near midpoint from the catalog
    const catalogExperiences = await experienceRepository.findExperiencesNearMidpoint(
      city,
      lat,
      lng,
      15 // 15km search radius
    );

    // Empty catalog stays empty. Never fabricate event names, dates, prices,
    // or example.com booking links when no verified listing exists.

    // Filters out experiences exceeding the group's maxBudget cap
    let budgetFiltered = catalogExperiences.filter(e => e.ticketPrice <= maxBudget);

    // Enforce date schedule checks for non-recurring experiences
    if (outingDate) {
      const outingDateStr = outingDate.split('T')[0];
      budgetFiltered = budgetFiltered.filter(e => {
        if (e.isRecurring === 1) return true;
        const startStr = e.startDate.split('T')[0];
        const endStr = e.endDate.split('T')[0];
        const isAvailable = outingDateStr >= startStr && outingDateStr <= endStr;
        if (!isAvailable) {
          console.log(`[VENUE REJECTED] "${e.title}" | Reason: Closed (outing date ${outingDateStr} is outside event range ${startStr} to ${endStr})`);
        }
        return isAvailable;
      });
    }

    // Rank candidate experiences using the 8-factor formula
    const ranked = rankExperiences(
      budgetFiltered,
      groupType,
      vibes,
      maxBudget,
      preferredCategories,
      history,
      outingDate || new Date().toISOString(),
      false // default to clear weather (can inject real weather later)
    );

    // Return top 15 shortlisted experiences
    return ranked.slice(0, 15);
  },
};

export type RecommendationService = typeof recommendationService;
