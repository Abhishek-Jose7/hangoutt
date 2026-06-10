import 'server-only';
import { Venue, VenueCategory } from '../types/planner.types';
import { experienceRepository, type Experience } from '../repositories/experience.repository';
import { rankVenues, rankExperiences } from '../algorithms/scoring';
import { MOCK_VENUES } from '../utils/mockData';
import { db } from '../db/client';
import { venuesCache, experienceCategories, experienceSources } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

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

    for (const category of categories) {
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
        // Cache miss -> (In real production: call Ola Maps Nearby Search)
        // Since maps nearbysearch returns stub [] for Phase 1, we generate representative local venues from MOCK_VENUES
        const matchedMocks = MOCK_VENUES.filter(v => v.category === category);
        
        categoryVenues = matchedMocks.map((mock, index) => {
          // Perturb coordinates slightly relative to the midpoint to make distance unique
          const angle = (index * 2 * Math.PI) / matchedMocks.length;
          const randomDist = 0.2 + Math.random() * 2.0; // km
          const latDiff = (randomDist * Math.cos(angle)) / 111.32;
          const lngDiff = (randomDist * Math.sin(angle)) / (111.32 * Math.cos(lat * Math.PI / 180));

          return {
            id: `${mock.id}_nearby_${index}`,
            name: `${mock.name} (${index + 1})`,
            category: mock.category,
            rating: Number((4.0 + Math.random() * 0.9).toFixed(1)),
            distanceKm: Number(randomDist.toFixed(2)),
            estimatedCostPerHead: mock.estimatedCostPerHead,
            openNow: true,
            address: `${mock.address} (Locality ${index + 1})`,
          };
        });

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
    history: any[] = []
  ): Promise<(Experience & { distanceKm: number; score: number })[]> {
    // Fetch experiences near midpoint from the catalog
    let catalogExperiences = await experienceRepository.findExperiencesNearMidpoint(
      city,
      lat,
      lng,
      15 // 15km search radius
    );

    // If local catalog is empty, pre-populate with nice mock experience candidates
    if (catalogExperiences.length === 0) {
      const mockEvents = [
        {
          title: 'Clay Pottery Taster Session',
          description: 'Get hands-on with a private pottery wheel taster class — perfect for building shared memories.',
          category: 'POTTERY',
          ticketPrice: 250,
          source: 'INTERNAL',
          sourceUrl: 'https://example.com/pottery',
          isRecurring: true,
        },
        {
          title: 'Sunset Jazz & Wine Concert',
          description: 'An intimate sunset concert featuring modern jazz ensembles in an outdoor amphitheatre.',
          category: 'LIVE_MUSIC',
          ticketPrice: 600,
          source: 'BOOKMYSHOW',
          sourceUrl: 'https://example.com/jazz',
          isRecurring: false,
        },
        {
          title: 'Comic Con Convention',
          description: 'The annual comic books, gaming tournaments, and pop culture exhibition.',
          category: 'COMIC_CON',
          ticketPrice: 800,
          source: 'INTERNAL',
          sourceUrl: 'https://example.com/comiccon',
          isRecurring: false,
        },
        {
          title: 'Heritage Walk: Old City Walkways',
          description: 'A quiet, guided morning stroll discovering historical street murals and stories.',
          category: 'FREE_EXPERIENCE',
          ticketPrice: 0,
          source: 'INTERNAL',
          sourceUrl: 'https://example.com/heritagewalk',
          isRecurring: true,
        },
        {
          title: 'Contemporary Art Exhibition',
          description: 'A display of digital canvas works and abstract sculptures from independent local artists.',
          category: 'EXHIBITION',
          ticketPrice: 150,
          source: 'TAVILY',
          sourceUrl: 'https://example.com/art',
          isRecurring: false,
        },
      ];

      const uuid = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return require('crypto').randomUUID();
      };

      // Ensure mock categories exist to satisfy foreign key constraints
      const uniqueCats = Array.from(new Set(mockEvents.map(e => e.category)));
      for (const cat of uniqueCats) {
        try {
          await db
            .insert(experienceCategories)
            .values({ id: cat, name: cat.replace('_', ' ') })
            .onConflictDoNothing();
        } catch (e) {}
      }

      // Ensure mock sources exist to satisfy foreign key constraints
      const uniqueSources = Array.from(new Set(mockEvents.map(e => e.source)));
      for (const src of uniqueSources) {
        try {
          await db
            .insert(experienceSources)
            .values({ id: src, name: src })
            .onConflictDoNothing();
        } catch (e) {}
      }

      // Ingest these catalog experiences first
      for (const event of mockEvents) {
        const id = uuid();
        try {
          await experienceRepository.upsertExperience({
            id,
            title: event.title,
            description: event.description,
            category: event.category,
            city,
            latitude: lat + (Math.random() - 0.5) * 0.05,
            longitude: lng + (Math.random() - 0.5) * 0.05,
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
            ticketPrice: event.ticketPrice,
            source: 'INTERNAL',
            sourceUrl: event.sourceUrl,
            popularityScore: Number(Math.random().toFixed(2)),
            isRecurring: event.isRecurring ? 1 : 0,
          });
        } catch (err) {
          console.error('Error inserting mock experience:', err);
        }
      }

      catalogExperiences = await experienceRepository.findExperiencesNearMidpoint(city, lat, lng, 15);
    }

    // Filters out experiences exceeding the group's maxBudget cap
    const budgetFiltered = catalogExperiences.filter(e => e.ticketPrice <= maxBudget);

    // Rank candidate experiences using the 8-factor formula
    const ranked = rankExperiences(
      budgetFiltered,
      groupType,
      vibes,
      maxBudget,
      preferredCategories,
      history,
      new Date().toISOString(),
      false // default to clear weather (can inject real weather later)
    );

    // Return top 15 shortlisted experiences
    return ranked.slice(0, 15);
  },
};

export type RecommendationService = typeof recommendationService;
