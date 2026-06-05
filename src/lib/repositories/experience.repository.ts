import { db } from '../db/client';
import { experiences, experienceCategories, experienceSources, experienceCache } from '../db/schema';
import { eq, and, lte, sql } from 'drizzle-orm';

export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
export type ExperienceCategory = typeof experienceCategories.$inferSelect;
export type NewExperienceCategory = typeof experienceCategories.$inferInsert;
export type ExperienceSource = typeof experienceSources.$inferSelect;
export type NewExperienceSource = typeof experienceSources.$inferInsert;

export const experienceRepository = {
  // Category CRUD
  async createCategory(data: NewExperienceCategory): Promise<ExperienceCategory> {
    const result = await db.insert(experienceCategories).values(data).returning();
    if (!result[0]) throw new Error('Failed to create category');
    return result[0];
  },

  async findCategories(): Promise<ExperienceCategory[]> {
    return db.select().from(experienceCategories);
  },

  // Source CRUD
  async createSource(data: NewExperienceSource): Promise<ExperienceSource> {
    const result = await db.insert(experienceSources).values(data).returning();
    if (!result[0]) throw new Error('Failed to create source');
    return result[0];
  },

  async findSources(): Promise<ExperienceSource[]> {
    return db.select().from(experienceSources);
  },

  async updateSourceFetch(id: string, totalRecords: number): Promise<void> {
    await db
      .update(experienceSources)
      .set({
        lastFetchedAt: new Date().toISOString(),
        totalRecords,
      })
      .where(eq(experienceSources.id, id));
  },

  // Experience CRUD
  async upsertExperience(data: NewExperience): Promise<Experience> {
    const now = new Date().toISOString();
    const result = await db
      .insert(experiences)
      .values({ ...data, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: experiences.id,
        set: {
          title: data.title,
          description: data.description,
          category: data.category,
          city: data.city,
          latitude: data.latitude,
          longitude: data.longitude,
          startDate: data.startDate,
          endDate: data.endDate,
          ticketPrice: data.ticketPrice,
          capacity: data.capacity,
          source: data.source,
          sourceUrl: data.sourceUrl,
          imageUrl: data.imageUrl,
          rating: data.rating,
          popularityScore: data.popularityScore,
          isRecurring: data.isRecurring,
          updatedAt: now,
        },
      })
      .returning();

    if (!result[0]) throw new Error('Failed to upsert experience');
    return result[0];
  },

  async findExperienceById(id: string): Promise<Experience | undefined> {
    const result = await db.select().from(experiences).where(eq(experiences.id, id)).limit(1);
    return result[0];
  },

  // Distance search helper (Haversine distance calculated in memory for SQLite compatibility)
  async findExperiencesNearMidpoint(
    city: string,
    lat: number,
    lng: number,
    maxRadiusKm: number,
    startAfter?: string
  ): Promise<(Experience & { distanceKm: number })[]> {
    let query = db.select().from(experiences).where(eq(experiences.city, city));
    
    // SQLite doesn't natively support dynamic trig functions like COS/SIN in standard D1 without custom functions.
    // So we load city candidates and filter in memory, which is fast and robust on serverless edge for typical candidate sets.
    const candidates = await query;

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371; // Radius of earth in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    return candidates
      .map((exp: Experience) => ({
        ...exp,
        distanceKm: calculateDistance(lat, lng, exp.latitude, exp.longitude),
      }))
      .filter((exp: Experience & { distanceKm: number }) => exp.distanceKm <= maxRadiusKm)
      .sort((a: { distanceKm: number }, b: { distanceKm: number }) => a.distanceKm - b.distanceKm);
  },

  // Cache CRUD
  async getCache(cacheKey: string): Promise<string | undefined> {
    const result = await db
      .select()
      .from(experienceCache)
      .where(and(eq(experienceCache.cacheKey, cacheKey), sql`expires_at > ${new Date().toISOString()}`))
      .limit(1);
    return result[0]?.payload;
  },

  async setCache(cacheKey: string, payload: string, expiresAt: string): Promise<void> {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : require('crypto').randomUUID();

    await db
      .insert(experienceCache)
      .values({
        id,
        cacheKey,
        payload,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: experienceCache.cacheKey,
        set: {
          payload,
          expiresAt,
        },
      });
  },

  async deleteExpiredCache(): Promise<void> {
    await db.delete(experienceCache).where(sql`expires_at <= ${new Date().toISOString()}`);
  },

  async deleteExpiredExperiences(): Promise<void> {
    await db.delete(experiences).where(
      and(
        eq(experiences.isRecurring, 0),
        lte(experiences.endDate, new Date().toISOString())
      )
    );
  },
};

export type ExperienceRepository = typeof experienceRepository;
