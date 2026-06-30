const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');
let secret = '';
let apiUrl = '';

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const matchSecret = envContent.match(/^HANGOUT_API_SECRET\s*=\s*(.+)$/m);
  if (matchSecret) secret = matchSecret[1].trim();
  const matchUrl = envContent.match(/^HANGOUT_API_URL\s*=\s*(.+)$/m);
  if (matchUrl) apiUrl = matchUrl[1].trim();
}

if (!apiUrl.startsWith('http')) {
  apiUrl = 'https://' + apiUrl;
}

const groupId = 'f5986305-18be-4c06-96b7-cc0eff103a09';

async function run() {
  const planId = 'test-plan-id-' + Math.random().toString(36).substring(2);
  const mockPlan = {
    id: planId,
    groupId: groupId,
    planIndex: 1,
    name: 'Test Plan Name',
    tagline: 'Test Plan Tagline',
    meetupZone: 'Bandra',
    budgetTier: 'BALANCED',
    totalEstimatedCostPerHead: 500,
    totalDurationMinutes: 180,
    score: 8.5,
    experienceScore: 1.0,
    travelScore: 1.0,
    budgetScore: 1.0,
    fairnessScore: 1.0,
    popularityScore: 1.0,
    groupTypeMatchScore: 1.0,
    vibeMatchScore: 1.0,
    compositeScore: 8.5,
    avgTrainTime: 30,
    avgCabTime: 40,
    avgTrainCost: 10,
    avgCabCost: 150,
    longestTravelTime: 60,
    shortestTravelTime: 20,
    travelFairnessScore: 0.9,
    mandatoryCost: 300,
    optionalCostMin: 100,
    optionalCostMax: 200,
    whyRecommended: JSON.stringify(['Affordable', 'Near center']),
    avgAutoTime: 10,
    avgAutoCost: 30,
    avgTotalTime: 40,
    avgTotalCost: 180,
    avgWalkTime: 10,
    generatedAt: new Date().toISOString()
  };

  const newGooglePlaceId = 'GOOGLE_brand_new_place_id_' + Math.random().toString(36).substring(2);

  // 1. Real Google place that was reactively fetched and is NOT in D1 yet
  const mockVenue = {
    id: newGooglePlaceId,
    name: 'Brand New Dynamic Cafe',
    address: 'Near Bandra Station West',
    lat: 19.0596,
    lng: 72.8295,
    rating: 4.5,
    reviewCount: 35,
    category: 'CAFE',
    mandatoryCost: 150,
    optionalCostMin: 100,
    optionalCostMax: 250,
    imageUrl: 'http://test.image/cafe',
    link: 'http://test.link/cafe'
  };

  const mockSlot1 = {
    id: 'test-slot-id-1-' + Math.random().toString(36).substring(2),
    planId: planId,
    slotOrder: 1,
    venueId: newGooglePlaceId, // references the new venue that should be auto-inserted
    experienceId: null,
    venueName: 'Brand New Dynamic Cafe',
    name: 'Enjoy Coffee',
    category: 'CAFE',
    arrivalTime: '14:00',
    durationMinutes: 90,
    travelToNextMinutes: 15,
    estimatedCostPerHead: 250,
    note: 'Great coffee',
    travelToNextCost: 20,
    imageUrl: 'http://test.image/cafe',
    link: 'http://test.link/cafe'
  };

  const mockSlot2 = {
    id: 'test-slot-id-2-' + Math.random().toString(36).substring(2),
    planId: planId,
    slotOrder: 2,
    venueId: 'fb_park_1', // fallback ID (should be set to NULL by worker to avoid FK errors)
    experienceId: null,
    venueName: 'Bandra Promenade',
    name: 'Walk at Bandra Promenade',
    category: 'PARK',
    arrivalTime: '15:45',
    durationMinutes: 60,
    travelToNextMinutes: null,
    estimatedCostPerHead: 0,
    note: 'Relaxing view',
    travelToNextCost: null,
    imageUrl: 'http://test.image/park',
    link: 'http://test.link/park'
  };

  const mockTravel = {
    id: 'test-travel-id-' + Math.random().toString(36).substring(2),
    planId: planId,
    userId: 'd7301ee3-70f5-4ab1-9e42-9e7d4fd4e43b', // Creator ID
    trainTime: 20,
    trainCost: 5,
    cabTime: 15,
    cabCost: 100,
    walkTime: 5,
    autoTime: 15,
    autoCost: 100,
    totalTime: 40,
    totalCost: 105
  };

  console.log(`Sending test payload with venues to: ${apiUrl}/groups/${groupId}/plans`);

  const response = await fetch(`${apiUrl}/groups/${groupId}/plans`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plans: [mockPlan],
      slots: [mockSlot1, mockSlot2],
      memberTravels: [mockTravel],
      venues: [mockVenue],
      generationOptions: []
    })
  });

  console.log(`Response Status: ${response.status}`);
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    console.log('Response Payload:', JSON.stringify(payload, null, 2));
  } catch (err) {
    console.log('Raw Response (HTML/Text):', text.substring(0, 1000));
  }
}

run().catch(console.error);
