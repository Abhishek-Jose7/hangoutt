import { db } from '../db/client';
import { invites } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

function normalizeInviteCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[IL1]/g, 'L')
    .replace(/[O0]/g, '0');
}

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
    // 1. Try exact match first
    let result = await db
      .select()
      .from(invites)
      .where(eq(invites.inviteCode, inviteCode))
      .limit(1);
    if (result[0]) return result[0];

    // 2. Try case-insensitive exact match
    result = await db
      .select()
      .from(invites)
      .where(sql`lower(${invites.inviteCode}) = lower(${inviteCode})`)
      .limit(1);
    if (result[0]) return result[0];

    // 3. Fallback: retrieve all non-revoked invites and do a confusable-tolerant match in memory
    const activeInvites = await db
      .select()
      .from(invites)
      .where(eq(invites.revoked, 0));
    
    const targetNormalized = normalizeInviteCode(inviteCode);
    const matched = activeInvites.find(
      (inv: Invite) => normalizeInviteCode(inv.inviteCode) === targetNormalized
    );
    return matched;
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
