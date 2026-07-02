// Node 18+ has global fetch, so we can just use fetch directly.

const HANGOUT_API_URL = 'https://hangout-api.hangoutt.workers.dev';
const HANGOUT_API_SECRET = '6dd3678469d5b577696e5d579b9c906bb24ec533426fa4c27381f8d45e7dc2dd';
const groupId = 'a2d96c81-6041-410d-b4d5-3137c56e798e';

async function main() {
  console.log('Querying group details from remote worker...');
  try {
    const clerkId = 'user_3Bt1C0dUXAmmHc06LgnBxCmk21D'; // Abhishek Jose
    const url = `${HANGOUT_API_URL}/groups/${groupId}?clerkId=${encodeURIComponent(clerkId)}`;
    console.log(`Fetching: ${url}`);
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${HANGOUT_API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      console.error(`HTTP Error: ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.error(text);
      return;
    }

    const payload = await res.json();
    console.log('Remote response success:', payload.success);
    if (payload.success) {
      const data = payload.data;
      console.log('Group details:', data.group);
      console.log('\nMembers count:', data.members?.length);
      data.members?.forEach(m => console.log(`Member: name=${m.name}, userId=${m.userId}, clerkId=${m.clerkId}, vibes=${m.vibes}`));
      
      console.log('\nLocations count:', data.locations?.length);
      data.locations?.forEach(l => console.log(`Location: userId=${l.userId}, lat=${l.lat}, lng=${l.lng}, name=${l.locationName}`));

      console.log('\nBudget summary:', data.budgetSummary);
      
      console.log('\nQuerying plans from remote worker...');
      const plansRes = await fetch(`${HANGOUT_API_URL}/groups/${groupId}/plans`, {
        headers: {
          'Authorization': `Bearer ${HANGOUT_API_SECRET}`,
          'Content-Type': 'application/json'
        }
      });
      if (plansRes.ok) {
        const plansPayload = await plansRes.json();
        if (plansPayload.success) {
          console.log('\nPlans count:', plansPayload.data?.length);
          plansPayload.data?.forEach(p => {
            console.log(`Plan Index: ${p.planIndex}, Name: ${p.name}, Tagline: ${p.tagline}, MeetupZone: ${p.meetupZone}, BudgetTier: ${p.budgetTier}, Cost: ${p.totalEstimatedCostPerHead}`);
            p.slots?.forEach(s => {
              console.log(`  Slot ${s.slotOrder}: ${s.name} (${s.category}), arrival: ${s.arrivalTime}, cost: ${s.estimatedCostPerHead}, img: ${s.imageUrl}`);
            });
          });
        }
      }
    }
  } catch (err) {
    console.error('Error fetching remote data:', err);
  }
}

main();
