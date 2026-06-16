const url = 'https://hangout-api.hangoutt.workers.dev';
const secret = '6dd3678469d5b577696e5d579b9c906bb24ec533426fa4c27381f8d45e7dc2dd';
const groupId = 'd4be5452-b0f3-4b68-920a-81200628477b';

async function testPostPlans() {
  const payload = {
    plans: [
      {
        id: 'test-plan-id-999',
        groupId: groupId,
        planIndex: 1,
        name: 'Test Plan',
        tagline: 'A test tagline',
        meetupZone: 'Ghatkopar',
        budgetTier: 'BALANCED',
        totalEstimatedCostPerHead: 1000,
        totalDurationMinutes: 180,
        score: 0.8,
        experienceScore: 0.8,
        travelScore: 0.8,
        budgetScore: 0.8,
        fairnessScore: 0.8,
        popularityScore: 0.8,
        groupTypeMatchScore: 0.8,
        vibeMatchScore: 0.8,
        compositeScore: 0.8,
        avgTrainTime: 10,
        avgCabTime: 10,
        avgTrainCost: 10,
        avgCabCost: 10,
        longestTravelTime: 10,
        shortestTravelTime: 10,
        travelFairnessScore: 1.0,
        mandatoryCost: 500,
        optionalCostMin: 100,
        optionalCostMax: 500,
        whyRecommended: '["✓ Reason 1"]',
        avgAutoTime: 10,
        avgAutoCost: 10,
        avgTotalTime: 10,
        avgTotalCost: 10,
        avgWalkTime: 10
      }
    ],
    slots: [
      {
        id: 'test-slot-id-999',
        planId: 'test-plan-id-999',
        slotOrder: 1,
        venueId: 'some-venue-id',
        name: 'Some Venue',
        category: 'CAFE',
        arrivalTime: '11:00 AM',
        durationMinutes: 90,
        travelToNextMinutes: 15,
        estimatedCostPerHead: 200,
        note: 'Some note content here'
      }
    ],
    memberTravels: [
      {
        id: 'test-travel-id-999',
        planId: 'test-plan-id-999',
        userId: 'test-user-a-123',
        trainTime: 10,
        trainCost: 10,
        cabTime: 10,
        cabCost: 10,
        walkTime: 10,
        autoTime: 10,
        autoCost: 10,
        totalTime: 10,
        totalCost: 10
      }
    ]
  };

  try {
    console.log(`POSTing plans to remote worker...`);
    const res = await fetch(`${url}/groups/${groupId}/plans`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    console.log('Response status:', res.status);
    const text = await res.text();
    console.log('Response body:', text);
  } catch (err) {
    console.error('Error:', err);
  }
}

testPostPlans();
