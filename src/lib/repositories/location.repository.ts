import { db } from '../db/client';
import { locations } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

export const locationRepository = {
  async upsertLocation(data: { id: string; groupId: string; userId: string; lat: number; lng: number }): Promise<Location> {
    const now = new Date().toISOString();
    const result = await db
      .insert(locations)
      .values({
        id: data.id,
        groupId: data.groupId,
        userId: data.userId,
        lat: data.lat,
        lng: data.lng,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [locations.groupId, locations.userId],
        set: {
          lat: data.lat,
          lng: data.lng,
          updatedAt: now,
        },
      })
      .returning();

    if (!result[0]) {
      throw new Error('Failed to upsert location');
    }
    return result[0];
  },

  async findByGroupAndUser(groupId: string, userId: string): Promise<Location | undefined> {
    const result = await db
      .select()
      .from(locations)
      .where(and(eq(locations.groupId, groupId), eq(locations.userId, userId)))
      .limit(1);
    return result[0];
  },

  async getGroupLocations(groupId: string): Promise<Location[]> {
    return db
      .select()
      .from(locations)
      .where(eq(locations.groupId, groupId));
  },
};
export type LocationRepository = typeof locationRepository;
