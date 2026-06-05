import { db } from '../db/client';
import { groups, groupMembers } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;

export const groupRepository = {
  async findById(id: string): Promise<Group | undefined> {
    const result = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
    return result[0];
  },

  async findByInviteCode(inviteCode: string): Promise<Group | undefined> {
    const result = await db
      .select()
      .from(groups)
      .where(eq(groups.inviteCode, inviteCode))
      .limit(1);
    return result[0];
  },

  async create(data: NewGroup): Promise<Group> {
    const result = await db.insert(groups).values(data).returning();
    if (!result[0]) {
      throw new Error('Failed to create group');
    }
    return result[0];
  },

  async update(id: string, data: Partial<Omit<NewGroup, 'id' | 'creatorId' | 'createdAt'>>): Promise<Group> {
    const result = await db.update(groups)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(groups.id, id))
      .returning();
    if (!result[0]) {
      throw new Error('Failed to update group');
    }
    return result[0];
  },

  async softDelete(id: string): Promise<void> {
    await db.update(groups)
      .set({ status: 'DELETED', updatedAt: new Date().toISOString() })
      .where(eq(groups.id, id));
  },

  async archive(id: string): Promise<void> {
    await db.update(groups)
      .set({ status: 'ARCHIVED', updatedAt: new Date().toISOString() })
      .where(eq(groups.id, id));
  },

  // Returns group + aggregate metadata
  async getGroupWithMemberCount(groupId: string): Promise<(Group & { memberCount: number }) | undefined> {
    const groupResult = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
    if (!groupResult[0]) return undefined;

    const countResult = await db
      .select({ count: sql`count(${groupMembers.userId})` })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));

    return {
      ...groupResult[0],
      memberCount: Number(countResult[0]?.count || 0),
    };
  },

  // Returns groups where user is a member
  async getUserGroups(userId: string): Promise<Group[]> {
    const result = await db
      .select({
        group: groups,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groupMembers.userId, userId),
          sql`${groups.status} != 'DELETED'`
        )
      )
      .orderBy(sql`${groups.updatedAt} DESC`);

    return result.map((r: any) => r.group);
  },
};
export type GroupRepository = typeof groupRepository;
