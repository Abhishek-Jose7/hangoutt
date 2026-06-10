import { db, safeTransaction } from '../db/client';
import { groupMembers, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;

export interface MemberDetail {
  userId: string;
  clerkId: string;
  name: string;
  email: string;
  imageUrl: string | null;
  role: string;
  vibes: string | null;
  isPresent: number;
  joinedAt: string;
}

export const memberRepository = {
  async addMember(data: NewGroupMember): Promise<GroupMember> {
    const result = await db.insert(groupMembers).values(data).returning();
    if (!result[0]) {
      throw new Error('Failed to join group');
    }
    return result[0];
  },

  async removeMember(groupId: string, userId: string): Promise<void> {
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  },

  async getMember(groupId: string, userId: string): Promise<GroupMember | undefined> {
    const result = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .limit(1);
    return result[0];
  },

  async getMembersWithUserDetails(groupId: string): Promise<MemberDetail[]> {
    const result = await db
      .select({
        userId: users.id,
        clerkId: users.clerkId,
        name: users.name,
        email: users.email,
        imageUrl: users.imageUrl,
        role: groupMembers.role,
        vibes: groupMembers.vibes,
        isPresent: groupMembers.isPresent,
        joinedAt: groupMembers.createdAt,
      })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId));

    return result as MemberDetail[];
  },

  async updateMemberPresence(groupId: string, userId: string, isPresent: boolean): Promise<GroupMember> {
    const result = await db
      .update(groupMembers)
      .set({ isPresent: isPresent ? 1 : 0 })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .returning();
    if (!result[0]) {
      throw new Error('Failed to update member presence');
    }
    return result[0];
  },

  async updateVibes(groupId: string, userId: string, vibes: string[]): Promise<GroupMember> {
    const result = await db
      .update(groupMembers)
      .set({ vibes: JSON.stringify(vibes) })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .returning();
    if (!result[0]) {
      throw new Error('Failed to update member vibes');
    }
    return result[0];
  },

  async updateRole(groupId: string, userId: string, role: 'ADMIN' | 'MEMBER'): Promise<GroupMember> {
    const result = await db
      .update(groupMembers)
      .set({ role })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .returning();
    if (!result[0]) {
      throw new Error('Failed to update member role');
    }
    return result[0];
  },

  async transferOwnership(groupId: string, currentOwnerId: string, newOwnerId: string): Promise<void> {
    // Atomically swap roles inside a transaction
    await safeTransaction(async (tx: any) => {
      await tx
        .update(groupMembers)
        .set({ role: 'MEMBER' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentOwnerId)));

      await tx
        .update(groupMembers)
        .set({ role: 'ADMIN' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, newOwnerId)));
    });
  },
};
export type MemberRepository = typeof memberRepository;
