const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { generateItineraries } = require('../src/lib/groq/itineraryService');

const mockDraftPlans = [
  {
    id: 'plan_1',
    planIndex: 1,
    name: 'Bandra Outing',
    tagline: 'A nice day in Bandra',
    meetupZone: 'Bandra',
    budgetTier: 'BUDGET_FRIENDLY',
    totalEstimatedCostPerHead: 500,
    totalDurationMinutes: 180,
    score: 8.5,
    slots: [
      {
        order: 1,
        venueId: 'GOOGLE_123',
        name: 'Prithvi Cafe',
        category: 'CAFE',
        arrivalTime: '11:00 AM',
        durationMinutes: 90,
        estimatedCostPerHead: 250,
        note: 'Chill cafe',
        imageUrl: 'http://test.image'
      },
      {
        order: 2,
        venueId: 'GOOGLE_456',
        name: 'Carter Road Promenade',
        category: 'PARK',
        arrivalTime: '12:45 PM',
        durationMinutes: 90,
        estimatedCostPerHead: 0,
        note: 'Walk by the sea',
        imageUrl: 'http://test.image'
      }
    ],
    memberTravels: []
  }
];

const mockContext = {
  groupName: 'Test Group',
  groupType: 'FRIENDS',
  vibes: ['CHILL'],
  memberCount: 3,
  groupMinBudget: 500,
  groupAvgBudget: 1000,
  groupMaxBudget: 1500,
  preferredCategories: ['CAFE'],
  midpointAddress: 'Bandra',
  outingDate: '2026-07-02',
  outingTime: '11:00 AM',
  venues: [],
  experiences: []
};

async function test() {
  console.log('Testing Groq generation...');
  try {
    const res = await generateItineraries(mockDraftPlans, mockContext);
    console.log('Success! Result:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error in Groq:', err);
  }
}

test();
