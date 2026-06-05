import { db } from '../db/client';
import { plans, planSlots } from '../db/schema';
import { eq } from 'drizzle-orm';

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanSlot = typeof planSlots.$inferSelect;
export type NewPlanSlot = typeof planSlots.$inferInsert;

export interface PlanWithSlots extends Plan {
  slots: PlanSlot[];
}

export const planRepository = {
  // Saves generated plans and slots atomically in a transaction
  async savePlans(groupPlans: NewPlan[], slots: NewPlanSlot[]): Promise<void> {
    await db.transaction(async (tx: any) => {
      // 1. Insert plans
      if (groupPlans.length > 0) {
        await tx.insert(plans).values(groupPlans);
      }
      
      // 2. Insert slots
      if (slots.length > 0) {
        // Bulk insert slots
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

    // 2. Fetch all slots for these plans
    const planIds = groupPlans.map((p: any) => p.id);
    const slots = await db
      .select()
      .from(planSlots)
      .where(sql`plan_id IN (${sql.join(planIds.map((id: any) => sql`${id}`), sql`, `)})`) // or using inArray if drizzle-orm has it
      // Let's write a simple query:
      .orderBy(planSlots.slotOrder);

    // Group slots by planId
    const slotsMap = slots.reduce((acc: any, slot: any) => {
      if (!acc[slot.planId]) {
        acc[slot.planId] = [];
      }
      acc[slot.planId].push(slot);
      return acc;
    }, {} as Record<string, PlanSlot[]>);

    return groupPlans.map((p: any) => ({
      ...p,
      slots: slotsMap[p.id] || [],
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

    return {
      ...planResult[0],
      slots,
    };
  },

  async deletePlansForGroup(groupId: string): Promise<void> {
    // planSlots will be deleted automatically due to cascade on references
    await db.delete(plans).where(eq(plans.groupId, groupId));
  },
};

// Simple raw sql helper for Drizzle array checks if needed
import { sql } from 'drizzle-orm';
export type PlanRepository = typeof planRepository;
