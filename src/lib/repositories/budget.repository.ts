import { db } from '../db/client';
import { budgets, groupMembers } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

export interface BudgetSummary {
  min: number;
  avg: number;
  max: number;
  total: number;
  submittedCount: number;
  totalMembers: number;
}

export const budgetRepository = {
  async upsertBudget(data: { id: string; groupId: string; userId: string; maxBudget: number }): Promise<Budget> {
    const now = new Date().toISOString();
    const result = await db
      .insert(budgets)
      .values({
        id: data.id,
        groupId: data.groupId,
        userId: data.userId,
        maxBudget: data.maxBudget,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [budgets.groupId, budgets.userId],
        set: {
          maxBudget: data.maxBudget,
          updatedAt: now,
        },
      })
      .returning();

    if (!result[0]) {
      throw new Error('Failed to upsert budget');
    }
    return result[0];
  },

  async findByGroupAndUser(groupId: string, userId: string): Promise<Budget | undefined> {
    const result = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.groupId, groupId), eq(budgets.userId, userId)))
      .limit(1);
    return result[0];
  },

  async getGroupBudgetSummary(groupId: string): Promise<BudgetSummary> {
    // 1. Fetch aggregate metrics of submitted budgets
    const aggregateResult = await db
      .select({
        min: sql`MIN(${budgets.maxBudget})`,
        avg: sql`AVG(${budgets.maxBudget})`,
        max: sql`MAX(${budgets.maxBudget})`,
        total: sql`SUM(${budgets.maxBudget})`,
        submittedCount: sql`COUNT(${budgets.userId})`,
      })
      .from(budgets)
      .where(eq(budgets.groupId, groupId));

    // 2. Fetch total member count
    const memberCountResult = await db
      .select({
        count: sql`COUNT(${groupMembers.userId})`,
      })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));

    const agg = aggregateResult[0] || {};
    const totalMembers = Number(memberCountResult[0]?.count || 0);

    return {
      min: Math.round(Number(agg.min || 0)),
      avg: Math.round(Number(agg.avg || 0)),
      max: Math.round(Number(agg.max || 0)),
      total: Math.round(Number(agg.total || 0)),
      submittedCount: Number(agg.submittedCount || 0),
      totalMembers,
    };
  },

  async getGroupBudgets(groupId: string): Promise<Budget[]> {
    return db.select().from(budgets).where(eq(budgets.groupId, groupId));
  },
};
export type BudgetRepository = typeof budgetRepository;
