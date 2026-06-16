import fs from 'fs';
import path from 'path';
import { plannerService } from './src/lib/services/planner.service';

// Load .env manually
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index !== -1) {
      const key = trimmed.substring(0, index).trim();
      const val = trimmed.substring(index + 1).trim();
      process.env[key] = val;
    }
  });
}

const userId = '5a7a6420-76ea-45c5-aff5-ec36e1000a76';
const groupId = 'ce6c553d-70c4-49ff-8e0e-877258e424b6';

async function testGeneration() {
  try {
    console.log('Starting itinerary generation with real Groq configuration...');
    // Clear API configurations so it runs local SQLite flow
    process.env.HANGOUT_API_URL = '';
    process.env.HANGOUT_API_SECRET = '';

    console.log('Using GROQ_API_KEY:', process.env.GROQ_API_KEY ? 'CONFIGURED (length: ' + process.env.GROQ_API_KEY.length + ')' : 'MISSING');

    const res = await plannerService.generatePlan(userId, groupId);
    console.log('SUCCESS!');
    console.log('Generated plans count:', res.plans.length);
    
    // Check for duplicate venues across all plans
    const allVenueNames = new Set<string>();
    let overlapCount = 0;

    res.plans.forEach((plan, planIdx) => {
      console.log(`\n========================================`);
      console.log(`PLAN ${planIdx + 1}: ${plan.name} (${plan.budgetTier})`);
      console.log(`Tagline: ${plan.tagline}`);
      console.log(`Meetup Zone: ${plan.meetupZone}`);
      console.log(`Score: ${plan.score} (Composite: ${plan.compositeScore})`);
      console.log(`Estimated Cost Per Head: ₹${plan.totalEstimatedCostPerHead}`);
      console.log(`  - Mandatory Cost: ₹${plan.mandatoryCost}`);
      console.log(`  - Optional Cost: ₹${plan.optionalCostMin} - ₹${plan.optionalCostMax}`);
      console.log(`Average Walk Time: ${plan.avgWalkTime} mins`);
      console.log(`Average Auto: ${plan.avgAutoTime} mins, ₹${plan.avgAutoCost}`);
      console.log(`Average Total Commute: ${plan.avgTotalTime} mins, ₹${plan.avgTotalCost}`);
      console.log(`whyRecommended:`, plan.whyRecommended);

      console.log('Slots:');
      plan.slots.forEach(s => {
        const uniqueKey = `${s.category}:${s.name}`;
        if (allVenueNames.has(uniqueKey)) {
          console.log(`  * [DUPLICATE] [${s.category}] ${s.name}`);
          overlapCount++;
        } else {
          console.log(`  * [${s.category}] ${s.name} (Cost: ₹${s.estimatedCostPerHead}, Note: ${s.note.substring(0, 50)}...)`);
          allVenueNames.add(uniqueKey);
        }
      });

      console.log('Member Travel Metrics:');
      if (plan.memberTravelMetrics && plan.memberTravelMetrics.length > 0) {
        plan.memberTravelMetrics.forEach((mt: any) => {
          console.log(`  - Member ${mt.userId.substring(0, 8)}: Auto ${mt.autoTime}m/₹${mt.autoCost}, Total Commute ${mt.totalTime}m/₹${mt.totalCost}`);
        });
      }
    });

    console.log(`\n========================================`);
    console.log(`VERIFICATION SUMMARY:`);
    console.log(`- Overlapping Venues across plans: ${overlapCount}`);
    console.log(`- Total Unique Venues recommended: ${allVenueNames.size}`);
  } catch (err) {
    console.error('Plan generation failed:', err);
  }
}

testGeneration();
