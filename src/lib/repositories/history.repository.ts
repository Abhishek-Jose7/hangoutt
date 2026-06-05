import { db } from '../db/client';
import { history, groupMembers } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export type HistoryEntry = typeof history.$inferSelect;
export type NewHistoryEntry = typeof history.$inferInsert;

export const historyRepository = {
  async saveHistory(data: NewHistoryEntry): Promise<HistoryEntry> {
    const result = await db.insert(history).values(data).returning();
    if (!result[0]) {
      throw new Error('Failed to save outing to history');
    }
    return result[0];
  },

  async getHistoryForUser(userId: string): Promise<HistoryEntry[]> {
    const result = await db
      .select({
        entry: history,
      })
      .from(history)
      .innerJoin(groupMembers, eq(history.groupId, groupMembers.groupId))
      .where(eq(groupMembers.userId, userId))
      .orderBy(sql`${history.createdAt} DESC`);

    return result.map((r: any) => r.entry);
  },
};
export type HistoryRepository = typeof historyRepository;
