import { db } from '../db/client';
import { votes } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

export type Vote = typeof votes.$inferSelect;
export type NewVote = typeof votes.$inferInsert;

export interface VoteTally {
  planId: string;
  count: number;
}

export const voteRepository = {
  async upsertVote(data: { id: string; groupId: string; userId: string; planId: string }): Promise<Vote> {
    const now = new Date().toISOString();
    const result = await db
      .insert(votes)
      .values({
        id: data.id,
        groupId: data.groupId,
        userId: data.userId,
        planId: data.planId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [votes.groupId, votes.userId],
        set: {
          planId: data.planId,
          updatedAt: now,
        },
      })
      .returning();

    if (!result[0]) {
      throw new Error('Failed to upsert vote');
    }
    return result[0];
  },

  async findByGroupAndUser(groupId: string, userId: string): Promise<Vote | undefined> {
    const result = await db
      .select()
      .from(votes)
      .where(and(eq(votes.groupId, groupId), eq(votes.userId, userId)))
      .limit(1);
    return result[0];
  },

  async countVotes(groupId: string): Promise<VoteTally[]> {
    const result = await db
      .select({
        planId: votes.planId,
        count: sql`COUNT(${votes.userId})`,
      })
      .from(votes)
      .where(eq(votes.groupId, groupId))
      .groupBy(votes.planId);

    return result.map((r: any) => ({
      planId: r.planId,
      count: Number(r.count || 0),
    }));
  },

  async clearGroupVotes(groupId: string): Promise<void> {
    await db.delete(votes).where(eq(votes.groupId, groupId));
  },

  async getVotesForGroup(groupId: string): Promise<Vote[]> {
    return db.select().from(votes).where(eq(votes.groupId, groupId));
  },
};
export type VoteRepository = typeof voteRepository;
