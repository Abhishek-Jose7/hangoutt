import { db } from './src/lib/db/client';
import { groups, groupMembers, locations, budgets } from './src/lib/db/schema';

async function checkDb() {
  try {
    console.log('=== Groups ===');
    const allGroups = await db.select().from(groups);
    console.log(allGroups);

    console.log('=== Group Members ===');
    const allMembers = await db.select().from(groupMembers);
    console.log(allMembers);

    console.log('=== Budgets ===');
    const allBudgets = await db.select().from(budgets);
    console.log(allBudgets);

    console.log('=== Locations ===');
    const allLocations = await db.select().from(locations);
    console.log(allLocations);
  } catch (err) {
    console.error('Error querying DB:', err);
  }
}

checkDb();
