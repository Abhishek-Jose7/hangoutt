import { executePlanningEngineForEval } from '../src/lib/services/planner.service';
import { db } from '../src/lib/db/client';

async function main() {
  const groupData = {
    id: '29642864-cef4-41d7-be36-af7f9dab3a48',
    name: 'sapna ki mkc',
    groupType: 'FRIENDS',
    vibes: '[]',
    outingTime: '12:00 PM',
    outingDate: null
  };
  
  const presentMembers = [
    { userId: 'd7301ee3-70f5-4ab1-9e42-9e7d4fd4e43b', name: 'Abhishek Jose' },
    { userId: 'fd42d159-b76f-45db-849d-981db38eb14e', name: 'Johann Joseph' }
  ];
  
  const presentLocations = [
    { userId: 'd7301ee3-70f5-4ab1-9e42-9e7d4fd4e43b', lat: 19.0212, lng: 73.0192, locationName: 'Seawoods - Darave Railway Station' },
    { userId: 'fd42d159-b76f-45db-849d-981db38eb14e', lat: 19.2483, lng: 72.8596, locationName: 'Dahisar Railway Station' }
  ];
  
  const budgetSummary = {
    min: 900,
    avg: 950,
    max: 1000
  };
  
  const preferredCategories = ['CREATIVE', 'CHILL'];
  const vibes = [];
  const historyEntries = [];
  const lowestBudget = 900;
  
  try {
    const plans = await executePlanningEngineForEval(
      groupData,
      presentMembers,
      budgetSummary,
      presentLocations,
      preferredCategories,
      vibes,
      historyEntries,
      lowestBudget,
      []
    );
    console.log(`Generated ${plans.length} plans successfully!`);
    plans.forEach((p, i) => {
      console.log(`Plan ${i+1}: Zone=${p.name}, Score=${p.score}, cost=${p.totalEstimatedCostPerHead}`);
      p.slots.forEach(s => {
        console.log(`  - ${s.name} (${s.category}), cost=${s.estimatedCostPerHead}, isFallback=${s.isFallback}`);
      });
    });
  } catch (err) {
    console.error('Error running engine:', err);
  }
}

main().then(() => process.exit(0));
