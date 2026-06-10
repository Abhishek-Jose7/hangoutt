import { db, safeTransaction } from '../db/client';
import { plans, planSlots, memberTravelMetrics } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanSlot = typeof planSlots.$inferSelect;
export type NewPlanSlot = typeof planSlots.$inferInsert;
export type MemberTravelMetric = typeof memberTravelMetrics.$inferSelect;

export interface PlanWithSlots extends Plan {
  slots: PlanSlot[];
  memberTravelMetrics?: MemberTravelMetric[];
}

export const planRepository = {
  // Saves generated plans, slots, and travel metrics atomically in a transaction
  async savePlans(groupPlans: NewPlan[], slots: NewPlanSlot[]): Promise<void> {
    await safeTransaction(async (tx: any) => {
      // 1. Insert plans
      if (groupPlans.length > 0) {
        await tx.insert(plans).values(groupPlans);
      }
      
      // 2. Insert slots
      if (slots.length > 0) {
        await tx.insert(planSlots).values(slots);
      }
    });
  },

  async getPlansForGroup(groupId: string): Promise<PlanWithSlots[]> {
    // 1. Fetch plans
    const groupPlans = await db
      .select()
      .from(plans)
      .where(eq(plans.groupId, groupId))
      .orderBy(plans.planIndex);

    if (groupPlans.length === 0) return [];

    const planIds = groupPlans.map((p: any) => p.id);

    // 2. Fetch all slots for these plans
    const slots = await db
      .select()
      .from(planSlots)
      .where(sql`plan_id IN (${sql.join(planIds.map((id: any) => sql`${id}`), sql`, `)})`)
      .orderBy(planSlots.slotOrder);

    // Group slots by planId
    const slotsMap = slots.reduce((acc: any, slot: any) => {
      if (!acc[slot.planId]) {
        acc[slot.planId] = [];
      }
      acc[slot.planId].push(slot);
      return acc;
    }, {} as Record<string, PlanSlot[]>);

    // 3. Fetch member travel metrics for these plans
    const travelMetrics = await db
      .select()
      .from(memberTravelMetrics)
      .where(sql`plan_id IN (${sql.join(planIds.map((id: any) => sql`${id}`), sql`, `)})`);

    // Group travel metrics by planId
    const travelMetricsMap = travelMetrics.reduce((acc: any, metric: any) => {
      if (!acc[metric.planId]) {
        acc[metric.planId] = [];
      }
      acc[metric.planId].push(metric);
      return acc;
    }, {} as Record<string, MemberTravelMetric[]>);

    return groupPlans.map((p: any) => ({
      ...p,
      slots: slotsMap[p.id] || [],
      memberTravelMetrics: travelMetricsMap[p.id] || [],
    }));
  },

  async getPlanWithSlots(planId: string): Promise<PlanWithSlots | undefined> {
    const planResult = await db
      .select()
      .from(plans)
      .where(eq(plans.id, planId))
      .limit(1);
    
    if (!planResult[0]) return undefined;

    const slots = await db
      .select()
      .from(planSlots)
      .where(eq(planSlots.planId, planId))
      .orderBy(planSlots.slotOrder);

    const travelMetrics = await db
      .select()
      .from(memberTravelMetrics)
      .where(eq(memberTravelMetrics.planId, planId));

    return {
      ...planResult[0],
      slots,
      memberTravelMetrics,
    };
  },

  async deletePlansForGroup(groupId: string): Promise<void> {
    // planSlots will be deleted automatically due to cascade on references
    await db.delete(plans).where(eq(plans.groupId, groupId));
  },
};

export type PlanRepository = typeof planRepository;
