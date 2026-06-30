export interface MemberLocation {
  lat: number;
  lng: number;
  label: string;
}

export interface Scenario {
  id: string;
  groupSize: number;
  locations: MemberLocation[];
  locationSetName: string;
  budget: number;
  outingTime: string;
  outingTimeLabel: string;
  groupType: 'DATE' | 'FRIENDS' | 'FAMILY' | 'WORK';
  preferences: string[];
  preferenceLabel: string;
  weather: 'sunny' | 'rainy';
}

const GROUP_SIZES = [2, 3, 4, 6, 8];

const LOCATION_SETS: { name: string; locs: MemberLocation[] }[] = [
  // Same-area groups — each person in the same neighbourhood
  {
    name: 'Same-Bandra',
    locs: [
      { lat: 19.0596, lng: 72.8295, label: 'Bandra' },
      { lat: 19.0620, lng: 72.8310, label: 'Bandra2' },
    ],
  },
  {
    name: 'Same-Andheri',
    locs: [
      { lat: 19.1136, lng: 72.8697, label: 'Andheri' },
      { lat: 19.1150, lng: 72.8680, label: 'Andheri2' },
    ],
  },
  {
    name: 'Same-Borivali',
    locs: [
      { lat: 19.2290, lng: 72.8570, label: 'Borivali' },
      { lat: 19.2310, lng: 72.8590, label: 'Borivali2' },
    ],
  },
  {
    name: 'Same-SouthMumbai',
    locs: [
      { lat: 18.9345, lng: 72.8272, label: 'Churchgate' },
      { lat: 18.9400, lng: 72.8350, label: 'Colaba' },
    ],
  },
  {
    name: 'Same-Mahalakshmi',
    locs: [
      { lat: 18.9798, lng: 72.8167, label: 'Mahalakshmi' },
      { lat: 18.9820, lng: 72.8190, label: 'LowerParel' },
    ],
  },
  {
    name: 'Same-Sewri',
    locs: [
      { lat: 19.0089, lng: 72.8600, label: 'Sewri' },
      { lat: 19.0263, lng: 72.8631, label: 'Wadala' },
    ],
  },
  {
    name: 'Same-Dadar',
    locs: [
      { lat: 19.0178, lng: 72.8478, label: 'Dadar' },
      { lat: 19.0292, lng: 72.8457, label: 'Matunga' },
    ],
  },
  {
    name: 'Same-Ghatkopar',
    locs: [
      { lat: 19.0860, lng: 72.9082, label: 'Ghatkopar' },
      { lat: 19.0607, lng: 72.8826, label: 'Kurla' },
    ],
  },
  {
    name: 'Same-Mulund',
    locs: [
      { lat: 19.1724, lng: 72.9596, label: 'Mulund' },
      { lat: 19.1519, lng: 72.9396, label: 'Bhandup' },
    ],
  },
  // Navi Mumbai clusters
  {
    name: 'NaviMumbai-Vashi',
    locs: [
      { lat: 19.0745, lng: 72.9978, label: 'Vashi' },
      { lat: 19.0630, lng: 72.9998, label: 'Sanpada' },
    ],
  },
  {
    name: 'NaviMumbai-Nerul',
    locs: [
      { lat: 19.0341, lng: 73.0198, label: 'Nerul' },
      { lat: 19.0212, lng: 73.0192, label: 'Seawoods' },
    ],
  },
  {
    name: 'NaviMumbai-CBD',
    locs: [
      { lat: 19.0180, lng: 73.0392, label: 'Belapur' },
      { lat: 19.0460, lng: 73.0680, label: 'Kharghar' },
    ],
  },
  {
    name: 'Thane',
    locs: [
      { lat: 19.2183, lng: 72.9781, label: 'Thane' },
      { lat: 19.2200, lng: 72.9760, label: 'Thane2' },
    ],
  },
  // Mixed groups spanning suburbs
  {
    name: 'Mixed-WestSuburbs',
    locs: [
      { lat: 19.1136, lng: 72.8697, label: 'Andheri' },
      { lat: 19.0596, lng: 72.8295, label: 'Bandra' },
      { lat: 19.0990, lng: 72.8486, label: 'VileParle' },
    ],
  },
  {
    name: 'Mixed-NorthSouth',
    locs: [
      { lat: 19.2290, lng: 72.8570, label: 'Borivali' },
      { lat: 19.0596, lng: 72.8295, label: 'Bandra' },
      { lat: 18.9345, lng: 72.8272, label: 'Churchgate' },
    ],
  },
  {
    name: 'Mixed-EastWest',
    locs: [
      { lat: 19.1136, lng: 72.8697, label: 'Andheri' },
      { lat: 19.0860, lng: 72.9082, label: 'Ghatkopar' },
      { lat: 19.0596, lng: 72.8295, label: 'Bandra' },
    ],
  },
  {
    name: 'Mixed-NaviMumbai-City',
    locs: [
      { lat: 19.0745, lng: 72.9978, label: 'Vashi' },
      { lat: 19.0607, lng: 72.8826, label: 'Kurla' },
      { lat: 19.0596, lng: 72.8295, label: 'Bandra' },
    ],
  },
  {
    name: 'SpreadAcrossMumbai',
    locs: [
      { lat: 19.2290, lng: 72.8570, label: 'Borivali' },
      { lat: 19.0745, lng: 72.9978, label: 'Vashi' },
      { lat: 19.0596, lng: 72.8295, label: 'Bandra' },
      { lat: 19.2183, lng: 72.9781, label: 'Thane' },
    ],
  },
];

