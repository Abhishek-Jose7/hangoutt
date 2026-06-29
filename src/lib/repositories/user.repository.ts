import { db } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const userRepository = {
  async findById(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  },

  async findByClerkId(clerkId: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    return result[0];
  },

  async create(data: NewUser): Promise<User> {
    const result = await db.insert(users).values(data).returning();
    if (!result[0]) {
      throw new Error('Failed to create user');
    }
    return result[0];
  },

  async update(id: string, data: Partial<Omit<NewUser, 'id' | 'clerkId' | 'createdAt'>>): Promise<User> {
    const result = await db.update(users)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id))
      .returning();
    if (!result[0]) {
      throw new Error('Failed to update user');
    }
    return result[0];
  },

  async deleteByClerkId(clerkId: string): Promise<void> {
    await db.delete(users).where(eq(users.clerkId, clerkId));
  },
};
export type UserRepository = typeof userRepository;
