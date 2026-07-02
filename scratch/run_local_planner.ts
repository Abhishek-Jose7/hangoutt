import dotenv from 'dotenv';
dotenv.config();

import { plannerService } from '../src/lib/services/planner.service';
import { hangoutApi } from '../src/lib/cloudflare/hangoutApi';

async function run() {
  const groupId = 'a2d96c81-6041-410d-b4d5-3137c56e798e';
  
  // 1. Fetch group details to get a valid admin user ID
  const clerkId = 'user_3Bt1C0dUXAmmHc06LgnBxCmk21D'; // Abhishek Jose Clerk ID
  const detailsRes = await hangoutApi<any>(`/groups/${groupId}?clerkId=${clerkId}`);
  if (!detailsRes.success) {
    console.error('Failed to fetch group details:', detailsRes.error);
    return;
  }
  
  const { group, members } = detailsRes.data;
  console.log('Group status:', group.status);
  console.log('Group members count:', members.length);
  
  const adminMember = members.find((m: any) => m.role === 'ADMIN');
  if (!adminMember) {
    console.error('No admin member found!');
    return;
  }
  
  console.log('Running plannerService.generatePlan as admin:', adminMember.name, '(clerkId:', adminMember.clerkId, ', userId:', adminMember.userId, ')');
  
  // Call generatePlan
  const result = await plannerService.generatePlan(adminMember.userId, groupId, [], { clerkId: adminMember.clerkId });
  
  console.log('\n--- Plan Generation Result ---');
  console.log('Success:', result.success);
  console.log('Number of plans returned:', result.plans?.length);
  
  result.plans?.forEach((plan, idx) => {
    console.log(`\nPlan ${idx + 1}: ${plan.name} (${plan.meetupZone})`);
    console.log(`Tagline: ${plan.tagline}`);
    console.log(`Budget Tier: ${plan.budgetTier}`);
    console.log(`Estimated Cost / Head: ₹${plan.totalEstimatedCostPerHead}`);
    console.log('Slots:');
    plan.slots?.forEach((slot: any) => {
      console.log(`  - [Order ${slot.slotOrder}] ${slot.name} (${slot.category}) | Cost: ₹${slot.estimatedCostPerHead} | Image: ${slot.imageUrl}`);
    });
  });
}

run().catch(console.error);