const BUDGETS = [500, 750, 1000, 1500, 2000, 2500, 4000, 5000];

const OUTING_TIMES: { label: string; time: string }[] = [
  { label: 'Morning', time: '10:00' },
  { label: 'Afternoon', time: '14:00' },
  { label: 'EarlyEvening', time: '17:30' },
  { label: 'Evening', time: '19:30' },
];

const GROUP_TYPES: Scenario['groupType'][] = ['DATE', 'FRIENDS', 'FAMILY', 'WORK'];

const PREFERENCE_SETS: { label: string; cats: string[] }[] = [
  { label: 'FoodFocused', cats: ['CAFE', 'RESTAURANT', 'DESSERT'] },
  { label: 'Adventure', cats: ['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS'] },
  { label: 'Cultural', cats: ['MUSEUM', 'PARK'] },
  { label: 'CafesOnly', cats: ['CAFE', 'DESSERT'] },
  { label: 'Shopping', cats: ['MALL'] },
  { label: 'Mixed', cats: ['CAFE', 'ARCADE', 'MUSEUM', 'PARK', 'RESTAURANT'] },
];

const WEATHER: Scenario['weather'][] = ['sunny', 'rainy'];

// Deterministic seeded pseudo-random number generator (mulberry32)
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateScenarios(target = 750): Scenario[] {
  const rand = mulberry32(42); // Fixed seed for reproducibility

  // Build full cross-product
  const all: Scenario[] = [];
  let idx = 0;
  for (const groupSize of GROUP_SIZES) {
    for (const locSet of LOCATION_SETS) {
      for (const budget of BUDGETS) {
        for (const { label: tLabel, time } of OUTING_TIMES) {
          for (const groupType of GROUP_TYPES) {
            for (const { label: pLabel, cats } of PREFERENCE_SETS) {
              for (const weather of WEATHER) {
                // Scale locations to group size
                const locs: MemberLocation[] = [];
                for (let i = 0; i < groupSize; i++) {
                  locs.push(locSet.locs[i % locSet.locs.length]);
                }

                all.push({
                  id: `s${++idx}`,
                  groupSize,
                  locations: locs,
                  locationSetName: locSet.name,
                  budget,
                  outingTime: time,
                  outingTimeLabel: tLabel,
                  groupType,
                  preferences: cats,
                  preferenceLabel: pLabel,
                  weather,
                });
              }
            }
          }
        }
      }
    }
  }

  // Shuffle and sample target count
  const shuffled = shuffle(all, rand);
  return shuffled.slice(0, Math.min(target, shuffled.length));
}
