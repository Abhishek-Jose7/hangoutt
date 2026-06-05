import { db } from '../db/client';
import { invites } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;

export const inviteRepository = {
  async create(data: NewInvite): Promise<Invite> {
    const result = await db.insert(invites).values(data).returning();
    if (!result[0]) {
      throw new Error('Failed to create invite');
    }
    return result[0];
  },

  async findByCode(inviteCode: string): Promise<Invite | undefined> {
    const result = await db
      .select()
      .from(invites)
      .where(eq(invites.inviteCode, inviteCode))
      .limit(1);
    return result[0];
  },

  async findByGroupId(groupId: string): Promise<Invite | undefined> {
    const result = await db
      .select()
      .from(invites)
      .where(and(eq(invites.groupId, groupId), eq(invites.revoked, 0)))
      .orderBy(invites.createdAt)
      .limit(1);
    return result[0];
  },

  async revokeCode(inviteCode: string): Promise<void> {
    await db
      .update(invites)
      .set({ revoked: 1 })
      .where(eq(invites.inviteCode, inviteCode));
  },

  async revokeByGroupId(groupId: string): Promise<void> {
    await db
      .update(invites)
      .set({ revoked: 1 })
      .where(eq(invites.groupId, groupId));
  },
};

export type InviteRepository = typeof inviteRepository;
