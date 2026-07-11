import 'server-only';
import { getNearestStation } from '../maps/geocoding';
import { groupRepository } from '../repositories/group.repository';
import { memberRepository } from '../repositories/member.repository';
import { budgetRepository } from '../repositories/budget.repository';
import { locationRepository } from '../repositories/location.repository';
import { planRepository, type PlanWithSlots } from '../repositories/plan.repository';
import { historyRepository } from '../repositories/history.repository';
import { recommendationService } from './recommendation.service';
import { generateItineraries } from '../groq/itineraryService';
import { selectCandidateZones, getHaversineDistance, LatLng, MUMBAI_ZONES } from '../algorithms/zoneSelection';
import { db, safeTransaction } from '../db/client';
import { users, groups, plans, planSlots, memberTravelMetrics, zones, places, placeCategories, placeCosts, placeScores, experiences, zoneFallbacks, rankingMetrics, featuredExperiences, discoveryQueue, apiBudget } from '../db/schema';
import { eq, sql, and, between } from 'drizzle-orm';
import { InsufficientLocationsError, NotFoundError, ValidationError, ForbiddenError } from '../errors';
import { ItineraryPromptContext, VenueCategory } from '../types/planner.types';
import { validateStatusTransition } from './group.service';
import { getVenueImageUrl, getVenueDetails, searchTextVenues, searchNearbyVenues } from '../maps/places';

function calculateMumbaiTravelBreakdown(from: LatLng, to: LatLng, outingTime?: string | null) {
  let isPeakTraffic = false;
  if (outingTime) {
    let hour = 12;
    const match24 = outingTime.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      hour = parseInt(match24[1]);
    } else {
      const match12 = outingTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (match12) {
        hour = parseInt(match12[1]);
        const ampm = match12[3].toUpperCase();
        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;
      }
    }
    // Peak hours: 8-11 AM, 5-8:30 PM
    if ((hour >= 8 && hour < 11) || (hour >= 17 && hour < 21)) {
      isPeakTraffic = true;
    }
  }

  const dist = getHaversineDistance(from, to);

  let walkingTime = 0;
  let autoTime = 0;
  let autoCost = 0;
  let trainTime = 0;
  let trainCost = 0;

  if (dist < 2) {
    walkingTime = Math.round(dist * 12);
  } else if (dist >= 2 && dist < 5) {
    // Walk (0.7 km) + Auto (dist - 0.7 km)
    walkingTime = Math.round(0.7 * 12);
    const autoDist = dist - 0.7;
    autoTime = Math.round(autoDist * (isPeakTraffic ? 6.0 : 4.0));
    autoCost = Math.round(23 + Math.max(0, autoDist - 1.5) * 15);
  } else {
    // Multi-modal: Auto to station (1.5km) + Walk (0.5km) + Train (dist - 2.5km) + Walk destination (1.0km)
    walkingTime = Math.round(1.5 * 12); // total walking distance 1.5km
    autoTime = Math.round(1.5 * (isPeakTraffic ? 6.0 : 4.0));
    autoCost = 23; // base auto fare
    const trainDist = Math.max(0, dist - 2.5);
    trainTime = Math.round(trainDist * 1.5) + 5; // 1.5 mins per km + 5 mins waiting
    trainCost = trainDist < 10 ? 10 : trainDist < 20 ? 15 : trainDist < 30 ? 20 : 30;
  }

  const totalTime = walkingTime + autoTime + trainTime;
  const totalCost = autoCost + trainCost;

  return {
    walkingTime,
    autoTime,
    autoCost,
    trainTime,
    trainCost,
    totalTime,
    totalCost
  };
}

function isVenueOpenAtTime(category: string, outingTime?: string | null): boolean {
  if (!outingTime) return true;
  let hour = 12.0;
  const match24 = outingTime.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    hour = parseInt(match24[1]) + parseInt(match24[2]) / 60.0;
  } else {
    const match12 = outingTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
      let h = parseInt(match12[1]);
      const ampm = match12[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      hour = h + parseInt(match12[2]) / 60.0;
    }
  }

  const cat = category.toUpperCase();
  if (cat === 'MUSEUM' || cat === 'ART_GALLERY' || cat === 'ART_EXHIBITION') {
    return hour >= 10.0 && hour <= 18.0; // 10 AM to 6 PM
  }
  if (cat === 'PARK') {
    return hour >= 6.0 && hour <= 19.0; // 6 AM to 7 PM
  }
  if (cat === 'WORKSHOP' || cat === 'POTTERY' || cat === 'PAINTING') {
    return hour >= 9.0 && hour <= 21.0; // 9 AM to 9 PM
  }
  if (cat === 'COMIC_CON' || cat === 'ANIME_EVENT') {
    return hour >= 10.0 && hour <= 20.0; // 10 AM to 8 PM
  }
  return true;
}

const CATEGORY_WEIGHTS: Record<string, Record<string, number>> = {
  DATE: {
    CAFE: 10, RESTAURANT: 10, DESSERT: 10, POTTERY: 9, MUSEUM: 8, ART_GALLERY: 8,
    PARK: 8, MOVIE: 6, MALL: 6, ARCADE: 5, BOWLING: 5, ESCAPE_ROOM: 5, SPORTS: 5
  },
  FRIENDS: {
    BOWLING: 10, ARCADE: 10, ESCAPE_ROOM: 9, SPORTS: 9, CAFE: 8, RESTAURANT: 8, DESSERT: 8,
    MOVIE: 7, MALL: 7, POTTERY: 6, PARK: 5, MUSEUM: 5
  },
  FAMILY: {
    MUSEUM: 10, PARK: 9, ARCADE: 8, RESTAURANT: 8, DESSERT: 8, CAFE: 7, BOWLING: 7, MALL: 7,
    MOVIE: 6, POTTERY: 6, SPORTS: 5, ESCAPE_ROOM: 4
  },
  WORK: {
    ESCAPE_ROOM: 10, BOWLING: 9, ARCADE: 9, POTTERY: 9, RESTAURANT: 8, CAFE: 7, SPORTS: 6,
    MALL: 5, DESSERT: 5, MOVIE: 4, MUSEUM: 4, PARK: 4
  },
  CUSTOM: {
    CAFE: 8, RESTAURANT: 8, DESSERT: 7, PARK: 7, ARCADE: 6, BOWLING: 6, MALL: 6, MOVIE: 6,
    ESCAPE_ROOM: 5, POTTERY: 5, MUSEUM: 5, SPORTS: 5
  }
};

interface PlaceCandidate {
  id: string;
  name: string;
  category: string;
  rating: number;
  lat: number;
  lng: number;
  estimatedCostPerHead: number;
  address: string;
  openNow?: boolean;
  isExperience?: boolean;
  sourceUrl?: string;
  imageUrl?: string;
  isFallback?: boolean;
  isZoneCurated?: boolean;
}

function validateCoordinates(lat: number, lng: number): boolean {
  return lat >= 18.8 && lat <= 19.5 && lng >= 72.6 && lng <= 73.3;
}

const PLANNER_REQUIRED_CATEGORIES: VenueCategory[] = [
  'CAFE', 'RESTAURANT', 'ARCADE', 'PARK', 'ESCAPE_ROOM', 'DESSERT', 'BOWLING', 'MUSEUM'
];

const REACTIVE_CATEGORY_COSTS: Record<string, { mandatory: number; min: number; max: number }> = {
  CAFE:        { mandatory: 0,   min: 200, max: 600  },
  RESTAURANT:  { mandatory: 0,   min: 300, max: 1000 },
  DESSERT:     { mandatory: 0,   min: 150, max: 400  },
  PARK:        { mandatory: 0,   min: 0,   max: 0    },
  ARCADE:      { mandatory: 300, min: 100, max: 500  },
  BOWLING:     { mandatory: 350, min: 100, max: 400  },
  ESCAPE_ROOM: { mandatory: 700, min: 0,   max: 0    },
  MUSEUM:      { mandatory: 150, min: 0,   max: 0    },
  MALL:        { mandatory: 0,   min: 100, max: 500  },
  SPORTS:      { mandatory: 300, min: 0,   max: 200  },
  MOVIE:       { mandatory: 350, min: 0,   max: 100  },
};

function getFallbackImageUrl(category: string): string {
  const cat = (category ?? '').toUpperCase();
  if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(cat)) {
    return '/images/cafe_active.png';
  }
  return '/images/mumbai_map.png';
}

function isDisallowedItineraryImage(imageUrl?: string | null): boolean {
  return !imageUrl || imageUrl.includes('unsplash.com') || imageUrl.includes('placehold.co');
}


export interface ItineraryTemplate {
  slot1: string[];
  slot1Act: boolean;
  slot2: string[];
  slot2Act: boolean;
  slot3: string[];
  slot3Act: boolean;
}

export const ITINERARY_TEMPLATES: ItineraryTemplate[] = [
  // 1. Arcade -> Restaurant -> Dessert
  { slot1: ['ARCADE'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 2. Cafe -> Pottery -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['POTTERY', 'WORKSHOP'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 3. Museum -> Mall -> Cafe
  { slot1: ['MUSEUM'], slot1Act: true, slot2: ['MALL'], slot2Act: true, slot3: ['CAFE'], slot3Act: false },
  // 4. Bowling -> Restaurant -> Park
  { slot1: ['BOWLING'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['PARK'], slot3Act: true },
  // 5. Escape room -> Restaurant -> Dessert
  { slot1: ['ESCAPE_ROOM'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 6. Park -> Cafe -> Arcade
  { slot1: ['PARK'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['ARCADE'], slot3Act: true },
  // 7. Art Gallery -> Restaurant -> Cafe
  { slot1: ['ART_GALLERY', 'MUSEUM'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['CAFE'], slot3Act: false },
  // 8. Sports -> Restaurant -> Dessert
  { slot1: ['SPORTS'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 9. Cafe -> Painting -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['PAINTING', 'WORKSHOP'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 10. Bowling -> Cafe -> Sports
  { slot1: ['BOWLING'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['SPORTS', 'ARCADE'], slot3Act: true },
  // 11. Movie -> Restaurant -> Cafe
  { slot1: ['MOVIE'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['CAFE'], slot3Act: false },
  // 12. Park -> Restaurant -> Dessert
  { slot1: ['PARK'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 13. Museum -> Cafe -> Mall
  { slot1: ['MUSEUM'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['MALL'], slot3Act: true },
  // 14. Arcade -> Restaurant -> Park
  { slot1: ['ARCADE'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['PARK'], slot3Act: true },
  // 15. Workshop -> Cafe -> Dessert
  { slot1: ['WORKSHOP', 'POTTERY'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 16. Escape Room -> Cafe -> Restaurant
  { slot1: ['ESCAPE_ROOM'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['RESTAURANT'], slot3Act: false },
  // 17. Park -> Cafe -> Restaurant
  { slot1: ['PARK'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['RESTAURANT'], slot3Act: false },
  // 18. Museum -> Restaurant -> Dessert
  { slot1: ['MUSEUM'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 19. Sports -> Cafe -> Arcade
  { slot1: ['SPORTS'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['ARCADE'], slot3Act: true },
  // 20. Art Gallery -> Cafe -> Dessert
  { slot1: ['ART_GALLERY', 'MUSEUM'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 21. Bowling -> Cafe -> Dessert
  { slot1: ['BOWLING'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 22. Cafe -> Arcade -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['ARCADE'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 23. Mall -> Cafe -> Dessert
  { slot1: ['MALL'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 24. Cafe -> Museum -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['MUSEUM'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 25. Workshop -> Restaurant -> Dessert
  { slot1: ['WORKSHOP', 'PAINTING'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
  // 26. Arcade -> Cafe -> Restaurant
  { slot1: ['ARCADE'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['RESTAURANT'], slot3Act: false },
  // 27. Park -> Cafe -> Movie
  { slot1: ['PARK'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['MOVIE'], slot3Act: true },
  // 28. Escape Room -> Restaurant -> Park
  { slot1: ['ESCAPE_ROOM'], slot1Act: true, slot2: ['RESTAURANT'], slot2Act: false, slot3: ['PARK'], slot3Act: true },
  // 29. Cafe -> Sports -> Restaurant
  { slot1: ['CAFE'], slot1Act: false, slot2: ['SPORTS'], slot2Act: true, slot3: ['RESTAURANT'], slot3Act: false },
  // 30. Museum -> Cafe -> Restaurant
  { slot1: ['MUSEUM'], slot1Act: true, slot2: ['CAFE'], slot2Act: false, slot3: ['RESTAURANT'], slot3Act: false }
];

export const POPULAR_CHAINS = [
  'starbucks', 'social', 'barbeque nation', 'bbq nation', 'timezone',
  'mcdonald', 'pizza hut', 'domino', 'kfc', 'burger king', 'coffee day',
  'ccd', 'third wave', 'blue tokai', 'tea trails', 'natural ice cream',
  'naturals', 'theobroma', 'chili', 'subway', 'sbarro', 'pizza express',
  'mainland china', 'copper chimney', 'hard rock', 'smokey house',
  'smaaash', 'starbucks coffee'
];

export const isChain = (name: string): boolean => {
  const lower = name.toLowerCase();
  return POPULAR_CHAINS.some(chain => lower.includes(chain));
};

const SELECTABLE_PLACE_CATEGORIES = new Set([
  'CAFE', 'RESTAURANT', 'ARCADE', 'PARK', 'ESCAPE_ROOM', 'DESSERT',
  'BOWLING', 'MUSEUM', 'ART_GALLERY', 'MALL', 'MOVIE', 'SPORTS',
  'POTTERY', 'WORKSHOP', 'PAINTING'
]);

const ROLE_ONLY_PLACE_CATEGORIES = new Set([
  'FOOD_STOP', 'PRIMARY_EXPERIENCE', 'OPTIONAL_STOP'
]);

const STRONG_HANGOUT_NAME_PATTERNS = [
  'social', 'cafe', 'cafÃ©', 'coffee', 'bistro', 'bakery', 'patisserie',
  'dessert', 'creamery', 'ice cream', 'gelato', 'waffle', 'theobroma',
  'le15', 'taproom', 'bar', 'brew', 'brewery', 'diner', 'kitchen',
  'trattoria', 'restaurant', 'pizza', 'sushi', 'ramen', 'bbq', 'barbeque',
  'arcade', 'game', 'gaming', 'timezone', 'smaaash', 'bowling', 'escape',
  'museum', 'gallery', 'art', 'studio', 'pottery', 'workshop',
  'promenade', 'beach', 'lake', 'garden', 'fort', 'national park',
  'nature park', 'waterfront', 'viewpoint', 'cinema', 'pvr', 'inox',
  'cinepolis', 'theatre', 'mall'
];

const WEAK_OR_NON_HANGOUT_PATTERNS = [
  ' pvt ltd', ' pvt. ltd', ' limited', ' ltd.', 'corporate', 'office',
  'apartment', ' housing', ' society', ' co-op', ' chs', 'chs ', 'c.h.s',
  'residency', 'residences', 'tower', 'villa', 'bungalow', 'building', 'bldg',
  'gate no', ' gate 1', ' gate 2', 'transit', 'compound', 'estate',
  'marriage hall', 'banquet hall', 'community hall', 'rickshaw', 'auto stand',
  'parking', 'metro station', 'railway station', 'bus stand', 'bus depot',
  'bus terminal', 'collection', 'boutique', 'clothing', 'designer', 'couture',
  'tailor', 'saree', 'fashion', 'textile', 'dulha', 'bridal', 'jewellers',
  'jewellery', 'jewelers', 'advisory', 'advisor', 'advisors', 'fund ', ' fund',
  'wealth', 'consultancy', 'consulting', 'associates', 'advocates', 'chambers',
  'law firm', 'legal', 'finance', 'financial', 'investments', 'venture',
  'capital', 'foundation', 'trust', 'ngo', 'charity', 'diagnostic', ' clinic',
  'clinic ', 'hospital', 'nursing home', 'dental', 'eyecare', 'enterprises',
  'services', 'store', 'shop', 'mart', 'supermarket', 'medical', 'pharma',
  'pharmacy', 'school', 'college', 'classes', 'tuition', 'hostel', 'pg ',
  'gymkhana', 'club house', 'ground', 'maidan', 'kridangan', 'football turf',
  'cricket ground', 'mandir', 'temple', 'masjid', 'church', 'vihar',
  'holiday', 'holidays', 'travel', 'travels', 'tour', 'tours', 'frame',
  'frames', 'branding', 'conclave', 'dynamic positioning', 'training centre',
  'training center', 'guest house', 'resturant service', 'hotel ', 'max',
  'wholesale', 'exhibition centre'
];

const GENERIC_WEAK_FOOD_PATTERNS = [
  'family restaurant', 'veg restaurant', 'pure veg', 'hotel ', 'fast food',
  'snacks corner', 'sweets', 'caterers', 'biryani', 'chinese foods',
  'juice centre', 'cold drinks', 'tea stall', 'dhaba', 'mess'
];

const LOW_INTENT_CHAIN_PATTERNS = [
  'mcdonald', 'domino', 'kfc', 'subway', 'burger king', 'pizza hut',
  'barbeque nation', 'bbq nation', 'monginis', 'ribbons and balloons',
  'cafe coffee day', 'cafÃ© coffee day', 'ccd', 'mad over donuts',
  'belgian waffle', 'naturals ice cream', 'starbucks', 'barista', 'mccafÃ©',
  'mccafe', 'coffee day express'
];

function hasAnyPattern(text: string, patterns: string[]) {
  return patterns.some(pattern => text.includes(pattern));
}

// Additional weak markers picked up by the eval (Max, Kohinoor Elite,
// Regenza by Tunga, Paradise By Tunga, Purshottam Kandoi Haribhai Damodar,
// Kurla Sunlight Guest house...). These are hotel-branded restaurants, dry
// sweet shops, and single-word retail names that should never surface as
// hangout venues even when the surrounding address has "cafe" or similar.
const EXTRA_WEAK_NAME_PATTERNS = [
  ' by tunga', 'tunga ', 'kohinoor elite', 'regenza', ' the park ',
  'sunlight guest', 'guest house', 'mithaiwala', 'halwai',
  'kandoi', 'stadium', 'multipurpose indoor', 'purandare',
  ' rajiv gandhi ', 'convention centre', 'convention center',
  'dadoji konddev', 'boutique hotel',
];

// Names that are so generic they must ALWAYS clear a stronger bar (highly
// rated + heavily reviewed) — otherwise they read as random pins.
const GENERIC_SHORT_NAME_PATTERNS = [
  ' max', 'max ', '^max$', ' magnolia', ' spice it', ' 1bhk',
  ' the palate', ' gustoso', ' pablo ', ' the little easy',
  ' the paradise ', ' west 1', ' gopala', ' sarang malvani',
  'wonders park',
];

// Hard-reject names in the NAME field — cannot be rescued by a strong signal
// (e.g. Dragonfly Hotel - The Art Hotel gets rescued by "art" today).
const NAME_HARD_REJECT_PATTERNS = [
  ' hotel ', ' hotel-', 'hotel & ', 'hotel and ', ' by hotel',
  'guest house', 'residency', 'residences ', 'homestay',
  'nursing home', 'lodge ', ' inn ', ' pg ',
  ' banquets', ' banquet',
];

function isHangoutWorthyCandidate(candidate: { name: string; category: string; rating?: number | null; reviewCount?: number | null; address?: string | null; isFallback?: boolean; isExperience?: boolean; isZoneCurated?: boolean }) {
  // Fallbacks / featured experiences / zone-curated venues used to be waved
  // straight through. That's how "Kurla Sunlight Guest house and resturant
  // service" made it into the mostCommonVenues list. Now we still trust
  // experience/featured (curated content) but require zone-curated *place*
  // fallbacks to at least survive the same LOW_INTENT chain and weak-name
  // checks the general pipeline runs.
  if (candidate.isExperience) return true;
  const category = candidate.category.toUpperCase();
  if (ROLE_ONLY_PLACE_CATEGORIES.has(category) || !SELECTABLE_PLACE_CATEGORIES.has(category)) return false;

  const rating = candidate.rating ?? null;
  const reviewCount = candidate.reviewCount ?? 0;
  const nameLower = ` ${candidate.name.toLowerCase()} `; // pad for word-boundary substr checks
  const addrLower = (candidate.address ?? '').toLowerCase();
  const normalized = `${candidate.name} ${candidate.address ?? ''}`.toLowerCase();

  // STRONG signal must come from the NAME. Previously any strong pattern in
  // the address (e.g. a Bandra cafe strip) would rescue an unrelated hotel
  // branded restaurant sitting on that street.
  const strongInName = hasAnyPattern(nameLower, STRONG_HANGOUT_NAME_PATTERNS);
  const strongInAddr = hasAnyPattern(addrLower, STRONG_HANGOUT_NAME_PATTERNS);
  const strongSignal = strongInName;

  // Hard reject: low-intent chains no matter what.
  if (hasAnyPattern(normalized, LOW_INTENT_CHAIN_PATTERNS)) return false;

  // Hard reject: name-level markers that CANNOT be rescued by any strong
  // signal — hotels, guest houses, lodges, residences. This is stricter than
  // WEAK_OR_NON_HANGOUT_PATTERNS which lets 'the art' in "Dragonfly Hotel -
  // The Art Hotel" wave the venue through.
  if (hasAnyPattern(nameLower, NAME_HARD_REJECT_PATTERNS)) return false;

  // Hard reject: weak name patterns unless a strong signal is in the NAME.
  if (hasAnyPattern(normalized, WEAK_OR_NON_HANGOUT_PATTERNS) && !strongInName) return false;

  // Hard reject: the additional weak markers we picked up from the eval.
  if (hasAnyPattern(nameLower, EXTRA_WEAK_NAME_PATTERNS)) return false;

  // For fallback / zone-curated venues we short-circuit before category checks
  // once the LOW_INTENT + weak-name gates above have run.
  if (candidate.isFallback || candidate.isZoneCurated) return true;

  const highlyReviewed = reviewCount >= 75;
  const strongRated = rating !== null && rating >= 4.3 && reviewCount >= 40;

  // Names so generic they need a high bar to earn a slot — stops "Max",
  // "Magnolia", "Spice IT" etc from sneaking in on strong-in-addr alone.
  const genericShortName = hasAnyPattern(nameLower, GENERIC_SHORT_NAME_PATTERNS);
  if (genericShortName) {
    const meetsHighBar = rating !== null && rating >= 4.4 && reviewCount >= 150;
    if (!meetsHighBar) return false;
  }

  if (category === 'RESTAURANT') {
    if (hasAnyPattern(normalized, GENERIC_WEAK_FOOD_PATTERNS) && !strongSignal) return false;
    return strongSignal || highlyReviewed || strongRated;
  }

  if (category === 'PARK') {
    // Hard reject only when the name explicitly says "mall / store /
    // boutique / shop / showroom" — those are DB misclassifications, not
    // parks. Everything else falls through to the scenic-signal + rating
    // check (unchanged from before).
    const parkNameConflict = hasAnyPattern(nameLower, [
      ' mall ', ' store ', ' boutique', ' showroom', 'residency',
      'apartments', 'clinic', 'hospital',
    ]);
    if (parkNameConflict) return false;
    const scenicSignal = hasAnyPattern(normalized, [
      'promenade', 'beach', 'lake', 'fort', 'national park', 'nature park',
      'waterfront', 'viewpoint', 'central park', 'jio world garden',
      'gardens', 'park', 'chowpatty', 'sea face', 'seaface',
      'marine drive', 'garden', 'grove', 'point',
    ]);
    return scenicSignal && (reviewCount >= 25 || rating === null || rating >= 4.0);
  }

  if (category === 'MUSEUM') {
    // Hard reject clear misclassifications, otherwise let the venue through.
    const conflict = hasAnyPattern(nameLower, [
      ' mall ', ' store ', ' cafe ', ' restaurant ', ' hotel ',
    ]);
    if (conflict) return false;
    return true;
  }

  if (category === 'ART_GALLERY') {
    const conflict = hasAnyPattern(nameLower, [
      ' mall ', ' store ', ' cafe ', ' restaurant ', ' hotel ',
    ]);
    if (conflict) return false;
    return true;
  }

  if (category === 'MALL') return strongSignal && reviewCount >= 100;
  if (category === 'CAFE' || category === 'DESSERT') return strongSignal || highlyReviewed || strongRated;
  if (category === 'SPORTS') {
    // Sports needs strong signal or an actual entertainment context — stops
    // stadiums from being counted as hangout venues.
    const isSportEntertainment = hasAnyPattern(nameLower, ['smaaash', 'trampoline', 'karting', 'go karting', 'sky jumper', 'zorbing', 'paintball', 'laser tag']);
    if (!isSportEntertainment && !strongSignal) return false;
    return strongSignal || isSportEntertainment || strongRated;
  }

  // Allow strong-in-addr to help ONLY when the venue is also well reviewed —
  // this keeps genuine hidden gems on the "cafe strip" but locks out random
  // pins with generic names sitting on the same street.
  return strongSignal || highlyReviewed || strongRated || (strongInAddr && reviewCount >= 100);
}

const DATE_ITINERARY_TEMPLATES: ItineraryTemplate[] = [
  { slot1: ['CAFE', 'RESTAURANT'], slot1Act: false, slot2: ['PARK', 'MUSEUM', 'ART_GALLERY'], slot2Act: true, slot3: ['DESSERT', 'CAFE'], slot3Act: false },
  { slot1: ['CAFE', 'RESTAURANT'], slot1Act: false, slot2: ['ART_GALLERY', 'MUSEUM', 'POTTERY', 'WORKSHOP'], slot2Act: true, slot3: ['DESSERT'], slot3Act: false },
  { slot1: ['PARK', 'MUSEUM', 'ART_GALLERY'], slot1Act: true, slot2: ['CAFE', 'RESTAURANT'], slot2Act: false, slot3: ['DESSERT', 'CAFE'], slot3Act: false },
  { slot1: ['ART_GALLERY', 'MUSEUM', 'POTTERY', 'WORKSHOP'], slot1Act: true, slot2: ['CAFE', 'RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
];

// ---------------------------------------------------------------------------
// Archetype dispatch: hierarchical context -> archetype -> venue selection.
// The planner first decides *what kind of day* to plan from the outing context
// (group size, group type, time of day, weather, preferences), then fills the
// chosen archetype's slots with the best DB venues. This replaces the earlier
// pick-a-random-template-then-hope approach.
// ---------------------------------------------------------------------------

export type TimeBucket = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';
export type SizeBucket = 'PAIR' | 'SMALL' | 'MEDIUM' | 'LARGE';
export type WeatherBucket = 'DRY' | 'MONSOON';

// OutingIntent is the FIRST planning signal — before archetype selection.
// Two identical (budget, size, time, prefs) requests can produce radically
// different plans depending on the underlying purpose of the outing. The
// planner uses intent to bias archetype fit AND venue selection.
export type OutingIntent =
  | 'CELEBRATE'      // anniversary, promotion, big win — impress-adjacent, prefers premium venues
  | 'IMPRESS'        // first date, meeting someone new — prefers well-reviewed, photogenic places
  | 'RELAX'          // decompress — quiet, low-effort places
  | 'EXPLORE'        // discover new corners — favours culture / neighbourhood arcs
  | 'EAT'            // it's about the food — food-only arcs allowed
  | 'ADVENTURE'      // thrill / adrenaline — activity-heavy
  | 'CATCH_UP'       // reconnect with people — conversation-forward venues
  | 'FAMILY_TIME'    // multi-generational — safe, well-known, family-friendly
  | 'TEAM_BONDING';  // colleagues — activity + food, not too romantic
export type ArchetypeFamily =
  | 'ACTIVITY_FIRST'
  | 'CAFE_FIRST'
  | 'CULTURE_FIRST'
  | 'SCENIC_FIRST'
  | 'CREATIVE_FIRST'
  | 'SHOPPING_FIRST'
  | 'ENTERTAINMENT_FIRST';

export interface PlanningContext {
  groupType: 'DATE' | 'FRIENDS' | 'FAMILY' | 'WORK' | 'CUSTOM';
  groupSize: number;
  sizeBucket: SizeBucket;
  timeBucket: TimeBucket;
  weather: WeatherBucket;
  preferredCategories: string[]; // uppercase
  requiredPreferences: string[]; // uppercase — MUST appear in every returned plan
  vibes: string[]; // uppercase
  options: string[];
  intent: OutingIntent;   // first-class planning signal
  isCheaper: boolean;
  isMoreIndoor: boolean;
  isLessTravel: boolean;
  isMoreActivities: boolean;
  isMoreFood: boolean;
  isMoreCreative: boolean;
  isMoreRomantic: boolean;
  hasMoviePreference: boolean;
  hasMallPreference: boolean;
}

interface TemplateMeta {
  family: ArchetypeFamily;
  indoor: boolean;
  timeFit: Set<TimeBucket>;
  requiresMovie: boolean;
  requiresMall: boolean;
  leadCategory: string;
  allCategories: string[];
  activityCount: number;
  hasCreative: boolean;
  hasCulture: boolean;
  hasScenic: boolean;
}

function parseOutingHour(outingTime?: string | null): number {
  if (!outingTime) return 12;
  const m24 = outingTime.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return parseInt(m24[1]);
  const m12 = outingTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = parseInt(m12[1]);
    const ampm = m12[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h;
  }
  return 12;
}

export function deriveTimeBucket(outingTime?: string | null): TimeBucket {
  const hour = parseOutingHour(outingTime);
  if (hour < 12) return 'MORNING';
  if (hour < 17) return 'AFTERNOON';
  if (hour < 21) return 'EVENING';
  return 'NIGHT';
}

export function deriveSizeBucket(n: number): SizeBucket {
  if (n <= 2) return 'PAIR';
  if (n <= 4) return 'SMALL';
  if (n <= 6) return 'MEDIUM';
  return 'LARGE';
}

export function deriveWeather(outingDate?: string | null): WeatherBucket {
  if (!outingDate) return 'DRY';
  const parts = outingDate.split('-');
  if (parts.length < 2) return 'DRY';
  const month = parseInt(parts[1]);
  return [6, 7, 8, 9].includes(month) ? 'MONSOON' : 'DRY';
}

const OUTDOOR_CATS = new Set(['PARK', 'OUTDOOR_EXPERIENCE', 'SCENIC_EXPERIENCE']);
const CREATIVE_CATS = new Set(['POTTERY', 'WORKSHOP', 'PAINTING']);
const CULTURE_CATS = new Set(['MUSEUM', 'ART_GALLERY']);

function familyOfLead(cat: string): ArchetypeFamily {
  const c = (cat || '').toUpperCase();
  if (['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS'].includes(c)) return 'ACTIVITY_FIRST';
  if (c === 'MOVIE') return 'ENTERTAINMENT_FIRST';
  if (['MUSEUM', 'ART_GALLERY'].includes(c)) return 'CULTURE_FIRST';
  if (c === 'PARK') return 'SCENIC_FIRST';
  if (['POTTERY', 'WORKSHOP', 'PAINTING'].includes(c)) return 'CREATIVE_FIRST';
  if (c === 'MALL') return 'SHOPPING_FIRST';
  return 'CAFE_FIRST';
}

export function familyFromSlotCategories(slot1Cat: string): ArchetypeFamily {
  return familyOfLead(slot1Cat);
}

function deriveTemplateMeta(t: ItineraryTemplate): TemplateMeta {
  const cats = [...t.slot1, ...t.slot2, ...t.slot3].map(c => c.toUpperCase());
  const uniq = new Set(cats);
  const leadCategory = (t.slot1[0] || '').toUpperCase();
  const family = familyOfLead(leadCategory);
  const indoor = !cats.some(c => OUTDOOR_CATS.has(c));
  const hasMuseumOrPark = uniq.has('MUSEUM') || uniq.has('ART_GALLERY') || uniq.has('PARK');
  const timeFit = new Set<TimeBucket>(['MORNING', 'AFTERNOON', 'EVENING']);
  // Museum (~6pm close) and park (~7pm close) can't anchor a NIGHT plan.
  if (!hasMuseumOrPark) timeFit.add('NIGHT');
  // Movie is inherently an evening/night thing.
  if (uniq.has('MOVIE') && leadCategory === 'MOVIE') {
    timeFit.delete('MORNING');
  }
  const requiresMovie = leadCategory === 'MOVIE';
  const requiresMall = leadCategory === 'MALL';
  const activityCount = [t.slot1Act, t.slot2Act, t.slot3Act].filter(Boolean).length;
  const hasCreative = cats.some(c => CREATIVE_CATS.has(c));
  const hasCulture = cats.some(c => CULTURE_CATS.has(c));
  const hasScenic = uniq.has('PARK');
  return {
    family,
    indoor,
    timeFit,
    requiresMovie,
    requiresMall,
    leadCategory,
    allCategories: cats,
    activityCount,
    hasCreative,
    hasCulture,
    hasScenic,
  };
}

// When the request doesn't declare an intent explicitly, derive a reasonable
// default from what we DO know. Vibes are the strongest signal (ROMANTIC →
// IMPRESS, ADVENTUROUS → ADVENTURE, FOODIE → EAT, CULTURAL → EXPLORE),
// then options (More Activities → ADVENTURE, More Food → EAT), then
// groupType as fallback.
function deriveDefaultIntent(params: {
  groupType: PlanningContext['groupType'];
  vibes: string[];        // uppercase
  options: string[];
}): OutingIntent {
  const vibeSet = new Set(params.vibes);
  if (vibeSet.has('ROMANTIC')) return 'IMPRESS';
  if (vibeSet.has('ADVENTUROUS')) return 'ADVENTURE';
  if (vibeSet.has('FOODIE')) return 'EAT';
  if (vibeSet.has('CULTURAL')) return 'EXPLORE';
  if (vibeSet.has('CHILL')) return 'RELAX';
  if (vibeSet.has('COMPETITIVE')) return 'ADVENTURE';

  const options = new Set(params.options);
  if (options.has('More Activities')) return 'ADVENTURE';
  if (options.has('More Food')) return 'EAT';
  if (options.has('More Creative')) return 'EXPLORE';
  if (options.has('More Romantic')) return 'IMPRESS';

  switch (params.groupType) {
    case 'DATE': return 'CATCH_UP';
    case 'WORK': return 'TEAM_BONDING';
    case 'FAMILY': return 'FAMILY_TIME';
    case 'FRIENDS': return 'CATCH_UP';
    default: return 'CATCH_UP';
  }
}

export function buildPlanningContext(params: {
  groupType: string | undefined;
  groupSize: number;
  outingTime: string | null | undefined;
  outingDate: string | null | undefined;
  preferredCategories: string[];
  requiredPreferences?: string[];
  vibes: string[];
  options: string[];
  intent?: OutingIntent;
  extraGroupSignals?: { activity?: string | null; outingType?: string | null };
}): PlanningContext {
  const options = params.options || [];
  const prefsUpper = (params.preferredCategories || []).map(c => c.toUpperCase());
  const requiredUpper = (params.requiredPreferences || []).map(c => c.toUpperCase());
  const vibesUpper = (params.vibes || []).map(v => v.toUpperCase());

  const hasMoviePreference =
    prefsUpper.includes('MOVIE') ||
    (params.extraGroupSignals?.activity && String(params.extraGroupSignals.activity).toLowerCase().includes('movie')) ||
    (params.extraGroupSignals?.outingType && String(params.extraGroupSignals.outingType).toLowerCase().includes('movie')) ||
    vibesUpper.some(v => v.toLowerCase().includes('movie'));

  const hasMallPreference = prefsUpper.includes('MALL');

  const rawGroupType = String(params.groupType ?? 'CUSTOM').toUpperCase();
  const groupType = (['DATE', 'FRIENDS', 'FAMILY', 'WORK'].includes(rawGroupType) ? rawGroupType : 'CUSTOM') as PlanningContext['groupType'];

  const intent = params.intent ?? deriveDefaultIntent({
    groupType,
    vibes: vibesUpper,
    options,
  });

  return {
    groupType,
    groupSize: params.groupSize,
    sizeBucket: deriveSizeBucket(params.groupSize),
    timeBucket: deriveTimeBucket(params.outingTime),
    weather: deriveWeather(params.outingDate),
    preferredCategories: prefsUpper,
    requiredPreferences: requiredUpper,
    vibes: vibesUpper,
    options,
    intent,
    isCheaper: options.includes('Cheaper'),
    isMoreIndoor: options.includes('More Indoor'),
    isLessTravel: options.includes('Less Travel'),
    isMoreActivities: options.includes('More Activities'),
    isMoreFood: options.includes('More Food'),
    isMoreCreative: options.includes('More Creative'),
    isMoreRomantic: options.includes('More Romantic'),
    hasMoviePreference: Boolean(hasMoviePreference),
    hasMallPreference,
  };
}

function scoreTemplateFit(meta: TemplateMeta, ctx: PlanningContext): number {
  let s = 0;

  // Time-of-day: strong — the arc has to make sense at the requested time.
  if (meta.timeFit.has(ctx.timeBucket)) s += 2;

  // Weather
  if (ctx.weather === 'MONSOON') {
    if (meta.indoor) s += 2;
    else s -= 3;
  } else if (meta.hasScenic) {
    s += 0.5;
  }

  // Group size structural fit
  if (ctx.sizeBucket === 'PAIR') {
    if (['CAFE_FIRST', 'CREATIVE_FIRST', 'CULTURE_FIRST', 'SCENIC_FIRST'].includes(meta.family)) s += 2;
    if (meta.family === 'ACTIVITY_FIRST') s -= 1;
    if (meta.family === 'SHOPPING_FIRST') s -= 1;
  } else if (ctx.sizeBucket === 'LARGE') {
    if (['ACTIVITY_FIRST', 'SHOPPING_FIRST', 'ENTERTAINMENT_FIRST'].includes(meta.family)) s += 2;
    if (meta.family === 'CAFE_FIRST' && meta.activityCount === 0) s -= 1.5;
    if (meta.family === 'CREATIVE_FIRST') s -= 1; // pottery-for-8 rarely works
  } else if (ctx.sizeBucket === 'MEDIUM') {
    if (meta.activityCount === 0) s -= 0.5;
    if (['ACTIVITY_FIRST', 'ENTERTAINMENT_FIRST'].includes(meta.family)) s += 1;
  }

  // Group type structural fit
  if (ctx.groupType === 'DATE') {
    if (['CAFE_FIRST', 'CREATIVE_FIRST', 'CULTURE_FIRST', 'SCENIC_FIRST'].includes(meta.family)) s += 3;
    if (meta.family === 'ACTIVITY_FIRST') s -= 2;
    if (meta.family === 'SHOPPING_FIRST') s -= 3;
    if (meta.family === 'ENTERTAINMENT_FIRST') s -= 1;
  } else if (ctx.groupType === 'FAMILY') {
    if (['SCENIC_FIRST', 'CULTURE_FIRST', 'CAFE_FIRST'].includes(meta.family)) s += 2;
    if (meta.family === 'ACTIVITY_FIRST') s += 1; // arcade / bowling are family-friendly
    if (ctx.timeBucket === 'NIGHT') s -= 2;
  } else if (ctx.groupType === 'WORK') {
    if (['CREATIVE_FIRST', 'ACTIVITY_FIRST'].includes(meta.family)) s += 2;
    if (meta.family === 'SCENIC_FIRST') s -= 1;
  } else if (ctx.groupType === 'FRIENDS') {
    if (['ACTIVITY_FIRST', 'CAFE_FIRST', 'ENTERTAINMENT_FIRST', 'CREATIVE_FIRST'].includes(meta.family)) s += 1;
  }

  // Explicit options — user pushed a lever, respect it hard.
  if (ctx.isMoreActivities && meta.family !== 'ACTIVITY_FIRST' && meta.family !== 'CREATIVE_FIRST' && meta.family !== 'ENTERTAINMENT_FIRST') s -= 4;
  if (ctx.isMoreCreative && meta.family !== 'CREATIVE_FIRST' && !meta.hasCreative) s -= 4;
  if (ctx.isMoreFood && meta.activityCount > 1) s -= 3;
  if (ctx.isMoreIndoor && !meta.indoor) s -= 5;
  if (ctx.isMoreRomantic && ['CAFE_FIRST', 'SCENIC_FIRST', 'CULTURE_FIRST', 'CREATIVE_FIRST'].includes(meta.family)) s += 1.5;

  // Preference match — heavily weighted. This was the #1 constraint violation
  // (LOW_PREFERENCE_MATCH in 27 / 50 scenarios of the baseline eval).
  const prefs = new Set(ctx.preferredCategories);
  if (prefs.size > 0) {
    const overlap = meta.allCategories.filter(c => prefs.has(c)).length;
    s += Math.min(3, overlap);
    if (overlap === 0) s -= 2;
  }

  // Vibe fit
  const vibes = new Set(ctx.vibes);
  if (vibes.has('CHILL')) {
    if (['CAFE_FIRST', 'SCENIC_FIRST'].includes(meta.family)) s += 1.5;
    if (meta.family === 'ACTIVITY_FIRST') s -= 1;
  }
  if (vibes.has('ADVENTUROUS') || vibes.has('COMPETITIVE')) {
    if (meta.family === 'ACTIVITY_FIRST') s += 2;
  }
  if (vibes.has('FOODIE') && meta.family === 'CAFE_FIRST') s += 2;
  if (vibes.has('CULTURAL') && meta.family === 'CULTURE_FIRST') s += 2;
  if (vibes.has('CREATIVE') && (meta.family === 'CREATIVE_FIRST' || meta.hasCreative)) s += 2;
  if (vibes.has('ROMANTIC')) {
    if (['CAFE_FIRST', 'SCENIC_FIRST', 'CREATIVE_FIRST', 'CULTURE_FIRST'].includes(meta.family)) s += 2;
    if (meta.family === 'ACTIVITY_FIRST') s -= 1;
  }

  return s;
}

function templateHardEligible(meta: TemplateMeta, ctx: PlanningContext): boolean {
  // MOVIE/MALL-lead templates require explicit interest — otherwise they read as random.
  if (meta.requiresMovie && !ctx.hasMoviePreference) return false;
  if (meta.requiresMall && !ctx.hasMallPreference) return false;
  // Time-of-day: hard filter — a museum-first arc at 10 PM makes no sense.
  if (!meta.timeFit.has(ctx.timeBucket)) return false;
  return true;
}

/**
 * Pick `count` distinct-family archetype templates from `pool` given the
 * outing context. Hierarchical: context first decides what family fits, then
 * we greedily assemble a diverse set for the group's 4 output plans.
 */
export function pickArchetypeTemplates(
  ctx: PlanningContext,
  pool: ItineraryTemplate[],
  count = 4
): ItineraryTemplate[] {
  interface Scored {
    template: ItineraryTemplate;
    meta: TemplateMeta;
    fit: number;
  }

  const withMeta: Scored[] = pool.map(t => {
    const meta = deriveTemplateMeta(t);
    return { template: t, meta, fit: 0 };
  });

  // Two-tier eligibility so we always return `count` templates, even when
  // the strict context is very narrow (tiny DATE pool, unusual time bucket, ...).
  let candidates = withMeta.filter(x => templateHardEligible(x.meta, ctx));
  let relaxed = false;
  if (candidates.length < count) {
    relaxed = true;
    candidates = withMeta
      .filter(x => !(x.meta.requiresMovie && !ctx.hasMoviePreference))
      .filter(x => !(x.meta.requiresMall && !ctx.hasMallPreference));
  }

  for (const c of candidates) {
    c.fit = scoreTemplateFit(c.meta, ctx);
    if (relaxed && !c.meta.timeFit.has(ctx.timeBucket)) c.fit -= 2;
  }

  candidates.sort((a, b) => (b.fit + Math.random() * 0.4) - (a.fit + Math.random() * 0.4));

  const picked: Scored[] = [];
  const usedFamilies = new Set<ArchetypeFamily>();
  const usedLeads = new Set<string>();

  // Pass 1: distinct family AND distinct lead category.
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (!usedFamilies.has(c.meta.family) && !usedLeads.has(c.meta.leadCategory)) {
      picked.push(c);
      usedFamilies.add(c.meta.family);
      usedLeads.add(c.meta.leadCategory);
    }
  }
  // Pass 2: distinct family only (any lead cat).
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some(p => p.template === c.template)) continue;
    if (!usedFamilies.has(c.meta.family)) {
      picked.push(c);
      usedFamilies.add(c.meta.family);
      usedLeads.add(c.meta.leadCategory);
    }
  }
  // Pass 3: distinct LEAD CATEGORY (allow family repeat, e.g. arcade + bowling
  // are both ACTIVITY_FIRST but structurally distinct).
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some(p => p.template === c.template)) continue;
    if (!usedLeads.has(c.meta.leadCategory)) {
      picked.push(c);
      usedLeads.add(c.meta.leadCategory);
    }
  }
  // Pass 4: absolute fill by fit.
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some(p => p.template === c.template)) continue;
    picked.push(c);
  }

  return picked.map(p => p.template);
}

// ---------------------------------------------------------------------------
// Stage 2 — Archetype system.
//
// Rather than 30 raw category triplets, we define ~12 named "day archetypes"
// each with a rich context signature (group-size range, group-type fit,
// time-of-day fit, weather fit, required preferences, vibes). Every archetype
// declares its slots as *roles* (CONVERSATION_START, SCENIC_STROLL,
// ENERGETIC_ACTIVITY, ...) which resolve to DB categories at pick time.
// Dispatch is strictly hierarchical: context first, then archetype selection,
// then venue selection.
// ---------------------------------------------------------------------------

export type SlotRole =
  | 'CONVERSATION_START'   // early cafe / quiet restaurant to settle in
  | 'BRUNCH'               // late-morning cafe or restaurant with substantial menu
  | 'SCENIC_STROLL'        // park / promenade / waterfront (weather-permitting)
  | 'CULTURE_STOP'         // museum, art gallery
  | 'CREATIVE_HANDS'       // pottery, workshop, painting
  | 'ENERGETIC_ACTIVITY'   // arcade, bowling, escape room, indoor sports
  | 'SHOPPING_STROLL'      // mall
  | 'MOVIE_STOP'           // cinema — only when explicitly preferred
  | 'DINNER'               // proper restaurant, dinner-appropriate
  | 'LATE_EVENING_EATS'    // rooftop / bar / late-night restaurant
  | 'DESSERT_CLOSE'        // dessert bar, gelato, patisserie
  | 'COFFEE_CLOSE';        // wrap the day at a café

export type ArchetypeKey =
  | 'INTIMATE_DATE'
  | 'QUIET_DATE'
  | 'CREATIVE_EVENING_DATE'
  | 'ART_NIGHT_DATE'
  | 'CREATIVE_DAY'
  | 'CULTURE_DAY'
  | 'CHILL_HANG'
  | 'HIGH_ENERGY'
  | 'BIG_GROUP_BASH'
  | 'FOODIE_ARC'
  | 'FAMILY_DAY_OUT'
  | 'RAINY_INDOORS'
  | 'NIGHTLIFE'
  | 'MORNING_BRUNCH'
  | 'MORNING_CULTURE_TOUR'
  | 'WORK_TEAM_ACTIVITY'
  | 'WORK_MORNING_MEETUP'
  | 'SHOPPING_ARC';

interface Archetype {
  key: ArchetypeKey;
  humanLabel: string;
  slots: { role: SlotRole; isActivity: boolean }[];
  minGroupSize?: number;
  maxGroupSize?: number;
  timeFit: TimeBucket[];
  weatherFit?: WeatherBucket[];       // if omitted: both
  groupTypeFit?: PlanningContext['groupType'][]; // if omitted: all
  groupTypeAvoid?: PlanningContext['groupType'][];
  requiredPref?: string;              // pref that MUST be present to pick this
  affinityVibes?: string[];           // upper-case vibes that boost fit
  contextBoost?: number;              // small always-on bump (0..2)
  // Content contract: at least ONE of these categories MUST appear in the
  // compiled plan or the candidate is rejected. Prevents "MORNING_CULTURE_TOUR"
  // arcs with zero cultural stops, "BIG_GROUP_BASH" with no bash activity, etc.
  mustInclude?: string[];
  // Preferred number of stops. Defaults to 3. NIGHTLIFE/CHILL_HANG can be 2;
  // FAMILY_DAY_OUT / MORNING_BRUNCH benefit from 4 when time allows.
  slotCount?: number;
  // Intent alignment — which intents this archetype naturally serves.
  intentFit?: OutingIntent[];
  intentAvoid?: OutingIntent[];
}

// The 12 day-archetypes. Every entry is a self-contained recipe for a
// specific kind of day. Same-family repeats are prevented by the dispatcher.
export const ARCHETYPES: Archetype[] = [
  {
    key: 'INTIMATE_DATE',
    humanLabel: 'Intimate date — quiet talk, scenic walk, sweet close',
    slots: [
      { role: 'CONVERSATION_START', isActivity: false },
      { role: 'SCENIC_STROLL', isActivity: true },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    maxGroupSize: 3,
    timeFit: ['AFTERNOON', 'EVENING'],
    weatherFit: ['DRY'],
    groupTypeFit: ['DATE'],
    affinityVibes: ['ROMANTIC', 'CHILL'],
    mustInclude: ['PARK'], // walk anchor
    intentFit: ['CATCH_UP', 'RELAX', 'CELEBRATE'],
    intentAvoid: ['ADVENTURE', 'TEAM_BONDING'],
  },
  {
    key: 'QUIET_DATE',
    humanLabel: 'Quiet date — coffee, gallery / museum, dessert',
    slots: [
      { role: 'CONVERSATION_START', isActivity: false },
      { role: 'CULTURE_STOP', isActivity: true },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    maxGroupSize: 3,
    // Museums / galleries close ~6pm — restrict to MORNING/AFTERNOON so the
    // arc actually holds. Evening dates fall through to CREATIVE_EVENING_DATE
    // or ART_NIGHT_DATE below.
    timeFit: ['MORNING', 'AFTERNOON'],
    groupTypeFit: ['DATE'],
    affinityVibes: ['ROMANTIC', 'CHILL', 'CULTURAL'],
    contextBoost: 1,
    mustInclude: ['MUSEUM', 'ART_GALLERY'],
    intentFit: ['EXPLORE', 'CATCH_UP', 'RELAX'],
    intentAvoid: ['ADVENTURE', 'TEAM_BONDING'],
  },
  {
    key: 'CREATIVE_EVENING_DATE',
    humanLabel: 'Creative evening date — pottery / workshop, cafe, dessert',
    slots: [
      { role: 'CREATIVE_HANDS', isActivity: true },
      { role: 'CONVERSATION_START', isActivity: false },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    maxGroupSize: 3,
    // Pottery / workshop classes run into the evening (9pm), so this is the
    // DATE arc that works when it's raining, dark, or both.
    timeFit: ['AFTERNOON', 'EVENING'],
    groupTypeFit: ['DATE'],
    affinityVibes: ['ROMANTIC', 'CREATIVE', 'CULTURAL'],
    contextBoost: 1.5,
    mustInclude: ['POTTERY', 'WORKSHOP', 'PAINTING'],
    intentFit: ['EXPLORE', 'CATCH_UP', 'CELEBRATE', 'IMPRESS'],
    intentAvoid: ['ADVENTURE', 'EAT'],
  },
  {
    key: 'ART_NIGHT_DATE',
    humanLabel: 'Art-night date — gallery, dinner, dessert',
    slots: [
      { role: 'CULTURE_STOP', isActivity: true },
      { role: 'DINNER', isActivity: false },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    maxGroupSize: 3,
    // Galleries close ~6pm too but "art night" openings sometimes go later —
    // hold this to AFTERNOON slot.
    timeFit: ['AFTERNOON'],
    groupTypeFit: ['DATE'],
    affinityVibes: ['ROMANTIC', 'CULTURAL'],
    contextBoost: 0.5,
    mustInclude: ['ART_GALLERY', 'MUSEUM'],
    intentFit: ['CELEBRATE', 'IMPRESS', 'EXPLORE'],
    intentAvoid: ['ADVENTURE', 'TEAM_BONDING', 'FAMILY_TIME'],
  },
  {
    key: 'MORNING_CULTURE_TOUR',
    humanLabel: 'Morning culture tour — breakfast, museum / gallery, dessert',
    slots: [
      { role: 'BRUNCH', isActivity: false },
      { role: 'CULTURE_STOP', isActivity: true },
      // Was COFFEE_CLOSE → produced CAFE → MUSEUM → CAFE. Dessert closes the
      // arc without repeating the opener.
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 2,
    timeFit: ['MORNING'],
    affinityVibes: ['CULTURAL', 'CHILL'],
    contextBoost: 1,
    mustInclude: ['MUSEUM', 'ART_GALLERY'],
    intentFit: ['EXPLORE', 'FAMILY_TIME', 'CATCH_UP'],
    intentAvoid: ['ADVENTURE', 'IMPRESS'],
  },
  {
    key: 'WORK_TEAM_ACTIVITY',
    humanLabel: 'Team-building — group activity + a proper lunch + coffee',
    slots: [
      { role: 'ENERGETIC_ACTIVITY', isActivity: true },
      { role: 'DINNER', isActivity: false },
      { role: 'COFFEE_CLOSE', isActivity: false },
    ],
    minGroupSize: 3,
    timeFit: ['AFTERNOON', 'EVENING'],
    groupTypeFit: ['WORK'],
    affinityVibes: ['COMPETITIVE', 'CREATIVE'],
    contextBoost: 1.5,
    mustInclude: ['ESCAPE_ROOM', 'BOWLING', 'ARCADE', 'POTTERY', 'WORKSHOP', 'SPORTS'],
    intentFit: ['TEAM_BONDING', 'ADVENTURE'],
    intentAvoid: ['IMPRESS', 'RELAX'],
  },
  {
    key: 'WORK_MORNING_MEETUP',
    humanLabel: 'Work meetup — coworking café, walk, brunch',
    slots: [
      { role: 'CONVERSATION_START', isActivity: false },
      { role: 'SCENIC_STROLL', isActivity: true },
      { role: 'BRUNCH', isActivity: false },
    ],
    minGroupSize: 3,
    timeFit: ['MORNING'],
    groupTypeFit: ['WORK'],
    weatherFit: ['DRY'],
    affinityVibes: ['CHILL', 'CREATIVE'],
    contextBoost: 1.5,
    mustInclude: ['CAFE', 'PARK'],
    intentFit: ['TEAM_BONDING', 'CATCH_UP', 'RELAX'],
    intentAvoid: ['ADVENTURE', 'CELEBRATE'],
  },
  {
    key: 'CREATIVE_DAY',
    humanLabel: 'Creative day — pottery / workshop, coffee, dessert',
    slots: [
      { role: 'CREATIVE_HANDS', isActivity: true },
      { role: 'CONVERSATION_START', isActivity: false },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 2,
    maxGroupSize: 5,
    timeFit: ['MORNING', 'AFTERNOON'],
    affinityVibes: ['CREATIVE', 'CULTURAL', 'ROMANTIC'],
    mustInclude: ['POTTERY', 'WORKSHOP', 'PAINTING', 'ART_GALLERY'],
    intentFit: ['EXPLORE', 'CATCH_UP', 'CELEBRATE'],
    intentAvoid: ['ADVENTURE', 'EAT'],
  },
  {
    key: 'CULTURE_DAY',
    humanLabel: 'Culture day — museum or gallery, coffee, dinner',
    slots: [
      { role: 'CULTURE_STOP', isActivity: true },
      { role: 'CONVERSATION_START', isActivity: false },
      { role: 'DINNER', isActivity: false },
    ],
    minGroupSize: 2,
    timeFit: ['MORNING', 'AFTERNOON'],
    affinityVibes: ['CULTURAL', 'CHILL'],
    mustInclude: ['MUSEUM', 'ART_GALLERY'],
    intentFit: ['EXPLORE', 'CATCH_UP', 'FAMILY_TIME'],
    intentAvoid: ['ADVENTURE', 'CELEBRATE'],
  },
  {
    key: 'CHILL_HANG',
    humanLabel: 'Chill hang — coffee, scenic stroll, dessert',
    slots: [
      { role: 'CONVERSATION_START', isActivity: false },
      { role: 'SCENIC_STROLL', isActivity: true },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 2,
    maxGroupSize: 5,
    timeFit: ['AFTERNOON', 'EVENING'],
    weatherFit: ['DRY'],
    affinityVibes: ['CHILL'],
    mustInclude: ['PARK'],
    intentFit: ['RELAX', 'CATCH_UP'],
    intentAvoid: ['ADVENTURE', 'CELEBRATE', 'IMPRESS'],
  },
  {
    key: 'HIGH_ENERGY',
    humanLabel: 'High-energy — arcade / bowling / escape, dinner, dessert',
    slots: [
      { role: 'ENERGETIC_ACTIVITY', isActivity: true },
      { role: 'DINNER', isActivity: false },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 3,
    timeFit: ['AFTERNOON', 'EVENING'],
    groupTypeAvoid: ['DATE'],
    affinityVibes: ['ADVENTUROUS', 'COMPETITIVE'],
    mustInclude: ['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS'],
    intentFit: ['ADVENTURE', 'TEAM_BONDING', 'CATCH_UP'],
    intentAvoid: ['RELAX', 'IMPRESS'],
  },
  {
    key: 'BIG_GROUP_BASH',
    humanLabel: 'Big-group bash — activity, group dinner, dessert or mall',
    slots: [
      { role: 'ENERGETIC_ACTIVITY', isActivity: true },
      { role: 'DINNER', isActivity: false },
      { role: 'SHOPPING_STROLL', isActivity: true },
    ],
    minGroupSize: 5,
    timeFit: ['AFTERNOON', 'EVENING'],
    groupTypeAvoid: ['DATE'],
    // A "bash" needs an actual bash activity, not restaurant-only. Bowling
    // fits 5+ groups best; arcade and escape rooms also count.
    mustInclude: ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS'],
    intentFit: ['ADVENTURE', 'CELEBRATE', 'CATCH_UP', 'TEAM_BONDING'],
    intentAvoid: ['RELAX', 'IMPRESS'],
  },
  {
    key: 'FOODIE_ARC',
    humanLabel: 'Foodie arc — café, restaurant, dessert crawl',
    slots: [
      // Force CAFE-only opener so this doesn't collapse to RESTAURANT →
      // RESTAURANT → DESSERT alongside the DINNER slot.
      { role: 'COFFEE_CLOSE', isActivity: false },
      { role: 'DINNER', isActivity: false },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 2,
    timeFit: ['AFTERNOON', 'EVENING', 'NIGHT'],
    affinityVibes: ['FOODIE', 'ROMANTIC'],
    mustInclude: ['CAFE', 'RESTAURANT'],
    intentFit: ['EAT', 'CELEBRATE', 'IMPRESS', 'CATCH_UP'],
    intentAvoid: ['ADVENTURE', 'EXPLORE'],
  },
  {
    key: 'FAMILY_DAY_OUT',
    humanLabel: 'Family day out — park or museum, kid-friendly restaurant, dessert',
    slots: [
      { role: 'CULTURE_STOP', isActivity: true },
      { role: 'DINNER', isActivity: false },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 3,
    timeFit: ['MORNING', 'AFTERNOON'],
    groupTypeFit: ['FAMILY'],
    contextBoost: 1,
    mustInclude: ['MUSEUM', 'ART_GALLERY', 'PARK'],
    intentFit: ['FAMILY_TIME', 'RELAX', 'EXPLORE'],
    intentAvoid: ['ADVENTURE', 'IMPRESS', 'CELEBRATE'],
  },
  {
    key: 'RAINY_INDOORS',
    humanLabel: 'Rainy day indoors — arcade / escape, dinner, dessert',
    slots: [
      { role: 'ENERGETIC_ACTIVITY', isActivity: true },
      { role: 'DINNER', isActivity: false },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 3,
    timeFit: ['MORNING', 'AFTERNOON', 'EVENING'],
    weatherFit: ['MONSOON'],
    // Arcade / bowling / escape as the anchor is NOT a date arc — CREATIVE_
    // EVENING_DATE covers date + monsoon evening. Same reason SHOPPING_ARC
    // is walled off from DATE below.
    groupTypeAvoid: ['DATE'],
    contextBoost: 1.5,
    mustInclude: ['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS'],
    intentFit: ['ADVENTURE', 'CATCH_UP', 'TEAM_BONDING', 'FAMILY_TIME'],
  },
  {
    key: 'NIGHTLIFE',
    humanLabel: 'Nightlife — cocktails / cafe, dinner, dessert',
    slots: [
      // Open with a lounge cafe instead of another RESTAURANT so the arc
      // doesn't compile to RESTAURANT → RESTAURANT → DESSERT.
      { role: 'COFFEE_CLOSE', isActivity: false },
      { role: 'DINNER', isActivity: false },
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 2,
    maxGroupSize: 6,
    timeFit: ['EVENING', 'NIGHT'],
    groupTypeAvoid: ['FAMILY'],
    affinityVibes: ['FOODIE', 'ROMANTIC'],
    mustInclude: ['CAFE', 'RESTAURANT'],
    intentFit: ['CELEBRATE', 'IMPRESS', 'EAT'],
    intentAvoid: ['RELAX', 'FAMILY_TIME', 'EXPLORE'],
  },
  {
    key: 'MORNING_BRUNCH',
    humanLabel: 'Morning brunch — brunch café, scenic stroll, dessert',
    slots: [
      { role: 'BRUNCH', isActivity: false },
      { role: 'SCENIC_STROLL', isActivity: true },
      // Was COFFEE_CLOSE → produced CAFE → PARK → CAFE. Close on dessert so
      // the arc doesn't collapse to café-bookended.
      { role: 'DESSERT_CLOSE', isActivity: false },
    ],
    minGroupSize: 2,
    timeFit: ['MORNING'],
    affinityVibes: ['CHILL', 'FOODIE', 'ROMANTIC'],
    mustInclude: ['CAFE', 'RESTAURANT', 'PARK'],
    intentFit: ['RELAX', 'CATCH_UP', 'EAT', 'FAMILY_TIME'],
    intentAvoid: ['ADVENTURE'],
  },
  {
    key: 'SHOPPING_ARC',
    humanLabel: 'Shopping arc — mall, café, restaurant',
    slots: [
      { role: 'SHOPPING_STROLL', isActivity: true },
      { role: 'CONVERSATION_START', isActivity: false },
      { role: 'DINNER', isActivity: false },
    ],
    minGroupSize: 2,
    timeFit: ['AFTERNOON', 'EVENING'],
    requiredPref: 'MALL',
    // Shopping isn't a date arc; even when a DATE user picks MALL as a
    // preference we surface it via SHOPPING_ARC on other members, not DATE.
    groupTypeAvoid: ['DATE'],
    contextBoost: 1,
    mustInclude: ['MALL'],
    intentFit: ['CATCH_UP', 'FAMILY_TIME'],
    intentAvoid: ['ADVENTURE', 'RELAX', 'IMPRESS', 'CELEBRATE'],
  },
];

// Map each archetype key to a coarse family for entropy / diversity accounting.
// The key IS the family for Stage 2, but grouped so eval matrices stay readable.
const ARCHETYPE_KEY_TO_FAMILY: Record<ArchetypeKey, string> = {
  INTIMATE_DATE: 'INTIMATE_DATE',
  QUIET_DATE: 'QUIET_DATE',
  CREATIVE_EVENING_DATE: 'CREATIVE_EVENING_DATE',
  ART_NIGHT_DATE: 'ART_NIGHT_DATE',
  CREATIVE_DAY: 'CREATIVE_DAY',
  CULTURE_DAY: 'CULTURE_DAY',
  CHILL_HANG: 'CHILL_HANG',
  HIGH_ENERGY: 'HIGH_ENERGY',
  BIG_GROUP_BASH: 'BIG_GROUP_BASH',
  FOODIE_ARC: 'FOODIE_ARC',
  FAMILY_DAY_OUT: 'FAMILY_DAY_OUT',
  RAINY_INDOORS: 'RAINY_INDOORS',
  NIGHTLIFE: 'NIGHTLIFE',
  MORNING_BRUNCH: 'MORNING_BRUNCH',
  MORNING_CULTURE_TOUR: 'MORNING_CULTURE_TOUR',
  WORK_TEAM_ACTIVITY: 'WORK_TEAM_ACTIVITY',
  WORK_MORNING_MEETUP: 'WORK_MORNING_MEETUP',
  SHOPPING_ARC: 'SHOPPING_ARC',
};

// Resolve a slot role to DB categories. Keep each role tight to categories
// that fit the ROLE, not a grab-bag of fallbacks — the general-purpose
// fallback in selectPlaceForSlot already handles empty pools. Overly-broad
// role resolution is what produced DESSERT→CAFE→CAFE endings.
function resolveRoleToCategories(role: SlotRole, ctx: PlanningContext): string[] {
  switch (role) {
    case 'CONVERSATION_START':
      return ['CAFE', 'RESTAURANT'];
    case 'BRUNCH':
      return ['CAFE', 'RESTAURANT'];
    case 'SCENIC_STROLL':
      return ['PARK'];
    case 'CULTURE_STOP':
      return ['MUSEUM', 'ART_GALLERY'];
    case 'CREATIVE_HANDS':
      // WORKSHOP and PAINTING are sparse in the DB; POTTERY carries the load.
      // ART_GALLERY intentionally excluded — that's CULTURE_STOP's territory.
      return ['POTTERY', 'WORKSHOP', 'PAINTING'];
    case 'ENERGETIC_ACTIVITY':
      // BOWLING / ESCAPE_ROOM thin — include SPORTS + ARCADE fallbacks.
      return ['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS'];
    case 'SHOPPING_STROLL':
      return ['MALL'];
    case 'MOVIE_STOP':
      return ['MOVIE'];
    case 'DINNER':
      return ['RESTAURANT'];
    case 'LATE_EVENING_EATS':
      // Bars & rooftops still show up in DB as RESTAURANT. CAFE only as
      // fallback when no restaurant is available.
      return ['RESTAURANT'];
    case 'DESSERT_CLOSE':
      // Do NOT fall back to CAFE — that produced NIGHTLIFE arcs ending on
      // two cafés. Empty pool triggers the general food fallback which knows
      // to avoid categories already used earlier in the plan.
      return ['DESSERT'];
    case 'COFFEE_CLOSE':
      return ['CAFE'];
  }
}

function scoreArchetypeFit(a: Archetype, ctx: PlanningContext): number {
  let s = 0;

  // Time-of-day: hard fit is checked separately; boost when explicit match.
  if (a.timeFit.includes(ctx.timeBucket)) s += 2;

  // Weather
  if (a.weatherFit) {
    if (a.weatherFit.includes(ctx.weather)) s += 2;
    else s -= 4; // strong penalty: e.g. scenic stroll in monsoon
  }

  // Group-type fit / avoid
  if (a.groupTypeFit && a.groupTypeFit.includes(ctx.groupType)) s += 3;
  if (a.groupTypeAvoid && a.groupTypeAvoid.includes(ctx.groupType)) s -= 4;

  // Group-size within bounds
  const gs = ctx.groupSize;
  if (a.minGroupSize && gs < a.minGroupSize) s -= 5;
  if (a.maxGroupSize && gs > a.maxGroupSize) s -= 5;

  // Explicit user preference presence
  if (a.requiredPref) {
    const prefs = new Set(ctx.preferredCategories);
    if (!prefs.has(a.requiredPref)) s -= 8; // essentially disqualifies
    else s += 3;
  }

  // Preference overlap with slot roles' resolved categories.
  // MUCH stronger signal — a user asking for Museum + Park should aggressively
  // push the planner toward archetypes that already carry those categories in
  // specialised slots, not just sprinkle prefs in as scoring nudges. Weight
  // grows with how *specialised* the matched slot is: an ART_GALLERY-slot
  // hitting a Museum pref is worth more than a CAFE slot happening to include
  // RESTAURANT (which is what CONVERSATION_START does by default).
  const prefs = new Set(ctx.preferredCategories);
  if (prefs.size > 0) {
    let overlap = 0;
    let specialisedOverlap = 0;
    let coveredPrefs = new Set<string>();
    for (const slot of a.slots) {
      const cats = resolveRoleToCategories(slot.role, ctx);
      const upperCats = cats.map(c => c.toUpperCase());
      const matched = upperCats.filter(c => prefs.has(c));
      if (matched.length > 0) {
        overlap++;
        matched.forEach(m => coveredPrefs.add(m));
        if (upperCats.some(c => SPECIALIZED_SLOT_CATEGORIES.has(c))) {
          specialisedOverlap++;
        }
      }
    }
    s += overlap * 3;                    // was +1 per slot; now +3
    s += specialisedOverlap * 3;         // extra +3 per specialised slot hit
    // Reward covering MORE distinct preferences (Museum+Park > Museum+Museum)
    s += coveredPrefs.size * 2;
    if (overlap === 0) s -= 6;           // hard penalty when nothing matches
  }

  // Vibe affinity
  if (a.affinityVibes && ctx.vibes.length > 0) {
    const vibeSet = new Set(ctx.vibes);
    if (a.affinityVibes.some(v => vibeSet.has(v))) s += 2;
  }

  // Intent alignment — the FIRST planning signal. An archetype that serves
  // this intent gets a strong boost; one that avoids it gets a strong
  // penalty. This is what makes "anniversary date" and "first date" produce
  // different plans even when everything else is equal.
  if (a.intentFit && a.intentFit.includes(ctx.intent)) s += 4;
  if (a.intentAvoid && a.intentAvoid.includes(ctx.intent)) s -= 5;

  // Options that request a specific arc
  if (ctx.isMoreActivities && (a.key === 'HIGH_ENERGY' || a.key === 'BIG_GROUP_BASH' || a.key === 'RAINY_INDOORS')) s += 2;
  if (ctx.isMoreFood && a.key === 'FOODIE_ARC') s += 3;
  if (ctx.isMoreCreative && a.key === 'CREATIVE_DAY') s += 3;
  if (ctx.isMoreRomantic && (a.key === 'INTIMATE_DATE' || a.key === 'CHILL_HANG' || a.key === 'MORNING_BRUNCH')) s += 2;
  if (ctx.isMoreIndoor && a.key === 'RAINY_INDOORS') s += 2;
  if (ctx.isMoreIndoor && (a.key === 'INTIMATE_DATE' || a.key === 'CHILL_HANG' || a.key === 'MORNING_BRUNCH')) s -= 3;

  // Small always-on bump (e.g. FAMILY_DAY_OUT, SHOPPING_ARC when pref matched)
  s += a.contextBoost ?? 0;

  return s;
}

function archetypeHardEligible(a: Archetype, ctx: PlanningContext): boolean {
  const gs = ctx.groupSize;
  if (a.minGroupSize && gs < a.minGroupSize) return false;
  if (a.maxGroupSize && gs > a.maxGroupSize) return false;
  if (!a.timeFit.includes(ctx.timeBucket)) return false;
  if (a.weatherFit && !a.weatherFit.includes(ctx.weather)) return false;
  if (a.groupTypeFit && !a.groupTypeFit.includes(ctx.groupType)) return false;
  if (a.groupTypeAvoid && a.groupTypeAvoid.includes(ctx.groupType)) return false;
  if (a.requiredPref && !ctx.preferredCategories.includes(a.requiredPref)) return false;
  // Nightlife needs at least evening time
  if (a.key === 'NIGHTLIFE' && ctx.timeBucket === 'MORNING') return false;
  return true;
}

export interface ArchetypePick {
  archetype: Archetype;
  template: ItineraryTemplate;
  archetypeKey: ArchetypeKey;
  archetypeFamily: string;
}

function compileArchetypeToTemplate(a: Archetype, ctx: PlanningContext): ItineraryTemplate {
  const [s1, s2, s3] = a.slots;
  const to = (r: SlotRole) => resolveRoleToCategories(r, ctx);
  const raw = {
    slot1: to(s1.role), slot1Act: s1.isActivity,
    slot2: to(s2.role), slot2Act: s2.isActivity,
    slot3: to(s3.role), slot3Act: s3.isActivity,
  };
  // Whole-arc realism guard: when CONVERSATION_START (=[CAFE,RESTAURANT])
  // sits next to a DINNER (=[RESTAURANT]) slot, drop RESTAURANT from the
  // opener so we don't compile RESTAURANT → RESTAURANT patterns. Same for
  // LATE_EVENING_EATS next to DINNER.
  const isDinnerRole = (role: SlotRole) => role === 'DINNER';
  const dropRestaurantIfAdjacentToDinner = (slotCats: string[], role: SlotRole, neighbours: SlotRole[]) => {
    if (role !== 'CONVERSATION_START' && role !== 'LATE_EVENING_EATS' && role !== 'BRUNCH') return slotCats;
    if (!neighbours.some(isDinnerRole)) return slotCats;
    const trimmed = slotCats.filter(c => c !== 'RESTAURANT');
    return trimmed.length > 0 ? trimmed : slotCats; // never leave the slot empty
  };
  raw.slot1 = dropRestaurantIfAdjacentToDinner(raw.slot1, s1.role, [s2.role]);
  raw.slot2 = dropRestaurantIfAdjacentToDinner(raw.slot2, s2.role, [s1.role, s3.role]);
  raw.slot3 = dropRestaurantIfAdjacentToDinner(raw.slot3, s3.role, [s2.role]);
  return raw;
}

/**
 * Pick `count` distinct archetypes for the given planning context. Strictly
 * hierarchical: eligibility (hard filter) → fit score → greedy family-diverse
 * selection. Compiles each pick to an ItineraryTemplate so the existing
 * selectPlaceForSlot / cost-decomposition machinery keeps working.
 */
export function pickArchetypesForContext(
  ctx: PlanningContext,
  count = 4
): ArchetypePick[] {
  const eligible = ARCHETYPES.filter(a => archetypeHardEligible(a, ctx));

  interface Scored { a: Archetype; fit: number; }
  const scored: Scored[] = eligible.map(a => ({ a, fit: scoreArchetypeFit(a, ctx) }));

  // Jitter for tie-break, but small — we want fit to dominate.
  scored.sort((x, y) => (y.fit + Math.random() * 0.3) - (x.fit + Math.random() * 0.3));

  const picked: Scored[] = [];
  const usedFamilies = new Set<string>();
  const usedLeadRoles = new Set<SlotRole>();

  // Pass 1: distinct archetype key (Stage 2 families are 1:1 with keys).
  for (const s of scored) {
    if (picked.length >= count) break;
    if (!usedFamilies.has(s.a.key)) {
      picked.push(s);
      usedFamilies.add(s.a.key);
      usedLeadRoles.add(s.a.slots[0].role);
    }
  }
  // Pass 2: distinct lead role.
  for (const s of scored) {
    if (picked.length >= count) break;
    if (picked.some(p => p.a === s.a)) continue;
    if (!usedLeadRoles.has(s.a.slots[0].role)) {
      picked.push(s);
      usedLeadRoles.add(s.a.slots[0].role);
    }
  }
  // Pass 3: absolute fill by fit.
  for (const s of scored) {
    if (picked.length >= count) break;
    if (picked.some(p => p.a === s.a)) continue;
    picked.push(s);
  }

  return picked.map(s => ({
    archetype: s.a,
    template: compileArchetypeToTemplate(s.a, ctx),
    archetypeKey: s.a.key,
    archetypeFamily: ARCHETYPE_KEY_TO_FAMILY[s.a.key],
  }));
}

/**
 * Debug helper for tests / eval instrumentation.
 */
export function debugPickArchetypes(ctx: PlanningContext, count = 4) {
  return pickArchetypesForContext(ctx, count).map(p => ({
    key: p.archetypeKey,
    family: p.archetypeFamily,
    shape: `${p.template.slot1[0]}->${p.template.slot2[0]}->${p.template.slot3[0]}`,
    label: p.archetype.humanLabel,
  }));
}

const OVERLAY_ACTIVITY_CATS = new Set([
  'ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'MUSEUM', 'SPORTS',
  'POTTERY', 'PAINTING', 'WORKSHOP', 'MOVIE', 'ART_GALLERY',
  'MALL', 'PARK'
]);

/**
 * Overlay user preferences onto a template without erasing its archetype
 * character. Rule: if a slot's original categories ALREADY include a user
 * preference, leave the slot alone — the template's archetype is intact and
 * we don't want a MUSEUM-lead arc to be re-labelled as ARCADE just because
 * the user also mentioned ARCADE. If there is NO overlap, append the prefs
 * as fallback options so selectPlaceForSlot can pick them when the primary
 * category has no local venues. This preserves the distinct-family output
 * that pickArchetypeTemplates worked to produce.
 */
// Roles that carry specific archetype meaning (creative hands, culture stop,
// scenic stroll, ...) — overlay must not pollute these. Otherwise a
// CREATIVE_EVENING_DATE with user pref=[MALL] would compile to MALL→CAFE→
// DESSERT and lose its "pottery + cafe + dessert" story. These roles are
// identified by the CATEGORIES the template already declares.
const SPECIALIZED_SLOT_CATEGORIES = new Set([
  'POTTERY', 'WORKSHOP', 'PAINTING',        // creative hands
  'MUSEUM', 'ART_GALLERY', 'ART_EXHIBITION', // culture stop
  'PARK',                                     // scenic stroll
  'ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS', // energetic activity
  'MALL',                                     // shopping stroll
  'MOVIE',                                    // movie stop
]);

export function overlayPreferencesOntoTemplate(
  t: ItineraryTemplate,
  preferredCategories: string[]
): ItineraryTemplate {
  const prefs = (preferredCategories || [])
    .map(c => c.toUpperCase())
    .filter(c => SELECTABLE_PLACE_CATEGORIES.has(c));
  if (prefs.length === 0) return t;

  const prefActs = prefs.filter(c => OVERLAY_ACTIVITY_CATS.has(c));
  const prefFood = prefs.filter(c => !OVERLAY_ACTIVITY_CATS.has(c));

  const merge = (slot: string[], isAct: boolean): string[] => {
    const overlay = isAct ? prefActs : prefFood;
    if (overlay.length === 0) return slot;
    const upperSlot = slot.map(s => s.toUpperCase());
    const hasOverlap = upperSlot.some(s => overlay.includes(s));
    if (hasOverlap) return slot;
    // If the slot is already specialised (pottery / museum / arcade / park /
    // mall / movie), do NOT pollute it with unrelated preferences — that
    // destroys the archetype's story. Preferences the user cares about will
    // still surface in other archetypes' plans.
    const isSpecialised = upperSlot.some(c => SPECIALIZED_SLOT_CATEGORIES.has(c));
    if (isSpecialised) return slot;
    return Array.from(new Set([...upperSlot, ...overlay]));
  };

  return {
    slot1: merge(t.slot1, t.slot1Act), slot1Act: t.slot1Act,
    slot2: merge(t.slot2, t.slot2Act), slot2Act: t.slot2Act,
    slot3: merge(t.slot3, t.slot3Act), slot3Act: t.slot3Act,
  };
}

/**
 * Test-only accessor so the eval harness / tests can inspect the picker.
 */
export function debugPickArchetypeTemplates(
  ctx: PlanningContext,
  pool: 'DATE' | 'GENERAL' = 'GENERAL',
  count = 4
): { template: ItineraryTemplate; family: ArchetypeFamily; leadCategory: string }[] {
  const templates = pickArchetypeTemplates(
    ctx,
    pool === 'DATE' ? DATE_ITINERARY_TEMPLATES : ITINERARY_TEMPLATES,
    count
  );
  return templates.map(t => {
    const meta = deriveTemplateMeta(t);
    return { template: t, family: meta.family, leadCategory: meta.leadCategory };
  });
}

export function generateWhyRecommended(plan: any, groupData: any): string[] {
  const reasons: string[] = [];

  // 1. Travel compatibility
  if (plan.longestTravelTime <= 45) {
    reasons.push("âœ“ Everyone travels under 45 min");
  } else if (plan.longestTravelTime <= 60) {
    reasons.push("âœ“ Max travel time under 1 hour");
  } else {
    reasons.push("âœ“ Balanced travel times for group");
  }

  // 2. Budget compatibility
  if (plan.budgetTier === 'BUDGET_FRIENDLY' || plan.budgetTier === 'TRAVEL_FRIENDLY') {
    reasons.push("âœ“ Highly pocket-friendly costs");
  } else if (plan.budgetScore >= 0.8) {
    reasons.push("âœ“ Fits group budget parameters");
  }

  // 3. Venue quality / Highest rated
  const slots = plan.slots || [];
  const ratings = slots.map((s: any) => s.rating).filter((r: any) => r !== null && r !== undefined);
  if (ratings.length > 0) {
    const maxRating = Math.max(...ratings);
    if (maxRating >= 4.5) {
      const bestSlot = slots.find((s: any) => s.rating === maxRating);
      reasons.push(`âœ“ Includes top-rated ${bestSlot?.name || 'venue'} (${maxRating}â˜…)`);
    } else {
      reasons.push("âœ“ High quality venue selection");
    }
  }

  // 4. Weather / Monsoon safety
  const isRainySeason = (() => {
    if (!groupData?.outingDate) return false;
    const parts = groupData.outingDate.split('-');
    if (parts.length < 2) return false;
    const month = parseInt(parts[1]);
    return [6, 7, 8].includes(month); // June, July, August
  })();
  if (isRainySeason) {
    const hasOutdoor = slots.some((s: any) => ['PARK', 'PROMENADE', 'BEACH', 'OUTDOOR'].includes(s.category.toUpperCase()));
    if (!hasOutdoor) {
      reasons.push("âœ“ 100% indoor/monsoon protected");
    } else {
      reasons.push("âœ“ Monsoon active - outdoor travel caution");
    }
  }

  // 5. Vibe / Preference fit
  const overallFit = Math.round(plan.score * 100);
  reasons.push(`âœ“ Fits ${overallFit}% of preferences`);

  return reasons;
}


function getSlotDescription(slotName: string, category: string, zoneName: string): string {
  const cat = category.toUpperCase();
  const descriptions: Record<string, string> = {
    'CAFE': `Grab some coffee at ${slotName}, check out the menu, and chat while everyone gathers.`,
    'RESTAURANT': `Recharge at ${slotName} and share stories over delicious dishes together.`,
    'PARK': `Catch the evening breeze at ${slotName}, walk around, and take group photos.`,
    'MALL': `Window shop at ${slotName}, cool off in the AC, and explore group hangouts.`,
    'DESSERT': `Grab milkshakes, ice cream, or waffles at ${slotName} for a great final chat.`,
    'ARCADE': `Unleash your competitive streak at ${slotName} with simulator games and group challenges.`,
    'BOWLING': `Lace up your bowling shoes at ${slotName} and challenge the group to a match.`,
    'ESCAPE_ROOM': `Put your heads together at ${slotName}, crack the clues, and escape.`,
    'MUSEUM': `Explore exhibits and interactive displays at ${slotName} together.`,
    'SPORTS': `Fun and games at ${slotName} to get the blood pumping.`,
    'MOVIE': `Catch a movie at ${slotName} with the group.`,
    'POTTERY': `Get creative at ${slotName} with a hands-on pottery session.`,
    'WORKSHOP': `Learn something new at ${slotName} with a fun group workshop.`,
  };
  return descriptions[cat] || `Meet up at ${slotName} in ${zoneName} to hang out with the group.`;
}

export async function buildFallbackItineraryDataForEval(
  planIndex: number,
  groupData: any,
  presentMembers: any[],
  presentLocations: any[],
  memberLocations?: LatLng[],
  groupBudget?: number,
  options: string[] = []
) {
  return await buildFallbackItineraryData(planIndex, groupData, presentMembers, presentLocations, memberLocations, groupBudget, undefined, options);
}

function getDurationForCategory(category: string): number {
  const cat = category.toUpperCase();
  if (cat === 'PARK') return 60;
  if (cat === 'DESSERT') return 45;
  if (cat === 'CAFE') return 90;
  if (cat === 'RESTAURANT') return 90;
  if (cat === 'MALL') return 120;
  if (cat === 'ARCADE' || cat === 'BOWLING') return 120;
  if (cat === 'ESCAPE_ROOM') return 90;
  if (cat === 'MUSEUM') return 120;
  if (cat === 'SPORTS' || cat === 'POTTERY' || cat === 'WORKSHOP') return 120;
  return 90;
}



async function buildFallbackItineraryData(
  planIndex: number,
  groupData: any,
  presentMembers: any[],
  presentLocations: any[],
  memberLocations?: LatLng[],
  groupBudget?: number,
  globalUsedPlaceIds?: Set<string>,
  options: string[] = []
) {
  const budgetTiers = ['TRAVEL_FRIENDLY', 'BUDGET_FRIENDLY', 'BALANCED', 'EXPERIENCE_FIRST'] as const;
  const budgetTier = budgetTiers[(planIndex - 1) % 4];

  // Dynamically pick best zone from member locations instead of using hardcoded zones
  const locs = memberLocations && memberLocations.length > 0
    ? memberLocations
    : presentLocations.map((l: any) => ({ lat: l.lat, lng: l.lng }));

  const rankedZones = locs.length > 0 ? selectCandidateZones(locs) : [
    { name: 'Bandra', lat: 19.0596, lng: 72.8295 },
    { name: 'Dadar', lat: 19.0178, lng: 72.8478 },
    { name: 'Kurla', lat: 19.0607, lng: 72.8826 },
    { name: 'Ghatkopar', lat: 19.0860, lng: 72.9082 },
  ];

  const zoneIdx = (planIndex - 1) % Math.max(1, rankedZones.length);
  const zoneObj = rankedZones[zoneIdx];

  const budgetCap = groupBudget && groupBudget > 0 ? groupBudget : 5000;
  const TRAVEL_EST = 80;
  const venueTotal = Math.max(0, budgetCap - TRAVEL_EST);

  const outingHour = (() => {
    const t = groupData.outingTime || '12:00';
    const m = t.match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1]) : 12;
  })();

  const hasMoviePreference = (groupData.activity && String(groupData.activity).toLowerCase().includes('movie')) ||
    (groupData.outingType && String(groupData.outingType).toLowerCase().includes('movie'));

  // Query actual places from the database within radius Km of the fallback zone
  const radiusKm = 6.0;
  const latDiff = radiusKm / 111.0;
  const lngDiff = radiusKm / (111.0 * Math.cos(zoneObj.lat * Math.PI / 180));

  let dbPlaces = await db
    .select({
      id: places.id,
      name: places.name,
      category: placeCategories.category,
      rating: places.rating,
      reviewCount: places.reviewCount,
      lat: places.lat,
      lng: places.lng,
      imageUrl: places.imageUrl,
      address: places.address,
      mandatoryCost: placeCosts.mandatoryCost,
      optionalCostMin: placeCosts.optionalCostMin,
      optionalCostMax: placeCosts.optionalCostMax
    })
    .from(places)
    .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
    .innerJoin(placeCosts, eq(placeCosts.placeId, places.id))
    .where(
      and(
        between(places.lat, zoneObj.lat - latDiff, zoneObj.lat + latDiff),
        between(places.lng, zoneObj.lng - lngDiff, zoneObj.lng + lngDiff)
      )
    )
    .catch(() => [] as any[]);

  let candidates = dbPlaces
    .map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      rating: p.rating || 4.0,
      lat: p.lat,
      lng: p.lng,
      estimatedCostPerHead: p.mandatoryCost + p.optionalCostMin,
      address: p.address || '',
      openNow: true,
      mandatoryCost: p.mandatoryCost,
      optionalCostMin: p.optionalCostMin,
      optionalCostMax: p.optionalCostMax,
      imageUrl: p.imageUrl || null
    }))
    .filter((c: any) => hasMoviePreference || c.category.toUpperCase() !== 'MOVIE')
    .filter((c: any) => isHangoutWorthyCandidate(c));

  // If no candidates found in the zone, fetch ANY places from the database
  if (candidates.length < 5) {
    const allPlaces = await db
      .select({
        id: places.id,
        name: places.name,
        category: placeCategories.category,
        rating: places.rating,
        reviewCount: places.reviewCount,
        lat: places.lat,
        lng: places.lng,
        imageUrl: places.imageUrl,
        address: places.address,
        mandatoryCost: placeCosts.mandatoryCost,
        optionalCostMin: placeCosts.optionalCostMin,
        optionalCostMax: placeCosts.optionalCostMax
      })
      .from(places)
      .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
      .innerJoin(placeCosts, eq(placeCosts.placeId, places.id))
      .limit(200)
      .catch(() => [] as any[]);

    candidates = allPlaces
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        rating: p.rating || 4.0,
        lat: p.lat,
        lng: p.lng,
        estimatedCostPerHead: p.mandatoryCost + p.optionalCostMin,
        address: p.address || '',
        openNow: true,
        mandatoryCost: p.mandatoryCost,
        optionalCostMin: p.optionalCostMin,
        optionalCostMax: p.optionalCostMax,
        imageUrl: p.imageUrl || null
      }))
      .filter((c: any) => hasMoviePreference || c.category.toUpperCase() !== 'MOVIE')
      .filter((c: any) => isHangoutWorthyCandidate(c));
  }

  // Set the fallback zone coordinate to the centroid/average of selected candidates to make travel math work correctly
  let activeZoneObj = zoneObj;
  if (candidates.length > 0) {
    const firstCand = candidates[0];
    activeZoneObj = {
      name: getVenueZone(firstCand.lat, firstCand.lng, firstCand.name, firstCand.address) || zoneObj.name,
      lat: firstCand.lat,
      lng: firstCand.lng
    };
  }

  const globalUsed = globalUsedPlaceIds || new Set<string>();

  let parsedOptions: string[] = options || [];
  if (parsedOptions.length === 0 && groupData && groupData.generationOptions) {
    try {
      const parsed = JSON.parse(groupData.generationOptions);
      if (Array.isArray(parsed)) {
        parsedOptions = parsed;
      }
    } catch {
      try {
        parsedOptions = String(groupData.generationOptions).split(',').map(o => o.trim());
      } catch {}
    }
  }

  const isMoreAct = parsedOptions.includes('More Activities');
  const isMoreCr = parsedOptions.includes('More Creative');
  const isMoreFd = parsedOptions.includes('More Food');
  const isLarge = presentMembers.length >= 5;
  const isDate = String(groupData.groupType ?? '').toUpperCase() === 'DATE';

  function pickAffordableSlots(): PlaceCandidate[] {
    const used = new Set<string>();
    const picks: PlaceCandidate[] = [];

    let requiredCats: string[] = [];
    let maxCosts: number[] = [Infinity, Infinity, Infinity];

    if (isDate) {
      if (isMoreAct) {
        requiredCats = ['ARCADE', 'RESTAURANT', 'DESSERT'];
      } else if (isMoreCr) {
        requiredCats = ['POTTERY', 'CAFE', 'DESSERT'];
      } else if (isMoreFd) {
        requiredCats = ['CAFE', 'RESTAURANT', 'DESSERT'];
      } else {
        requiredCats = ['CAFE', 'PARK', 'DESSERT'];
      }
    } else if (isMoreAct) {
      requiredCats = ['ARCADE', 'RESTAURANT', 'BOWLING'];
    } else if (isMoreCr) {
      requiredCats = ['POTTERY', 'CAFE', 'WORKSHOP'];
    } else if (isMoreFd) {
      requiredCats = ['CAFE', 'RESTAURANT', 'DESSERT'];
    } else if (isLarge) {
      requiredCats = ['BOWLING', 'RESTAURANT', 'ARCADE'];
    } else if (budgetTier === 'BUDGET_FRIENDLY') {
      requiredCats = ['MALL', 'CAFE', 'PARK'];
      maxCosts = [0, 250, 0];
    } else if (budgetTier === 'TRAVEL_FRIENDLY') {
      requiredCats = ['PARK', 'CAFE', 'DESSERT'];
      maxCosts = [0, 300, 250];
    } else if (budgetTier === 'EXPERIENCE_FIRST') {
      requiredCats = [
        (candidates.some((c: any) => c.category === 'BOWLING') ? 'BOWLING' : 'ARCADE'),
        'RESTAURANT',
        'DESSERT'
      ];
      maxCosts = [Infinity, Infinity, Infinity];
    } else { // BALANCED
      requiredCats = ['ARCADE', 'RESTAURANT', 'PARK'];
      maxCosts = [600, 500, 0];
    }

    for (let i = 0; i < 3; i++) {
      const cat = requiredCats[i];
      const maxC = maxCosts[i];

      const matchingCandidates = candidates.filter((c: any) =>
        c.category.toUpperCase() === cat &&
        !used.has(c.id) &&
        !globalUsed.has(c.id) &&
        c.estimatedCostPerHead <= maxC &&
        isVenueOpenAtTime(c.category, groupData.outingTime)
      );
      
      let candidate: PlaceCandidate | undefined = matchingCandidates[Math.floor(Math.random() * Math.min(3, matchingCandidates.length))];

      if (!candidate) {
        const relaxedMatches = candidates.filter((c: any) =>
          c.category.toUpperCase() === cat &&
          !used.has(c.id) &&
          !globalUsed.has(c.id) &&
          isVenueOpenAtTime(c.category, groupData.outingTime)
        );
        if (relaxedMatches.length > 0) {
          candidate = relaxedMatches[Math.floor(Math.random() * Math.min(3, relaxedMatches.length))];
        }
      }

      if (!candidate) {
        const anyCatMatches = candidates.filter((c: any) =>
          !used.has(c.id) &&
          !globalUsed.has(c.id) &&
          c.estimatedCostPerHead <= maxC &&
          isVenueOpenAtTime(c.category, groupData.outingTime)
        );
        if (anyCatMatches.length > 0) {
          candidate = anyCatMatches[Math.floor(Math.random() * Math.min(3, anyCatMatches.length))];
        }
      }

      if (candidate) {
        picks.push(candidate);
        used.add(candidate.id);
        globalUsed.add(candidate.id);
      }
    }

    while (picks.length < 3) {
      const pad = candidates.find((c: any) => !used.has(c.id) && !globalUsed.has(c.id));
      if (pad) {
        picks.push(pad);
        used.add(pad.id);
        globalUsed.add(pad.id);
      } else {
        const padRelaxed = candidates.find((c: any) => !used.has(c.id));
        if (padRelaxed) {
          picks.push(padRelaxed);
          used.add(padRelaxed.id);
        } else {
          break;
        }
      }
    }
    return picks.slice(0, 3);
  }

  const selectedPlaces = pickAffordableSlots();

  const slots = selectedPlaces.map((place, slotIdx) => {
    const duration = getDurationForCategory(place.category);
    let arrivalTime = groupData.outingTime || '11:00 AM';
    if (slotIdx > 0) {
      let prevTime = groupData.outingTime || '11:00 AM';
      for (let i = 0; i < slotIdx; i++) {
        const prevPlace = selectedPlaces[i];
        const prevDuration = getDurationForCategory(prevPlace.category);
        const prevTransit = 15;
        prevTime = addMinutesToTimeString(prevTime, prevDuration + prevTransit);
      }
      arrivalTime = prevTime;
    }

    // Prefer real DB-derived costs when present (populated in getZoneVenues
    // from placeCosts). Only fall back to the category heuristic when they
    // are truly missing. The old code unconditionally re-derived from
    // estimatedCostPerHead, which threw away accurate ₹450 mandatory /
    // ₹120 minimum drink numbers from the DB.
    const dbMand = (place as any).mandatoryCost;
    const dbOptMin = (place as any).optionalCostMin;
    const dbOptMax = (place as any).optionalCostMax;
    const est = place.estimatedCostPerHead;
    const cat = place.category.toUpperCase();

    let mandatoryCost: number;
    let optionalCostMin: number;
    let optionalCostMax: number;

    if (dbMand !== undefined && dbMand !== null) {
      mandatoryCost = dbMand;
      optionalCostMin = dbOptMin ?? 0;
      optionalCostMax = dbOptMax ?? 0;
    } else if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(cat)) {
      mandatoryCost = Math.round(est * 0.4);
      optionalCostMin = Math.round(est * 0.6);
      optionalCostMax = Math.round(est * 1.5);
    } else if (place.isExperience) {
      mandatoryCost = est;
      optionalCostMin = 0;
      optionalCostMax = 0;
    } else {
      mandatoryCost = Math.round(est * 0.7);
      optionalCostMin = Math.round(est * 0.3);
      optionalCostMax = Math.round(est * 1.0);
    }

    return {
      order: slotIdx + 1,
      venueId: place.isExperience ? null : place.id,
      experienceId: place.isExperience ? place.id : null,
      name: place.name,
      category: place.category,
      arrivalTime,
      durationMinutes: duration,
      travelToNextMinutes: slotIdx === 2 ? null : 15,
      // Show what the user WILL spend on average (mandatory + typical
      // discretionary min), not the raw catalog headline. Matches what the
      // plan-total ₹s sum to.
      estimatedCostPerHead: mandatoryCost + optionalCostMin,
      mandatoryCost,
      optionalCostMin,
      optionalCostMax,
      imageUrl: isDisallowedItineraryImage(place.imageUrl) ? getFallbackImageUrl(place.category) : place.imageUrl,
      link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`,
      note: getSlotDescription(place.name, place.category, activeZoneObj.name),
      lat: place.lat,
      lng: place.lng,
      address: place.address || ''
    };
  });

  for (let sIdx = 0; sIdx < slots.length - 1; sIdx++) {
    const current = slots[sIdx];
    const next = slots[sIdx + 1];
    const hop = calculateMumbaiTravelBreakdown(
      { lat: current.lat, lng: current.lng },
      { lat: next.lat, lng: next.lng },
      groupData?.outingTime
    );

    current.travelToNextMinutes = hop.totalTime;
    (current as any).travelToNextCost = Math.ceil(hop.totalCost / Math.min(3, presentMembers.length));
    (current as any).travelToNextMode = hop.trainTime > 0 ? 'TRAIN' : hop.autoTime > 0 ? 'AUTO' : 'WALK';
    (current as any).travelToNextBreakdown = {
      walkMin: hop.walkingTime,
      autoMin: hop.autoTime,
      trainMin: hop.trainTime,
    };
    next.arrivalTime = addMinutesToTimeString(current.arrivalTime, current.durationMinutes + hop.totalTime);
  }

  const memberTravelsForPlan: any[] = [];
  const totalTimes: number[] = [];
  const totalCosts: number[] = [];

  presentLocations.forEach(loc => {
    const breakdown = calculateMumbaiTravelBreakdown({ lat: loc.lat, lng: loc.lng }, { lat: activeZoneObj.lat, lng: activeZoneObj.lng }, groupData.outingTime);
    
    totalTimes.push(breakdown.totalTime);
    totalCosts.push(breakdown.totalCost);

    const travelId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

    memberTravelsForPlan.push({
      id: travelId,
      userId: loc.userId,
      walkingTime: breakdown.walkingTime,
      autoTime: breakdown.autoTime,
      autoCost: breakdown.autoCost,
      trainTime: breakdown.trainTime,
      trainCost: breakdown.trainCost,
      totalTime: breakdown.totalTime,
      totalCost: breakdown.totalCost,
      train_time: breakdown.trainTime,
      train_cost: breakdown.trainCost,
      cab_time: breakdown.autoTime,
      cab_cost: breakdown.autoCost,
      walk_time: breakdown.walkingTime
    });
  });

  const avgTotalTime = Math.round(totalTimes.reduce((sum, t) => sum + t, 0) / totalTimes.length);
  const avgTotalCost = Math.round(totalCosts.reduce((sum, c) => sum + c, 0) / totalCosts.length);
  const longestTravelTime = Math.max(...totalTimes);
  const shortestTravelTime = Math.min(...totalTimes);

  const variance = totalTimes.reduce((sum, t) => sum + Math.pow(t - avgTotalTime, 2), 0) / totalTimes.length;
  const stdDev = Math.sqrt(variance);
  const travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30.0);

  const slotsMandatoryCost = slots.reduce((sum, s) => sum + s.mandatoryCost, 0);
  const slotsOptionalMin = slots.reduce((sum, s) => sum + s.optionalCostMin, 0);
  const slotsOptionalMax = slots.reduce((sum, s) => sum + s.optionalCostMax, 0);

  const totalMandatoryCost = slotsMandatoryCost + avgTotalCost;

  const planId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

  const avgTrainTime = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.trainTime || 0), 0) / memberTravelsForPlan.length)
    : 0;
  const avgTrainCost = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.trainCost || 0), 0) / memberTravelsForPlan.length)
    : 0;
  const avgAutoTime = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.autoTime || 0), 0) / memberTravelsForPlan.length)
    : 0;
  const avgAutoCost = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.autoCost || 0), 0) / memberTravelsForPlan.length)
    : 0;
  const avgWalkTime = memberTravelsForPlan.length > 0
    ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.walkingTime || 0), 0) / memberTravelsForPlan.length)
    : 0;

  let tagline = `A wonderful day out in ${activeZoneObj.name}.`;
  if (budgetTier === 'TRAVEL_FRIENDLY') {
    tagline = `A commute-optimized day out in ${activeZoneObj.name} designed to minimize travel for everyone.`;
  } else if (budgetTier === 'BUDGET_FRIENDLY') {
    tagline = `A pocket-friendly day out exploring scenic walks and cozy local spots in ${activeZoneObj.name}.`;
  } else if (budgetTier === 'BALANCED') {
    tagline = `A well-balanced itinerary featuring top-rated cafes and relaxing spots in ${activeZoneObj.name}.`;
  } else if (budgetTier === 'EXPERIENCE_FIRST') {
    tagline = `An excitement-filled day highlighting the best food, gaming, and premium experiences in ${activeZoneObj.name}.`;
  }

  let whyRecommended: string[] = [];
  if (budgetTier === 'TRAVEL_FRIENDLY') {
    whyRecommended = [
      "Optimized for minimal travel time",
      `Average travel time ${avgTotalTime} minutes`,
      `Longest commute only ${longestTravelTime} minutes`,
      "Fairly distributed transit costs"
    ];
  } else if (budgetTier === 'BUDGET_FRIENDLY') {
    whyRecommended = [
      "Lowest overall cost per head",
      `98% budget compatibility`,
      "Pocket-friendly cafes and stops",
      "Saves budget for future outings"
    ];
  } else if (budgetTier === 'BALANCED') {
    whyRecommended = [
      "Best overall match score",
      `Average travel time ${avgTotalTime} mins`,
      `Matches ${groupData.groupType?.toLowerCase() || 'friends'} vibe`,
      "Highly rated popular spots"
    ];
  } else { // EXPERIENCE_FIRST
    whyRecommended = [
      "Top-rated experiences nearby",
      "Premium food and entertainment",
      "Includes trending group activities",
      "Highest overall venue ratings"
    ];
  }

  // Hard budget ceiling — even the fallback builder honors it. If the built
  // plan can't fit budget × 1.10, throw so the caller can retry with cheaper
  // venues (or return fewer plans). Same rule as the main constraint stack.
  const fallbackPlanCost = totalMandatoryCost + slotsOptionalMin;
  if (groupBudget && groupBudget > 0 && fallbackPlanCost > groupBudget * 1.10) {
    throw new Error(`FALLBACK_OVER_BUDGET: ₹${fallbackPlanCost} > ₹${Math.round(groupBudget * 1.10)}`);
  }

  return {
    id: planId,
    groupId: groupData.id,
    planIndex,
    name: activeZoneObj.name,
    tagline,
    budgetTier,
    totalEstimatedCostPerHead: fallbackPlanCost,
    totalDurationMinutes: slots.reduce((sum, s) => sum + s.durationMinutes, 0) + (slots[0].travelToNextMinutes || 0) + (slots[1].travelToNextMinutes || 0),
    score: budgetTier === 'BALANCED' ? 0.95 : (budgetTier === 'TRAVEL_FRIENDLY' ? 0.92 : (budgetTier === 'EXPERIENCE_FIRST' ? 0.88 : 0.82)),

    experienceScore: budgetTier === 'EXPERIENCE_FIRST' ? 0.95 : 0.82,
    travelScore: budgetTier === 'TRAVEL_FRIENDLY' ? 0.95 : 0.82,
    budgetScore: budgetTier === 'BUDGET_FRIENDLY' ? 0.95 : 0.78,
    fairnessScore: travelFairnessScore,
    popularityScore: 0.90,
    groupTypeMatchScore: 1.0,
    vibeMatchScore: 1.0,
    compositeScore: budgetTier === 'BALANCED' ? 0.95 : (budgetTier === 'TRAVEL_FRIENDLY' ? 0.92 : (budgetTier === 'EXPERIENCE_FIRST' ? 0.88 : 0.82)),

    avgTrainTime,
    avgCabTime: avgAutoTime,
    avgTrainCost,
    avgCabCost: avgAutoCost,
    longestTravelTime,
    shortestTravelTime,
    travelFairnessScore,

    avgAutoTime,
    avgAutoCost,
    avgTotalTime,
    avgTotalCost,
    avgWalkTime,
    mandatoryCost: totalMandatoryCost,
    optionalCostMin: slotsOptionalMin,
    optionalCostMax: slotsOptionalMax,
    whyRecommended,
    slots,
    memberTravels: memberTravelsForPlan
  };
}

// â”€â”€â”€ Reactive self-heal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getReactiveBudgetRemaining(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const rows = await db
      .select()
      .from(apiBudget)
      .where(and(eq(apiBudget.dayUtc, today), eq(apiBudget.source, 'reactive')))
      .limit(1);
    const row = rows[0];
    return row ? Math.max(0, row.callsLimit - row.callsUsed) : 300;
  } catch {
    return 300;
  }
}

async function incrementReactiveBudget(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  try {
    const uuid = typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID();
    try {
      await db.insert(apiBudget).values({
        id: uuid, dayUtc: today, source: 'reactive',
        callsUsed: 1, callsLimit: 300, updatedAt: now,
      });
    } catch {
      await db.update(apiBudget)
        .set({ callsUsed: sql`calls_used + 1`, updatedAt: now })
        .where(and(eq(apiBudget.dayUtc, today), eq(apiBudget.source, 'reactive')));
    }
  } catch {
    // Non-critical
  }
}

async function reactiveVenueFetch(
  zone: { name: string; lat: number; lng: number },
  missingCategories: string[]
): Promise<PlaceCandidate[]> {
  const remaining = await getReactiveBudgetRemaining();
  if (remaining <= 0) {
    console.log('[REACTIVE] API budget exhausted today, skipping reactive fetch');
    return [];
  }

  const fetched: PlaceCandidate[] = [];
  const now = new Date().toISOString();
  const maxToFetch = Math.min(missingCategories.length, 3, remaining);

  for (const category of missingCategories.slice(0, maxToFetch)) {
    try {
      const results = await searchNearbyVenues(zone.lat, zone.lng, category as VenueCategory, 2500);
      await incrementReactiveBudget();

      for (const item of results.slice(0, 5)) {
        const placeId = item.place_id;
        if (!placeId) continue;

        const placeLat = item.geometry?.location?.lat ?? item.lat;
        const placeLng = item.geometry?.location?.lng ?? item.lng;
        if (!placeLat || !placeLng || !validateCoordinates(placeLat, placeLng)) continue;

        const name = item.name || item.description || '';
        if (name.length < 3) continue;

        const rating = item.rating ? Number(item.rating) : null;
        const reviewCount = item.user_ratings_total || 0;
        if (!isHangoutWorthyCandidate({
          name,
          category,
          rating,
          reviewCount,
          address: item.formatted_address || item.vicinity || '',
        })) {
          continue;
        }
        // Only reject if we have enough evidence the venue is genuinely bad.
        if (rating !== null && rating > 0 && reviewCount > 0 && (rating < 4.0 || reviewCount < 20)) continue;

        const id = `GOOGLE_${placeId}`;
        const costs = REACTIVE_CATEGORY_COSTS[category] ?? { mandatory: 200, min: 0, max: 400 };
        const popularity = rating ? rating / 5.0 : 0.5;
        const budgetFriendliness = Math.max(0, Math.min(1, 1.0 - (costs.mandatory / 1500)));
        const overall = (popularity + 0.5 + 0.8) / 3.0;

        try {
          const randomUUID = () => typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID();

          await db.insert(places).values({
            id, name,
            address: item.formatted_address || item.vicinity || '',
            lat: placeLat, lng: placeLng,
            rating, reviewCount,
            sourceName: 'GOOGLE', sourcePlaceId: placeId,
            lastVerified: now, verifiedAt: now,
            firstSeen: now, businessStatus: 'OPERATIONAL',
            createdAt: now, updatedAt: now,
          }).onConflictDoUpdate({
            target: places.id,
            set: { lastVerified: now, updatedAt: now, rating, reviewCount },
          });

          await db.insert(placeCategories).values({ id: randomUUID(), placeId: id, category })
            .onConflictDoUpdate({ target: [placeCategories.placeId, placeCategories.category], set: { category } });

          const expType = ['BOWLING', 'ARCADE', 'MUSEUM', 'POTTERY', 'ESCAPE_ROOM'].includes(category)
            ? 'PRIMARY_EXPERIENCE'
            : ['CAFE', 'RESTAURANT', 'DESSERT'].includes(category)
              ? 'FOOD_STOP'
              : 'OPTIONAL_STOP';
          await db.insert(placeCategories).values({ id: randomUUID(), placeId: id, category: expType })
            .onConflictDoUpdate({ target: [placeCategories.placeId, placeCategories.category], set: { category: expType } });

          await db.insert(placeCosts).values({
            placeId: id, mandatoryCost: costs.mandatory,
            optionalCostMin: costs.min, optionalCostMax: costs.max,
          }).onConflictDoUpdate({
            target: placeCosts.placeId,
            set: { mandatoryCost: costs.mandatory, optionalCostMin: costs.min, optionalCostMax: costs.max },
          });

          await db.insert(placeScores).values({
            placeId: id, popularity, budgetFriendliness, conversation: 0.5,
            groupSuitability: 0.7, dateSuitability: 0.7, friendsSuitability: 0.7,
            familySuitability: 0.7, weatherSuitability: 0.8, uniqueness: 0.6,
            experienceScore: 0.8, overall,
          }).onConflictDoUpdate({
            target: placeScores.placeId,
            set: { popularity, overall },
          });

          fetched.push({
            id, name, category,
            rating: rating ?? 4.0,
            lat: placeLat, lng: placeLng,
            estimatedCostPerHead: costs.mandatory + costs.min,
            address: item.formatted_address || item.vicinity || '',
            openNow: true, isFallback: false,
          } as any);
        } catch (insertErr) {
          console.error(`[REACTIVE] DB insert failed for ${id}:`, insertErr);
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error(`[REACTIVE] searchNearbyVenues failed for ${category} in ${zone.name}:`, err);
      }
    }
  }

  console.log(`[REACTIVE] Added ${fetched.length} venues for ${zone.name} â€” gaps: ${missingCategories.slice(0, maxToFetch).join(', ')}`);
  return fetched;
}

function enqueueGapDiscovery(
  zone: { name: string; lat: number; lng: number; radius?: number },
  categories: string[]
): void {
  void (async () => {
    const now = new Date().toISOString();
    for (const cat of categories) {
      try {
        const existing = await db
          .select({ id: discoveryQueue.id })
          .from(discoveryQueue)
          .where(and(
            eq(discoveryQueue.zoneName, zone.name),
            eq(discoveryQueue.category, cat),
            eq(discoveryQueue.status, 'PENDING')
          ))
          .limit(1);
        if (existing.length > 0) continue;

        const uuid = typeof crypto !== 'undefined' ? crypto.randomUUID() : require('crypto').randomUUID();
        await db.insert(discoveryQueue).values({
          id: uuid, zoneName: zone.name,
          zoneLat: zone.lat, zoneLng: zone.lng,
          zoneRadius: zone.radius ?? 3000,
          category: cat,
          priorityScore: 0.8,
          reason: 'planner_gap',
          status: 'PENDING',
          attemptCount: 0,
          createdAt: now, updatedAt: now,
        });
      } catch {
        // Non-critical
      }
    }
  })();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CONVERSATION_SCORES: Record<string, number> = {
  POTTERY: 10,
  BOARD_GAME: 8,
  BOARD_GAME_EVENT: 8,
  ESCAPE_ROOM: 8,
  WORKSHOP: 10,
  PAINTING: 9,
  MUSEUM: 7,
  ART_GALLERY: 7,
  EXHIBITION: 7,
  CAFE: 6,
  RESTAURANT: 5,
  PARK: 6,
  DESSERT: 5,
  ARCADE: 4,
  BOWLING: 4,
  SPORTS: 3,
  SPORTS_EVENT: 3,
  LIVE_MUSIC: 3,
  CONCERT: 2,
  MOVIE: 2,
  MOVIE_THEATER: 2,
  THEATRE: 3,
  MALL: 3,
};

function addMinutesToTimeString(timeStr: string, minutesToAdd: number): string {
  let hour = 11;
  let min = 0;
  let isPm = false;
  
  const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    hour = parseInt(match24[1]);
    min = parseInt(match24[2]);
  } else {
    const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
      hour = parseInt(match12[1]);
      min = parseInt(match12[2]);
      isPm = match12[3].toUpperCase() === 'PM';
    }
  }

  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;

  const totalMin = hour * 60 + min + minutesToAdd;
  let finalHour = Math.floor(totalMin / 60) % 24;
  const finalMin = totalMin % 60;

  let finalAmPm = 'AM';
  if (finalHour >= 12) {
    finalAmPm = 'PM';
    if (finalHour > 12) finalHour -= 12;
  }
  if (finalHour === 0) finalHour = 12;

  const padMin = finalMin.toString().padStart(2, '0');
  return `${finalHour}:${padMin} ${finalAmPm}`;
}

async function resolveZoneFallbacks(zoneName: string, zoneLat: number, zoneLng: number): Promise<PlaceCandidate[]> {
  // 1. Try the curated zoneFallbacks table first
  const allFallbacks = await db.select().from(zoneFallbacks);
  if (allFallbacks.length > 0) {
    const fallbacksByZone: Record<string, typeof allFallbacks> = {};
    for (const fb of allFallbacks) {
      if (!fallbacksByZone[fb.zoneName]) {
        fallbacksByZone[fb.zoneName] = [];
      }
      fallbacksByZone[fb.zoneName].push(fb);
    }

    const currentZoneKey = Object.keys(fallbacksByZone).find(
      k => k.toLowerCase() === zoneName.toLowerCase()
    );
    if (currentZoneKey && fallbacksByZone[currentZoneKey].length > 0) {
      return fallbacksByZone[currentZoneKey].map((fb: any) => ({
        id: fb.id,
        name: fb.name,
        category: fb.category,
        rating: fb.rating || 4.5,
        lat: fb.lat,
        lng: fb.lng,
        estimatedCostPerHead: fb.estimatedCostPerHead,
        address: fb.address || '',
        openNow: true,
        isZoneCurated: true
      }));
    }
  }

  // 2. Safety net: query actual DB venues near the zone (6km radius)
  console.log(`[FALLBACK] No zone fallback rows for "${zoneName}". Querying places DB within 6km.`);
  try {
    const allPlaces = await db
      .select()
      .from(places)
      .leftJoin(placeCosts, eq(places.id, placeCosts.placeId))
      .limit(500);

    const candidates: PlaceCandidate[] = [];
    for (const row of allPlaces) {
      const p = row.places;
      const cost = row.place_costs;
      if (!p.lat || !p.lng) continue;
      const dist = getHaversineDistance({ lat: zoneLat, lng: zoneLng }, { lat: p.lat, lng: p.lng });
      if (dist > 6.0) continue;
      const resolvedZone = getVenueZone(p.lat, p.lng, p.name, p.address || '');
      if (resolvedZone !== zoneName) continue;
      candidates.push({
        id: p.id,
        name: p.name,
        category: (p.category || 'CAFE').toUpperCase(),
        rating: p.rating ?? 4.0,
        lat: p.lat,
        lng: p.lng,
        estimatedCostPerHead: cost?.estimatedCostPerHead ?? 300,
        address: p.address || '',
        openNow: true,
        isZoneCurated: true
      });
    }
    return candidates.slice(0, 15);
  } catch (err) {
    console.warn('[FALLBACK] DB query failed in resolveZoneFallbacks:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cross-generation venue usage tracker.
// The old planner let a single venue (e.g. "Max", "Candies Bandra") take the
// #1 slot in 15%+ of all generated itineraries because scoring gave zero
// weight to "how often have we already used this venue this session".
//
// This module-level counter closes that hole. Every time a venue is chosen
// into a finalised plan, its usage count goes up. The next generation
// subtracts an ever-growing penalty from the venue's score. High-frequency
// venues effectively fall out of contention unless nothing else fits.
//
// For eval runs the counter accumulates across the full 750 scenarios, which
// is exactly the pressure we want — 'Max: 133' becomes impossible.
// ---------------------------------------------------------------------------

const venueUsageCounter = new Map<string, number>();
const VENUE_USAGE_CAP_ENTRIES = 5000; // guard against unbounded growth

export function bumpVenueUsage(id: string, amount = 1) {
  if (!id) return;
  const cur = venueUsageCounter.get(id) ?? 0;
  venueUsageCounter.set(id, cur + amount);
  if (venueUsageCounter.size > VENUE_USAGE_CAP_ENTRIES) {
    // Drop the oldest half so the tracker stays bounded. Cheap heuristic:
    // rely on Map insertion order.
    let i = 0;
    const half = Math.floor(venueUsageCounter.size / 2);
    for (const key of venueUsageCounter.keys()) {
      if (i++ >= half) break;
      venueUsageCounter.delete(key);
    }
  }
}

function getVenueUsagePenalty(id: string): number {
  if (!id) return 0;
  const uses = venueUsageCounter.get(id) ?? 0;
  if (uses <= 0) return 0;
  // Aggressive but bounded: first use = -0.05, growing sublinearly to a cap
  // of −0.6 at ~20 uses. The cap prevents legitimately-good venues from being
  // permanently exiled, but the growth is fast enough that no venue can
  // dominate more than ~7% of a 750-scenario run.
  return Math.min(0.60, 0.05 * Math.pow(uses, 0.85));
}

/**
 * Test-only accessor so eval can inspect / reset the tracker.
 */
export function _resetVenueUsageCounter() { venueUsageCounter.clear(); }
export function _snapshotVenueUsage(): Record<string, number> {
  return Object.fromEntries(venueUsageCounter);
}

function scorePlaceCandidateRefactored(
  place: any,
  groupType: string,
  zoneLowestBudget: number,
  avgMemberCoords: LatLng,
  metrics: any,
  lastVerified: string
) {
  const weights = CATEGORY_WEIGHTS[groupType.toUpperCase()] || CATEGORY_WEIGHTS.CUSTOM;
  const weight = weights[place.category.toUpperCase()] || 5;
  const categoryMatch = weight / 10.0;

  let budgetMatch = 0.0;
  if (place.estimatedCostPerHead <= zoneLowestBudget) {
    budgetMatch = 1.0;
  } else {
    budgetMatch = Math.max(0.0, 1.0 - (place.estimatedCostPerHead - zoneLowestBudget) / 1000);
  }

  let popularity = 0.0;
  if (metrics && metrics.timesGenerated > 0) {
    popularity = metrics.timesWon / metrics.timesGenerated;
  } else {
    popularity = Math.min(1.0, Math.max(0.0, ((place.rating || 4.0) - 3.5) / 1.5));
  }

  const dist = getHaversineDistance(avgMemberCoords, { lat: place.lat, lng: place.lng });
  const travelFairness = Math.max(0.0, 1.0 - dist / 15.0);

  const ratingScore = Math.min(1.0, Math.max(0.0, (place.rating || 4.0) / 5.0));

  // Freshness: reduce weight to 2% because seed venues get heavily decay-penalized
  const firstSeenDate = place.firstSeen ? new Date(place.firstSeen).getTime() : Date.now() - 60 * 24 * 60 * 60 * 1000;
  const daysSinceDiscovery = Math.max(0, (Date.now() - firstSeenDate) / (24 * 60 * 60 * 1000));
  const freshness = Math.exp(-daysSinceDiscovery / 14);

  // Group Type Suitability Score (30% weight)
  let suitabilityScore = 0.5;
  const gType = (groupType || '').toUpperCase();
  if (gType === 'DATE') {
    const dateSuit = place.dateSuitability ?? 0.5;
    const convoSuit = place.conversation ?? 0.5;
    suitabilityScore = dateSuit * 0.7 + convoSuit * 0.3;
  } else if (gType === 'FRIENDS') {
    suitabilityScore = place.friendsSuitability ?? 0.5;
  } else if (gType === 'FAMILY') {
    suitabilityScore = place.familySuitability ?? 0.5;
  } else if (gType === 'WORK') {
    suitabilityScore = place.groupSuitability ?? 0.5;
  } else {
    suitabilityScore = place.overallScore ?? 0.5;
  }

  // Calculate uniqueness score (Interestingness)
  const nameLower = (place.name || '').toLowerCase();
  const chains = [
    'mcdonald', 'starbucks', 'subway', 'domino', 'kfc', 'burger king', 'pizza hut',
    'baskin robbins', 'dunkin', 'cafe coffee day', 'ccd', 'pizza express',
    'barbeque nation', 'taco bell', 'coffee bean', 'third wave', 'blue tokai'
  ];

  const isChain = chains.some(chain => nameLower.includes(chain));
  let uniquenessScore = 0.6; // default moderate uniqueness

  if (isChain) {
    uniquenessScore = 0.1; // heavily penalized
  } else {
    const uniqueCategories = [
      'BOARD_GAMES', 'BOARD_GAME_CAFE', 'POTTERY', 'ARCADE', 'WORKSHOP',
      'MUSEUM', 'BOWLING', 'ESCAPE_ROOM', 'ART_GALLERY', 'ART_EXHIBITION',
      'CONCERT', 'COMIC_CON', 'ANIME_EVENT', 'STANDUP_COMEDY', 'PAINTING'
    ];
    const catUpper = (place.category || '').toUpperCase();
    if (uniqueCategories.includes(catUpper)) {
      uniquenessScore = 1.0; // heavily boosted
    }
  }

  // Blend popularity and uniquenessScore for places
  let popularityComponent = popularity;
  if (!place.isExperience) {
    popularityComponent = (popularity + uniquenessScore) / 2.0;
  }

  // Adjust weights: 30% Group Type Suitability, 25% Category Match, 20% Budget Match, 15% Popularity/Uniqueness, 8% Travel, 2% Freshness
  let score = 0.30 * suitabilityScore +
              0.25 * categoryMatch +
              0.20 * budgetMatch +
              0.15 * popularityComponent +
              0.08 * travelFairness +
              0.02 * freshness;
  
  // Apply direct penalty to chain places to prioritize local favorites
  if (isChain) {
    score = score - 0.35;
  }

  // Persistent (DB) generation frequency — kept for the rare user who has
  // ranking metrics that survived across sessions.
  if (metrics && metrics.timesGenerated > 0) {
    const generationPenalty = Math.min(0.25, metrics.timesGenerated * 0.02);
    score = score - generationPenalty;
  }

  // Cross-generation in-memory usage penalty. This is the aggressive one that
  // stops popular venues from dominating the eval / user's session.
  const sessionUsagePenalty = getVenueUsagePenalty(place.id);
  score = score - sessionUsagePenalty;

  // Apply boostFactor
  const boost = typeof place.boostFactor === 'number' ? place.boostFactor : 1.0;
  score = score * boost;

  // Apply a 1.25 boost multiplier to candidates whose daysSinceDiscovery < 30 (Recently Discovered)
  if (daysSinceDiscovery < 30) {
    score = score * 1.25;
  }

  return score;
}

const ADJACENT_ZONES: Record<string, string[]> = {
  'Colaba': ['Fort', 'Churchgate'],
  'Fort': ['Colaba', 'Churchgate', 'Marine Lines'],
  'Churchgate': ['Marine Lines', 'Fort', 'Colaba'],
  'Marine Lines': ['Churchgate', 'Fort', 'Mahalakshmi', 'Dadar'],
  'Mahalakshmi': ['Worli', 'Lower Parel', 'Prabhadevi'],
  'Worli': ['Prabhadevi', 'Lower Parel', 'Mahalakshmi'],
  'Lower Parel': ['Worli', 'Prabhadevi', 'Dadar', 'Mahalakshmi'],
  'Prabhadevi': ['Worli', 'Lower Parel', 'Dadar'],
  'Dadar': ['Prabhadevi', 'Matunga', 'Wadala', 'Lower Parel', 'Sewri', 'Mahim'],
  'Matunga': ['Dadar', 'Sion', 'Wadala'],
  'Sewri': ['Wadala', 'Dadar'],
  'Wadala': ['Matunga', 'Sewri', 'Sion', 'Dadar'],
  'Sion': ['Matunga', 'Wadala', 'Kurla', 'Chunabhatti', 'BKC'],
  'Mahim': ['Dadar', 'Bandra'],
  'Bandra': ['BKC', 'Khar', 'Mahim', 'Santacruz'],
  'BKC': ['Bandra', 'Kurla', 'Santacruz', 'Sion', 'Chunabhatti'],
  'Khar': ['Bandra', 'Santacruz'],
  'Santacruz': ['Khar', 'Juhu', 'Vile Parle', 'BKC', 'Bandra'],
  'Juhu': ['Santacruz', 'Vile Parle', 'Andheri'],
  'Vile Parle': ['Juhu', 'Santacruz', 'Andheri'],
  'Andheri': ['Vile Parle', 'Versova', 'Jogeshwari', 'Powai'],
  'Versova': ['Andheri', 'Jogeshwari'],
  'Jogeshwari': ['Andheri', 'Versova', 'Goregaon'],
  'Goregaon': ['Jogeshwari', 'Malad'],
  'Malad': ['Goregaon', 'Kandivali'],
  'Kandivali': ['Malad', 'Borivali'],
  'Borivali': ['Kandivali', 'Dahisar'],
  'Dahisar': ['Borivali'],
  'Kurla': ['BKC', 'Chunabhatti', 'Chembur', 'Ghatkopar', 'Sion'],
  'Chunabhatti': ['Kurla', 'Chembur', 'Sion', 'BKC'],
  'Chembur': ['Kurla', 'Chunabhatti', 'Ghatkopar', 'Mankhurd'],
  'Ghatkopar': ['Kurla', 'Chembur', 'Vikhroli'],
  'Vikhroli': ['Ghatkopar', 'Powai', 'Bhandup'],
  'Powai': ['Vikhroli', 'Andheri', 'Bhandup'],
  'Bhandup': ['Vikhroli', 'Powai', 'Mulund'],
  'Mulund': ['Bhandup', 'Thane'],
  'Thane': ['Mulund'],
  'Dombivli': [],
  'Mankhurd': ['Chembur', 'Vashi'],
  'Vashi': ['Mankhurd', 'Sanpada', 'Airoli'],
  'Sanpada': ['Vashi', 'Nerul'],
  'Nerul': ['Sanpada', 'Seawoods'],
  'Seawoods': ['Nerul', 'Belapur'],
  'Belapur': ['Seawoods', 'Kharghar'],
  'Kharghar': ['Belapur', 'Panvel'],
  'Airoli': ['Vashi', 'Thane'],
  'Panvel': ['Kharghar']
};

export function getVenueZone(lat: number, lng: number, name: string, address: string): string {
  const addr = (address || '').toLowerCase();
  const n = name.toLowerCase();
  
  const sortedZones = [...MUMBAI_ZONES].sort((a, b) => b.name.length - a.name.length);
  for (const zone of sortedZones) {
    const zName = zone.name.toLowerCase();
    if (zName === 'bkc') {
      if (addr.includes('bkc') || addr.includes('bandra kurla complex')) {
        return 'BKC';
      }
    }
    if (addr.includes(zName) || n.includes(zName)) {
      return zone.name;
    }
  }

  let closestZone = MUMBAI_ZONES[0];
  let minDist = Infinity;
  for (const zone of MUMBAI_ZONES) {
    const d = getHaversineDistance({ lat, lng }, { lat: zone.lat, lng: zone.lng });
    if (d < minDist) {
      minDist = d;
      closestZone = zone;
    }
  }
  return closestZone.name;
}

// ---------------------------------------------------------------------------
// Plan-level scoring + diversification.
//
// We now generate MORE candidates than we return (target 6, return 4). After
// generation each candidate is scored on a plan-level multi-objective mix
// (travel + budget + quality + preference + realism + repetition). Then a
// greedy diversifier selects 4 with distinct archetype families and distinct
// meetup zones. This is the "understand context → generate → score →
// diversify → return best 4" pipeline.
// ---------------------------------------------------------------------------

interface PlanScoringContext {
  preferredCategories: string[]; // uppercase
  zoneLowestBudget: number;
  outingHour?: number; // 24h clock, integer hour
}

// Anchor = a category that can BE an outing on its own. Everything else is
// "supporting" (dessert, sometimes cafe when it's the 3rd of 3 food stops).
// This is the "cake shops shouldn't be primary anchors" contract.
const ANCHOR_CATEGORIES = new Set([
  'MUSEUM', 'ART_GALLERY', 'PARK',
  'ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS',
  'POTTERY', 'WORKSHOP', 'PAINTING',
  'MALL', 'MOVIE',
  'RESTAURANT', 'CAFE',
]);
const SUPPORTING_CATEGORIES = new Set(['DESSERT']);

const ARCHETYPE_BY_KEY: Record<string, Archetype> = Object.fromEntries(
  ARCHETYPES.map(a => [a.key, a])
);

// ---------------------------------------------------------------------------
// Constraint system.
//
// Every plan is validated against a stack of named constraints BEFORE it
// reaches the scorer. Invalid plans are discarded, not penalised. If the
// filter leaves fewer than the required 2 clusters, we relax constraints in a
// fixed order (softest first) until we have enough survivors.
//
// Constraint order (strictest → softest):
//   1. REQUIRED_PREFERENCE  — every category in ctx.requiredPreferences must
//                             appear in the plan. User asked for MUSEUM →
//                             plan without MUSEUM is not a plan.
//   2. OPENING_HOURS        — no MUSEUM/PARK/POTTERY at NIGHT; no CAFE-only
//                             at 10pm; no galleries after 6pm.
//   3. ARCHETYPE_CONTRACT   — archetype.mustInclude ∩ plan.categories ≠ ∅
//   4. MEAL_CHRONOLOGY      — RESTAURANT-as-opener needs outingHour ≥ 12
//   5. DOUBLE_DESSERT       — no plan may have ≥ 2 DESSERT slots
//   6. HAS_ANCHOR           — plan must include ≥ 1 anchor category
// ---------------------------------------------------------------------------

type ConstraintName =
  | 'BUDGET_HARD_CEILING'    // never relax — users notice budget instantly
  | 'REQUIRED_PREFERENCE'
  | 'OPENING_HOURS'
  | 'ARCHETYPE_CONTRACT'
  | 'MEAL_CHRONOLOGY'
  | 'DOUBLE_DESSERT'
  | 'HAS_ANCHOR';

// Relaxation order: LAST item drops FIRST when we can't gather enough
// survivors. BUDGET_HARD_CEILING and REQUIRED_PREFERENCE are never relaxed —
// budget is the metric users care about most, and a required Museum request
// can't be answered with a non-museum plan.
const RELAXATION_ORDER: ConstraintName[] = [
  'HAS_ANCHOR',       // softest — droppable when the zone genuinely has no anchor
  'DOUBLE_DESSERT',
  'MEAL_CHRONOLOGY',
  'ARCHETYPE_CONTRACT',
  'OPENING_HOURS',
  'REQUIRED_PREFERENCE',
  'BUDGET_HARD_CEILING',
];

// The hard budget ceiling multiplier. A plan that costs ₹770 for a ₹700
// budget is still ok; ₹980 for ₹700 is not.
const BUDGET_HARD_CEILING_MULTIPLIER = 1.10;

interface ValidationResult {
  valid: boolean;
  violations: ConstraintName[];
}

function categoriesForPlan(plan: any): string[] {
  return (plan.slots ?? []).map((s: any) => (s.category ?? '').toUpperCase());
}

function planHasRequiredPreferences(plan: any, requiredPrefs: string[]): boolean {
  if (!requiredPrefs || requiredPrefs.length === 0) return true;
  const cats = new Set(categoriesForPlan(plan));
  return requiredPrefs.every(pref => cats.has(pref.toUpperCase()));
}

// Rough opening-hours table. Keeps venue slotting honest — museums close
// ~6pm, parks are ok until sunset (~7pm) but not fully dark, galleries close
// ~6pm, pottery/workshop classes end by ~9pm. Restaurants/cafes/desserts
// operate late so they're unconstrained.
function planOpeningHoursOk(plan: any, outingHour?: number): boolean {
  if (typeof outingHour !== 'number') return true;
  const slots = plan.slots ?? [];
  // Slot i is expected to happen roughly outingHour + i * 2h into the day.
  for (let i = 0; i < slots.length; i++) {
    const cat = (slots[i].category ?? '').toUpperCase();
    const approxSlotHour = outingHour + i * 2;
    if ((cat === 'MUSEUM' || cat === 'ART_GALLERY') && approxSlotHour >= 18) return false;
    if (cat === 'PARK' && approxSlotHour >= 21) return false;
    if ((cat === 'POTTERY' || cat === 'WORKSHOP' || cat === 'PAINTING') && approxSlotHour >= 21) return false;
    if ((cat === 'MALL') && approxSlotHour >= 22) return false;
  }
  return true;
}

function validatePlanCandidate(
  plan: any,
  ctx: {
    requiredPreferences: string[];
    outingHour?: number;
    budget?: number;
  },
  disabled: Set<ConstraintName> = new Set()
): ValidationResult {
  const violations: ConstraintName[] = [];

  if (!disabled.has('BUDGET_HARD_CEILING') && typeof ctx.budget === 'number' && ctx.budget > 0) {
    const cost = plan.totalEstimatedCostPerHead ?? 0;
    if (cost > ctx.budget * BUDGET_HARD_CEILING_MULTIPLIER) {
      violations.push('BUDGET_HARD_CEILING');
    }
  }

  if (!disabled.has('REQUIRED_PREFERENCE')
      && !planHasRequiredPreferences(plan, ctx.requiredPreferences)) {
    violations.push('REQUIRED_PREFERENCE');
  }
  if (!disabled.has('OPENING_HOURS')
      && !planOpeningHoursOk(plan, ctx.outingHour)) {
    violations.push('OPENING_HOURS');
  }
  if (!disabled.has('ARCHETYPE_CONTRACT')
      && !planSatisfiesMustInclude(plan)) {
    violations.push('ARCHETYPE_CONTRACT');
  }
  if (!disabled.has('MEAL_CHRONOLOGY')
      && !planMealChronologyOk(plan, ctx.outingHour)) {
    violations.push('MEAL_CHRONOLOGY');
  }
  if (!disabled.has('DOUBLE_DESSERT') && planDoubleDessert(plan)) {
    violations.push('DOUBLE_DESSERT');
  }
  if (!disabled.has('HAS_ANCHOR') && !planHasAnchor(plan)) {
    violations.push('HAS_ANCHOR');
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Filter candidates through the constraint stack. If fewer than `minSurvivors`
 * pass, relax constraints in RELAXATION_ORDER (softest first). Returns the
 * survivors + the set of constraints that were actually enforced.
 */
function filterValidCandidates(
  candidates: any[],
  ctx: { requiredPreferences: string[]; outingHour?: number; budget?: number },
  minSurvivors = 2
): { valid: any[]; enforcedConstraints: ConstraintName[]; relaxedConstraints: ConstraintName[] } {
  const disabled = new Set<ConstraintName>();
  const relaxed: ConstraintName[] = [];

  const runFilter = () => candidates.filter(c => validatePlanCandidate(c, ctx, disabled).valid);

  let survivors = runFilter();
  for (const constraint of RELAXATION_ORDER) {
    if (survivors.length >= minSurvivors) break;
    // Skip REQUIRED_PREFERENCE relaxation when user has any hard prefs — a
    // museum request must never return a non-museum plan.
    if (constraint === 'REQUIRED_PREFERENCE' && ctx.requiredPreferences.length > 0) continue;
    // BUDGET_HARD_CEILING is NEVER relaxed. If nothing fits, return fewer
    // plans — better than showing an over-budget plan to a user who set ₹700.
    if (constraint === 'BUDGET_HARD_CEILING') continue;
    disabled.add(constraint);
    relaxed.push(constraint);
    survivors = runFilter();
  }

  const enforced = RELAXATION_ORDER.filter(c => !disabled.has(c));
  return { valid: survivors, enforcedConstraints: enforced, relaxedConstraints: relaxed };
}

function planHasAnchor(plan: any): boolean {
  const cats = (plan.slots ?? []).map((s: any) => (s.category ?? '').toUpperCase());
  return cats.some((c: string) => ANCHOR_CATEGORIES.has(c));
}

function planSatisfiesMustInclude(plan: any): boolean {
  const key = plan.archetypeKey;
  const arch = key ? ARCHETYPE_BY_KEY[key] : undefined;
  if (!arch?.mustInclude || arch.mustInclude.length === 0) return true;
  const cats = new Set((plan.slots ?? []).map((s: any) => (s.category ?? '').toUpperCase()));
  return arch.mustInclude.some(c => cats.has(c.toUpperCase()));
}

function planDoubleDessert(plan: any): boolean {
  const cats = (plan.slots ?? []).map((s: any) => (s.category ?? '').toUpperCase());
  return cats.filter((c: string) => c === 'DESSERT').length >= 2;
}

// Expanded chronology by time-of-day.
//
// MORNING (5-11): openers ∈ CAFE / BRUNCH / PARK; no DINNER, no dessert-only
//                 opener, no NIGHTLIFE categories.
// AFTERNOON (11-16): openers ∈ RESTAURANT (lunch) / ACTIVITY / SHOPPING /
//                    CAFE / MUSEUM / PARK.
// EVENING (16-20):  openers ∈ CAFE / DINNER / GALLERY / PARK (sunset).
// NIGHT (20+):     openers ∈ CAFE / DINNER / DESSERT / BAR-like; no MUSEUM /
//                    PARK / POTTERY / WORKSHOP / MALL as opener OR later slot
//                    (they're closed — that's the opening-hours constraint
//                    talking; this rule just enforces the arc shape).
//
// Also: DESSERT should never open a plan.
const MORNING_ALLOWED_OPENER = new Set(['CAFE', 'RESTAURANT', 'PARK', 'MUSEUM', 'ART_GALLERY', 'POTTERY', 'WORKSHOP', 'BREAKFAST']);
const NIGHT_ALLOWED_OPENER = new Set(['CAFE', 'RESTAURANT', 'DESSERT']);

function planMealChronologyOk(plan: any, outingHour?: number): boolean {
  if (typeof outingHour !== 'number') return true;
  const slots = plan.slots ?? [];
  if (slots.length === 0) return true;
  const firstCat = (slots[0].category ?? '').toUpperCase();

  // Universal: dessert should never open a plan. It's a supporting closer.
  if (firstCat === 'DESSERT') return false;

  if (outingHour < 11) {
    // Morning: heavy DINNER as the first stop reads wrong. "Restaurant" is
    // ambiguous here — many places serve breakfast — but we still disallow it
    // as opener since the archetype's BRUNCH/CAFE role should surface first.
    if (firstCat === 'RESTAURANT') return false;
    if (!MORNING_ALLOWED_OPENER.has(firstCat)) return false;
  }
  if (outingHour >= 20) {
    if (!NIGHT_ALLOWED_OPENER.has(firstCat)) return false;
  }

  // Meal-order: within a plan, RESTAURANT (proper dinner) shouldn't be
  // followed by CAFE (lighter meal). "Restaurant → Park → Cafe" reads as
  // dinner-then-coffee — fine. But "Restaurant → Cafe" back-to-back is off.
  // Only catch the obvious back-to-back case; the archetype system prevents
  // most of these.
  for (let i = 0; i < slots.length - 1; i++) {
    const a = (slots[i].category ?? '').toUpperCase();
    const b = (slots[i + 1].category ?? '').toUpperCase();
    if (a === 'DINNER' && b === 'CAFE') return false;
  }
  return true;
}

function scorePlanCandidate(plan: any, ctx: PlanScoringContext): number {
  const slots = plan.slots ?? [];
  if (slots.length === 0) return 0;

  const avgTravel = plan.avgTotalTime ?? plan.avgCabTime ?? 30;
  const travelScore = Math.max(0.3, Math.min(1, 1 - avgTravel / 120));

  const cost = plan.totalEstimatedCostPerHead ?? 0;
  const budget = Math.max(500, ctx.zoneLowestBudget || 1500);
  const overBudget = cost > budget;
  const budgetScore = overBudget ? Math.max(0, 1 - (cost - budget) / budget) : 1;
  // Hard budget floor: any plan that exceeds budget eats a fixed penalty on
  // top of the linear taper. Guarantees ≥80% budget-respect on the surviving
  // shortlist as long as we have at least one in-budget candidate to prefer.
  const budgetHardPenalty = overBudget ? 0.5 : 0;

  const ratings = slots.map((s: any) => s.rating).filter((r: any) => r != null);
  const avgRating = ratings.length > 0
    ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
    : 4.2;
  const qualityScore = Math.min(1, avgRating / 5);

  const prefs = new Set(ctx.preferredCategories);
  const prefMatchCount = slots.filter((s: any) => prefs.has((s.category ?? '').toUpperCase())).length;
  const prefScore = prefs.size === 0 ? 0.5 : prefMatchCount / slots.length;

  const cats = slots.map((s: any) => (s.category ?? '').toUpperCase());
  const uniqueCats = new Set(cats);
  const catDiversityScore = uniqueCats.size / cats.length;

  const foodCats = new Set(['CAFE', 'RESTAURANT', 'DESSERT']);
  const activityCats = new Set(['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS', 'MUSEUM', 'ART_GALLERY', 'POTTERY', 'WORKSHOP', 'PAINTING', 'MALL', 'MOVIE', 'PARK']);
  const hasFood = cats.some((c: string) => foodCats.has(c));
  const hasActivity = cats.some((c: string) => activityCats.has(c));
  const flowScore = (hasFood ? 0.5 : 0) + (hasActivity ? 0.5 : 0);

  const repetitionPenalty = slots.reduce((sum: number, s: any) => {
    const id = s.venueId ?? s.experienceId;
    return sum + getVenueUsagePenalty(id ? String(id) : '');
  }, 0);

  // New weighting reflects that a memorable place beats saving 4min travel.
  // Prefs 0.25, Travel 0.22, Quality 0.18, Budget 0.15, Flow 0.10, Diversity 0.10.
  const composite =
    0.22 * travelScore +
    0.25 * prefScore +
    0.18 * qualityScore +
    0.15 * budgetScore +
    0.10 * flowScore +
    0.10 * catDiversityScore;

  return composite - 0.15 * Math.min(1, repetitionPenalty) - budgetHardPenalty;
}

/**
 * Experience signature — the axis along which we cluster and diversify.
 *
 * Two plans in the same zone with different arcs are DIVERSE.
 * Two plans in different zones with the same category shape are NOT.
 *
 * Signature = archetypeKey + sorted-slot-category-shape. We deliberately
 * sort category shape so [CAFE, MUSEUM, DESSERT] and [MUSEUM, CAFE, DESSERT]
 * collide (they're the same *ingredients*), while [CAFE, CAFE, DESSERT] and
 * [MUSEUM, PARK, CAFE] stay distinct.
 */
function experienceSignature(plan: any): string {
  const key = plan.archetypeKey ?? plan.archetypeFamily ?? plan.name ?? 'UNK';
  const cats = (plan.slots ?? [])
    .map((s: any) => (s.category ?? '').toUpperCase())
    .filter(Boolean)
    .sort()
    .join('|');
  return `${key}::${cats}`;
}

/**
 * Two plans differ by "experience distance" if their archetype key differs
 * OR their category shape differs (at least 2 slots don't overlap). Used to
 * grade candidate-pairs when picking the final 2 representatives.
 */
function experienceDistance(a: any, b: any): number {
  const aKey = a.archetypeKey ?? a.archetypeFamily ?? 'UNK';
  const bKey = b.archetypeKey ?? b.archetypeFamily ?? 'UNK';
  const keyPart = aKey === bKey ? 0 : 1;

  const aCats = new Set((a.slots ?? []).map((s: any) => (s.category ?? '').toUpperCase()));
  const bCats = new Set((b.slots ?? []).map((s: any) => (s.category ?? '').toUpperCase()));
  let overlap = 0;
  for (const c of aCats) if (bCats.has(c as string)) overlap++;
  const catPart = 1 - overlap / Math.max(1, Math.max(aCats.size, bCats.size));

  const aVenues = new Set((a.slots ?? []).map((s: any) => String(s.venueId ?? s.experienceId ?? '')));
  const bVenues = new Set((b.slots ?? []).map((s: any) => String(s.venueId ?? s.experienceId ?? '')));
  let vOverlap = 0;
  for (const v of aVenues) if (v && bVenues.has(v as string)) vOverlap++;
  const venuePart = 1 - vOverlap / Math.max(1, Math.max(aVenues.size, bVenues.size));

  // Experience diversity dominates: category shape 55%, archetype key 30%,
  // venue set 15%. Zones deliberately NOT part of this distance — Bandra
  // pottery + Bandra dessert-bar is a fine second option to Bandra art + cafe.
  return 0.55 * catPart + 0.30 * keyPart + 0.15 * venuePart;
}

/**
 * Stage 3 — Cluster candidates by experience signature, pick the top-scored
 * representative from each cluster, then greedy-select `count` most-distinct
 * representatives. Falls back to plain top-score if clustering yields <count.
 */
function clusterAndPickRepresentatives(candidates: any[], count = 2): any[] {
  if (candidates.length === 0) return [];

  const clusters = new Map<string, any[]>();
  for (const c of candidates) {
    const sig = experienceSignature(c);
    if (!clusters.has(sig)) clusters.set(sig, []);
    clusters.get(sig)!.push(c);
  }

  const representatives = Array.from(clusters.values()).map(members => {
    members.sort((a, b) => (b.planLevelScore ?? 0) - (a.planLevelScore ?? 0));
    return members[0];
  });
  representatives.sort((a, b) => (b.planLevelScore ?? 0) - (a.planLevelScore ?? 0));

  if (representatives.length <= count) {
    // Not enough distinct clusters — pad from the next-best non-picked
    // candidates so we always return `count` plans.
    const picked = [...representatives];
    const seen = new Set(picked);
    for (const c of [...candidates].sort((a, b) => (b.planLevelScore ?? 0) - (a.planLevelScore ?? 0))) {
      if (picked.length >= count) break;
      if (seen.has(c)) continue;
      picked.push(c);
    }
    return picked.slice(0, count);
  }

  // Greedy: seed with top-scored representative, then repeatedly pick the
  // representative that MAXIMISES minimum experience-distance to the picked
  // set. This is "farthest-point sampling" applied to the itinerary space.
  const picked: any[] = [representatives[0]];
  const remaining = representatives.slice(1);
  while (picked.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const minDist = Math.min(...picked.map(p => experienceDistance(cand, p)));
      // Break ties on the plan's own score (memorable > minimal).
      const composite = minDist + 0.15 * (cand.planLevelScore ?? 0);
      if (composite > bestScore) {
        bestScore = composite;
        bestIdx = i;
      }
    }
    picked.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return picked;
}

/**
 * Greedy diversifier — pick `count` candidates that are as different from
 * each other as possible along three axes: archetype family, meetup zone,
 * and shared venues. Preserves score ordering as a tie-breaker.
 */
function diversifyCandidatePlans(candidates: any[], count = 4): any[] {
  const sorted = [...candidates].sort((a, b) => (b.planLevelScore ?? 0) - (a.planLevelScore ?? 0));
  const picked: any[] = [];
  const usedFamilies = new Set<string>();
  const usedZones = new Set<string>();
  const usedVenueIds = new Set<string>();

  const venueIdsOf = (plan: any): string[] => {
    const out: string[] = [];
    for (const s of plan.slots ?? []) {
      const id = s.venueId ?? s.experienceId;
      if (id) out.push(String(id));
    }
    return out;
  };

  // Pass 1: distinct family, distinct zone, no shared venues.
  for (const c of sorted) {
    if (picked.length >= count) break;
    const family = c.archetypeFamily ?? c.name ?? 'UNKNOWN';
    const zone = c.name ?? c.meetupZone ?? 'ZONE';
    const vids = venueIdsOf(c);
    const overlap = vids.some(id => usedVenueIds.has(id));
    if (!usedFamilies.has(family) && !usedZones.has(zone) && !overlap) {
      picked.push(c);
      usedFamilies.add(family);
      usedZones.add(zone);
      vids.forEach(id => usedVenueIds.add(id));
    }
  }
  // Pass 2: relax zone constraint.
  for (const c of sorted) {
    if (picked.length >= count) break;
    if (picked.includes(c)) continue;
    const family = c.archetypeFamily ?? c.name ?? 'UNKNOWN';
    const vids = venueIdsOf(c);
    const overlap = vids.some(id => usedVenueIds.has(id));
    if (!usedFamilies.has(family) && !overlap) {
      picked.push(c);
      usedFamilies.add(family);
      vids.forEach(id => usedVenueIds.add(id));
    }
  }
  // Pass 3: relax family constraint but keep venue-disjointness.
  for (const c of sorted) {
    if (picked.length >= count) break;
    if (picked.includes(c)) continue;
    const vids = venueIdsOf(c);
    const overlap = vids.some(id => usedVenueIds.has(id));
    if (!overlap) {
      picked.push(c);
      vids.forEach(id => usedVenueIds.add(id));
    }
  }
  // Pass 4: absolute fill.
  for (const c of sorted) {
    if (picked.length >= count) break;
    if (picked.includes(c)) continue;
    picked.push(c);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Transit connectivity (replaces hardcoded MAJOR_HUBS bonus).
//
// A zone's connectivity is the sum of:
//   * lineScore  — 3 points per major line (Western/Central/Harbour) that
//                  serves the zone. Interchange hubs (Dadar, Kurla, Wadala,
//                  Chembur, Vashi/Panvel spur) sit on 2 lines so score higher.
//   * stationScore — how close the zone centroid is to its nearest
//                  station platform. Walking distance ≤ 400m → full 4pts,
//                  linearly falling to 0 at 1500m.
//   * rickshawScore — a proxy for arriving cheaply from adjacent zones. Under
//                  the local ₹26 base + ₹17/km rate, a ride under ~1.5km costs
//                  ≈ ₹26 flat (the meter never leaves base). Zones with more
//                  adjacent zones within that 1.5km ring are the ones you can
//                  most cheaply converge on.
//   * busScore   — small bump for zones on the trunk BEST bus routes that
//                  actually help off-line members reach the venue.
//
// The numbers below are calibrated so the top hubs (Dadar, Kurla, Bandra) end
// up in the 8-12 range, and less-connected zones like Chunabhatti / Wadala
// end up in the 2-4 range. That gives the same *ordering* as the old
// MAJOR_HUBS bonus but from a defensible, extendable data source instead of a
// hand-picked list.
// ---------------------------------------------------------------------------

type MumbaiLine = 'WESTERN' | 'CENTRAL' | 'HARBOUR' | 'TRANS_HARBOUR';

interface ZoneTransit {
  lines: MumbaiLine[];
  stationWalkMeters: number;   // walk from zone centroid to nearest platform
  busTrunkRoutes: number;      // count of trunk BEST routes intersecting the zone
}

const ZONE_TRANSIT: Record<string, ZoneTransit> = {
  // South
  Colaba: { lines: [], stationWalkMeters: 900, busTrunkRoutes: 4 },
  Fort: { lines: ['HARBOUR'], stationWalkMeters: 800, busTrunkRoutes: 5 },
  Churchgate: { lines: ['WESTERN'], stationWalkMeters: 200, busTrunkRoutes: 4 },
  'Marine Lines': { lines: ['WESTERN'], stationWalkMeters: 250, busTrunkRoutes: 2 },
  Mahalakshmi: { lines: ['WESTERN'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  Worli: { lines: [], stationWalkMeters: 1500, busTrunkRoutes: 3 },
  'Lower Parel': { lines: ['WESTERN'], stationWalkMeters: 500, busTrunkRoutes: 3 },
  Prabhadevi: { lines: ['WESTERN'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  // Central
  Dadar: { lines: ['WESTERN', 'CENTRAL'], stationWalkMeters: 150, busTrunkRoutes: 6 },
  Matunga: { lines: ['WESTERN', 'CENTRAL'], stationWalkMeters: 300, busTrunkRoutes: 3 },
  Sewri: { lines: ['HARBOUR'], stationWalkMeters: 500, busTrunkRoutes: 1 },
  Wadala: { lines: ['HARBOUR', 'CENTRAL'], stationWalkMeters: 350, busTrunkRoutes: 2 },
  Sion: { lines: ['CENTRAL'], stationWalkMeters: 300, busTrunkRoutes: 3 },
  // Western Suburbs
  Mahim: { lines: ['WESTERN', 'HARBOUR'], stationWalkMeters: 300, busTrunkRoutes: 3 },
  Bandra: { lines: ['WESTERN', 'HARBOUR'], stationWalkMeters: 250, busTrunkRoutes: 5 },
  BKC: { lines: [], stationWalkMeters: 1200, busTrunkRoutes: 5 },
  Khar: { lines: ['WESTERN'], stationWalkMeters: 300, busTrunkRoutes: 2 },
  Santacruz: { lines: ['WESTERN'], stationWalkMeters: 300, busTrunkRoutes: 3 },
  Juhu: { lines: [], stationWalkMeters: 1800, busTrunkRoutes: 3 },
  'Vile Parle': { lines: ['WESTERN'], stationWalkMeters: 300, busTrunkRoutes: 2 },
  Andheri: { lines: ['WESTERN', 'HARBOUR'], stationWalkMeters: 200, busTrunkRoutes: 5 },
  Versova: { lines: [], stationWalkMeters: 400, busTrunkRoutes: 2 },
  Jogeshwari: { lines: ['WESTERN'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  Goregaon: { lines: ['WESTERN', 'HARBOUR'], stationWalkMeters: 350, busTrunkRoutes: 3 },
  Malad: { lines: ['WESTERN'], stationWalkMeters: 400, busTrunkRoutes: 3 },
  Kandivali: { lines: ['WESTERN'], stationWalkMeters: 350, busTrunkRoutes: 3 },
  Borivali: { lines: ['WESTERN'], stationWalkMeters: 300, busTrunkRoutes: 4 },
  Dahisar: { lines: ['WESTERN'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  // Eastern Suburbs
  Kurla: { lines: ['CENTRAL', 'HARBOUR'], stationWalkMeters: 200, busTrunkRoutes: 5 },
  Chunabhatti: { lines: ['HARBOUR'], stationWalkMeters: 350, busTrunkRoutes: 1 },
  Chembur: { lines: ['HARBOUR'], stationWalkMeters: 300, busTrunkRoutes: 3 },
  Ghatkopar: { lines: ['CENTRAL'], stationWalkMeters: 250, busTrunkRoutes: 4 },
  Vikhroli: { lines: ['CENTRAL'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  Powai: { lines: [], stationWalkMeters: 1600, busTrunkRoutes: 3 },
  Bhandup: { lines: ['CENTRAL'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  Mulund: { lines: ['CENTRAL'], stationWalkMeters: 350, busTrunkRoutes: 3 },
  Thane: { lines: ['CENTRAL', 'TRANS_HARBOUR'], stationWalkMeters: 250, busTrunkRoutes: 5 },
  Dombivli: { lines: ['CENTRAL'], stationWalkMeters: 300, busTrunkRoutes: 2 },
  // Harbour / Navi Mumbai
  Mankhurd: { lines: ['HARBOUR'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  Vashi: { lines: ['HARBOUR', 'TRANS_HARBOUR'], stationWalkMeters: 300, busTrunkRoutes: 4 },
  Sanpada: { lines: ['HARBOUR'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  Nerul: { lines: ['HARBOUR', 'TRANS_HARBOUR'], stationWalkMeters: 350, busTrunkRoutes: 3 },
  Seawoods: { lines: ['HARBOUR'], stationWalkMeters: 350, busTrunkRoutes: 2 },
  Belapur: { lines: ['HARBOUR'], stationWalkMeters: 400, busTrunkRoutes: 3 },
  Kharghar: { lines: ['HARBOUR'], stationWalkMeters: 500, busTrunkRoutes: 2 },
  Airoli: { lines: ['TRANS_HARBOUR'], stationWalkMeters: 400, busTrunkRoutes: 2 },
  Panvel: { lines: ['HARBOUR'], stationWalkMeters: 400, busTrunkRoutes: 3 },
};

// Rickshaw math: ₹26 flat covers ~1.5km (the meter only ticks up after 1.5km),
// so a zone with N neighbours within 2.5km is "N cheap converge points".
const RICKSHAW_CHEAP_RADIUS_KM = 2.5;

function computeRickshawReach(zoneName: string): number {
  const zone = MUMBAI_ZONES.find(z => z.name === zoneName);
  if (!zone) return 0;
  let neighboursInRing = 0;
  for (const other of MUMBAI_ZONES) {
    if (other.name === zoneName) continue;
    const d = getHaversineDistance(
      { lat: zone.lat, lng: zone.lng },
      { lat: other.lat, lng: other.lng }
    );
    if (d <= RICKSHAW_CHEAP_RADIUS_KM) neighboursInRing += 1;
  }
  return neighboursInRing;
}

export function computeTransitConnectivity(zoneName: string): number {
  const t = ZONE_TRANSIT[zoneName];
  if (!t) return 0;

  const lineScore = t.lines.length * 3;
  const stationScore = t.stationWalkMeters <= 400
    ? 4
    : Math.max(0, 4 - ((t.stationWalkMeters - 400) / 275));
  const rickshawScore = Math.min(3, computeRickshawReach(zoneName) * 0.5);
  const busScore = Math.min(2, t.busTrunkRoutes * 0.35);

  return +(lineScore + stationScore + rickshawScore + busScore).toFixed(2);
}

export async function executePlanningEngineForEval(
  groupData: any, presentMembers: any[], budgetSummary: any,
  presentLocations: any[], preferredCategories: string[], vibes: string[],
  historyEntries: any[], lowestBudget: number, options: string[] = []
): Promise<any[]> {
  return executePlanningEngine(groupData, presentMembers, budgetSummary, presentLocations, preferredCategories, vibes, historyEntries, lowestBudget, options);
}

async function executePlanningEngine(
  groupData: any,
  presentMembers: any[],
  budgetSummary: any,
  presentLocations: any[],
  preferredCategories: string[],
  vibes: string[],
  historyEntries: any[],
  lowestBudget: number,
  options: string[] = []
): Promise<any[]> {
  const city = 'Mumbai';
  const memberCoords = presentLocations.map(loc => ({ lat: loc.lat, lng: loc.lng }));
  const allCandidateZones = selectCandidateZones(memberCoords);
  
  // Randomly sample 4 zones from the larger pool (20) ensuring they are not clustered.
  const shuffledAllZones = [...allCandidateZones];
  for (let i = shuffledAllZones.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledAllZones[i], shuffledAllZones[j]] = [shuffledAllZones[j], shuffledAllZones[i]];
  }

  // Transit-connectivity-aware fair ranking. selectCandidateZones returns
  // zones ordered by travel-fairness penalty (lower idx = fairer). On top of
  // that we compute an EXPLICIT connectivity score from the underlying transit
  // graph: which lines the zone sits on (Western / Central / Harbour), its
  // walk-distance to the nearest station, and its rickshaw-reachability from
  // adjacent zones under the ₹26 base-fare + ₹17/km taxi rate. No hardcoded
  // "Bandra + 8" bonuses — a zone that's genuinely well-connected will beat a
  // less-connected zone even if the latter is a slightly better midpoint.
  const zoneRank = new Map<string, number>();
  shuffledAllZones.forEach((z, idx) => {
    const fairnessBonus = Math.max(0, shuffledAllZones.length - idx);
    const connectivity = computeTransitConnectivity(z.name);
    const jitter = Math.random() * 1.5;
    zoneRank.set(z.name, fairnessBonus + connectivity + jitter);
  });
  shuffledAllZones.sort((a, b) => (zoneRank.get(b.name) ?? 0) - (zoneRank.get(a.name) ?? 0));

  let candidateZones: any[] = [];
  const minSpacings = [4.0, 3.5, 3.0, 2.5];
  for (const spacing of minSpacings) {
    candidateZones = [];
    for (const zone of shuffledAllZones) {
      if (candidateZones.length >= 4) break;
      const tooClose = candidateZones.some(cz => getHaversineDistance({ lat: cz.lat, lng: cz.lng }, { lat: zone.lat, lng: zone.lng }) < spacing);
      if (!tooClose) {
        candidateZones.push(zone);
      }
    }
    if (candidateZones.length >= 4) break;
  }

  // Absolute fallback: if we still couldn't find 4 spaced-out zones, take the first 4 shuffled zones
  if (candidateZones.length < 4) {
    candidateZones.length = 0;
    candidateZones.push(...shuffledAllZones.slice(0, 4));
  }

  const avgLat = memberCoords.reduce((sum, c) => sum + c.lat, 0) / memberCoords.length;
  const avgLng = memberCoords.reduce((sum, c) => sum + c.lng, 0) / memberCoords.length;
  const avgMemberCoords = { lat: avgLat, lng: avgLng };

  const engineRejections: string[] = [];
  const logRejection = (name: string, reason: string) => {
    const msg = `[REJECTED] "${name}" | Reason: ${reason}`;
    console.log(msg);
    engineRejections.push(msg);
  };

  const isCheaper = options.includes('Cheaper');
  const isMoreIndoor = options.includes('More Indoor');
  const isLessTravel = options.includes('Less Travel');
  const isMoreActivities = options.includes('More Activities');
  const isMoreFood = options.includes('More Food');
  const isMoreCreative = options.includes('More Creative');
  const hasMoviePreference = (preferredCategories && preferredCategories.some(cat => cat.toUpperCase() === 'MOVIE')) ||
    (groupData.activity && String(groupData.activity).toLowerCase().includes('movie')) ||
    (groupData.outingType && String(groupData.outingType).toLowerCase().includes('movie')) ||
    (vibes && vibes.some(v => String(v).toLowerCase().includes('movie')));

  const activeVibes = [...vibes];
  if (options.includes('More Romantic') && !activeVibes.some(v => v.toUpperCase() === 'ROMANTIC')) {
    activeVibes.push('ROMANTIC');
  }

  const budgetsList = await budgetRepository.getGroupBudgets(groupData.id);

  const zoneCandidatesPromises = candidateZones.map(async (zone) => {
    const memberAvailableBudgets = presentMembers.map(m => {
      const loc = presentLocations.find(l => l.userId === m.userId);
      const memberLat = loc ? loc.lat : 19.0760;
      const memberLng = loc ? loc.lng : 72.8777;

      const travelBreakdown = calculateMumbaiTravelBreakdown(
        { lat: memberLat, lng: memberLng },
        { lat: zone.lat, lng: zone.lng },
        groupData.outingTime
      );
      const travelCost = travelBreakdown.totalCost;

      const budgetRecord = budgetsList.find(b => b.userId === m.userId);
      // Fall back to the engine's lowestBudget param (from presentBudgetSummary.min) when DB
      // has no record â€” avoids defaulting to 2000 for synthetic/eval groups.
      const maxBudget = budgetRecord ? budgetRecord.maxBudget : (lowestBudget > 0 ? lowestBudget : 2000);
      const travelIncluded = budgetRecord ? budgetRecord.travelIncluded : 1;

      const availableBudget = travelIncluded === 1 ? maxBudget - travelCost : maxBudget;

      return {
        userId: m.userId,
        availableBudget,
        travelCost
      };
    });

    const zoneLowestBudget = Math.max(500, Math.min(...memberAvailableBudgets.map(m => m.availableBudget)));

    const radiusKm = 6.0;
    const latDiff = radiusKm / 111.0;
    const lngDiff = radiusKm / (111.0 * Math.cos(zone.lat * Math.PI / 180));

    const dbPlaces = await db
      .select({
        id: places.id,
        name: places.name,
        address: places.address,
        lat: places.lat,
        lng: places.lng,
        rating: places.rating,
        reviewCount: places.reviewCount,
        category: placeCategories.category,
        mandatoryCost: placeCosts.mandatoryCost,
        optionalCostMin: placeCosts.optionalCostMin,
        optionalCostMax: placeCosts.optionalCostMax,
        lastVerified: places.lastVerified,
        isFeatured: places.isFeatured,
        isHidden: places.isHidden,
        boostFactor: places.boostFactor,
        firstSeen: places.firstSeen,
        imageUrl: places.imageUrl,
        popularity: placeScores.popularity,
        budgetFriendliness: placeScores.budgetFriendliness,
        conversation: placeScores.conversation,
        groupSuitability: placeScores.groupSuitability,
        dateSuitability: placeScores.dateSuitability,
        friendsSuitability: placeScores.friendsSuitability,
        familySuitability: placeScores.familySuitability,
        weatherSuitability: placeScores.weatherSuitability,
        uniqueness: placeScores.uniqueness,
        experienceScore: placeScores.experienceScore,
        overallScore: placeScores.overall
      })
      .from(places)
      .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
      .innerJoin(placeCosts, eq(placeCosts.placeId, places.id))
      .leftJoin(placeScores, eq(placeScores.placeId, places.id))
      .where(
        and(
          between(places.lat, zone.lat - latDiff, zone.lat + latDiff),
          between(places.lng, zone.lng - lngDiff, zone.lng + lngDiff)
        )
      );

    const strictCandidates: any[] = [];
    const adjacentCandidates: any[] = [];
    const lowQualityCandidates: any[] = [];

    dbPlaces.forEach((p: any) => {
      // Quality Gate: filter hidden places
      if (p.isHidden === 1) {
        logRejection(p.name, 'Hidden by admin curation');
        return;
      }

      const normalizedCategory = String(p.category ?? '').toUpperCase();
      if (ROLE_ONLY_PLACE_CATEGORIES.has(normalizedCategory) || !SELECTABLE_PLACE_CATEGORIES.has(normalizedCategory)) {
        logRejection(p.name, `Role-only or unsupported category "${p.category}"`);
        return;
      }

      if (normalizedCategory === 'MOVIE' && !hasMoviePreference) {
        logRejection(p.name, 'Excluded because no movie preference was specified');
        return;
      }

      if (!isHangoutWorthyCandidate({
        name: p.name,
        category: p.category,
        rating: p.rating,
        reviewCount: p.reviewCount,
        address: p.address,
      })) {
        logRejection(p.name, `Not a strong hangout candidate (${p.category}, rating=${p.rating ?? 'n/a'}, reviews=${p.reviewCount ?? 0})`);
        return;
      }

      // Check if it passes strict quality or relaxed quality
      const passedQuality = !(p.rating && p.rating > 0 && (p.reviewCount ?? 0) > 0 && (p.rating < 4.0 || (p.reviewCount ?? 0) < 20));
      const passedRelaxedQuality = !(p.rating && p.rating > 0 && (p.reviewCount ?? 0) > 0 && (p.rating < 3.8 || (p.reviewCount ?? 0) < 5));

      if (!passedQuality && !passedRelaxedQuality) {
        logRejection(p.name, `Low quality (rating=${p.rating}, reviews=${p.reviewCount ?? 0})`);
        return;
      }

      const venueZone = getVenueZone(p.lat, p.lng, p.name, p.address);
      const isStrictlyInZone = venueZone === zone.name;
      const adj = ADJACENT_ZONES[zone.name] || [];
      const isAdjacentZone = adj.includes(venueZone);

      if (!isStrictlyInZone && !isAdjacentZone) {
        logRejection(p.name, `REJECTED | Reason: Venue not matching midpoint zone "${zone.name}" nor adjacent zones. (zone = ${venueZone})`);
        return;
      }

      const candidateObj = {
        id: p.id,
        name: p.name,
        category: p.category,
        rating: p.rating || 4.0,
        lat: p.lat,
        lng: p.lng,
        estimatedCostPerHead: p.mandatoryCost + p.optionalCostMin,
        address: p.address || '',
        openNow: true,
        mandatoryCost: p.mandatoryCost,
        optionalCostMin: p.optionalCostMin,
        optionalCostMax: p.optionalCostMax,
        lastVerified: p.lastVerified,
        isFeatured: p.isFeatured,
        isHidden: p.isHidden,
        boostFactor: p.boostFactor,
        firstSeen: p.firstSeen,
        imageUrl: p.imageUrl,
        venueZone,
        
        // Joined placeScores metrics
        popularity: p.popularity ?? 0.5,
        budgetFriendliness: p.budgetFriendliness ?? 0.5,
        conversation: p.conversation ?? 0.5,
        groupSuitability: p.groupSuitability ?? 0.5,
        dateSuitability: p.dateSuitability ?? 0.5,
        friendsSuitability: p.friendsSuitability ?? 0.5,
        familySuitability: p.familySuitability ?? 0.5,
        weatherSuitability: p.weatherSuitability ?? 0.5,
        uniqueness: p.uniqueness ?? 0.5,
        experienceScore: p.experienceScore ?? 0.5,
        overallScore: p.overallScore ?? 0.5
      };

      if (!passedQuality && isStrictlyInZone) {
        lowQualityCandidates.push(candidateObj);
      } else if (!passedQuality) {
        logRejection(p.name, `Relaxed-quality candidate is in adjacent zone "${venueZone}" and cannot be mixed into "${zone.name}"`);
      } else if (isStrictlyInZone) {
        strictCandidates.push(candidateObj);
      } else {
        adjacentCandidates.push(candidateObj);
      }
    });

    const dbExperiences = await db
      .select({
        id: experiences.id,
        title: experiences.title,
        description: experiences.description,
        category: experiences.category,
        city: experiences.city,
        latitude: experiences.latitude,
        longitude: experiences.longitude,
        startDate: experiences.startDate,
        endDate: experiences.endDate,
        ticketPrice: experiences.ticketPrice,
        capacity: experiences.capacity,
        source: experiences.source,
        sourceUrl: experiences.sourceUrl,
        imageUrl: experiences.imageUrl,
        rating: experiences.rating,
        popularityScore: experiences.popularityScore,
        isRecurring: experiences.isRecurring,
        isActive: experiences.isActive,
        trendingScore: experiences.trendingScore,
        firstSeen: experiences.firstSeen,
        createdAt: experiences.createdAt,
        updatedAt: experiences.updatedAt,
        featuredId: featuredExperiences.id
      })
      .from(experiences)
      .leftJoin(featuredExperiences, eq(featuredExperiences.experienceId, experiences.id))
      .where(
        and(
          eq(experiences.city, 'Mumbai'),
          eq(experiences.isActive, 1)
        )
      );

    dbExperiences.forEach((e: any) => {
      // Date verification: Outing date must fall within the experience's start and end date
      if (groupData.outingDate) {
        const outingDateStr = groupData.outingDate.split('T')[0];
        const startStr = e.startDate.split('T')[0];
        const endStr = e.endDate.split('T')[0];
        if (outingDateStr < startStr || outingDateStr > endStr) {
          logRejection(e.title, `Event not active on outing date (${outingDateStr})`);
          return; // Skip ineligible experience
        }
      }

      const isFeatured = e.featuredId !== null;

      // Workshop/pottery/class experiences are niche â€” only include them when the group
      // explicitly wants creative activities, otherwise they crowd out cafes, arcades, parks.
      const WORKSHOP_CATS = new Set(['WORKSHOP', 'POTTERY', 'PAINTING', 'CREATIVE', 'BOARD_GAME', 'BOARD_GAME_EVENT']);
      const experienceCat = (e.category ?? '').toUpperCase();
      if (WORKSHOP_CATS.has(experienceCat)) {
        const groupWantsWorkshop = preferredCategories.some(p => WORKSHOP_CATS.has(p.toUpperCase()));
        if (!groupWantsWorkshop && !isMoreCreative && !isFeatured) {
          logRejection(e.title, `Workshop/class excluded â€” group preferences don't include creative activities`);
          return;
        }
      }

      // Zone matching for experiences
      const expZone = getVenueZone(e.latitude, e.longitude, e.title, e.sourceUrl);
      const isStrictlyInZone = expZone === zone.name;
      const adj = ADJACENT_ZONES[zone.name] || [];
      const isAdjacentZone = adj.includes(expZone);

      if (!isStrictlyInZone && !isAdjacentZone && !isFeatured) {
        logRejection(e.title, `REJECTED | Reason: Experience not matching midpoint zone "${zone.name}" nor adjacent zones. (zone = ${expZone})`);
        return;
      }

      // Experiences are high-quality by default, so we put them in strict or adjacent pools
      const candidateObj = {
        id: e.id,
        name: e.title,
        category: e.category,
        rating: e.rating || 4.5,
        lat: e.latitude,
        lng: e.longitude,
        estimatedCostPerHead: e.ticketPrice,
        address: e.sourceUrl || '',
        openNow: true,
        isExperience: true,
        imageUrl: e.imageUrl || undefined,
        sourceUrl: e.sourceUrl,
        venueZone: expZone,
        mandatoryCost: e.ticketPrice,
        optionalCostMin: 0,
        optionalCostMax: 0,
        lastVerified: e.updatedAt,
        isFeatured: isFeatured ? 1 : 0,
        isHidden: 0,
        boostFactor: 1.0,
        firstSeen: e.firstSeen,
        
        // Curated experiences are naturally very suitable for date/family outings, so default to 0.8
        popularity: e.popularityScore ?? 0.8,
        budgetFriendliness: 0.7,
        conversation: 0.8,
        groupSuitability: 0.8,
        dateSuitability: 0.8,
        friendsSuitability: 0.8,
        familySuitability: 0.8,
        weatherSuitability: 0.8,
        uniqueness: 0.8,
        experienceScore: 0.8,
        overallScore: 0.8
      };

      if (isStrictlyInZone) {
        strictCandidates.push(candidateObj);
      } else {
        adjacentCandidates.push(candidateObj);
      }
    });

    // Handle sparse candidates - apply live fetch or fallbacks first to strictCandidates
    if (strictCandidates.length < 5) {
      const existingCats = new Set(strictCandidates.map(c => c.category.toUpperCase()));
      const gaps = PLANNER_REQUIRED_CATEGORIES.filter(cat => !existingCats.has(cat)).slice(0, 3);

      if (gaps.length > 0) {
        try {
          const fetched = await reactiveVenueFetch({ name: zone.name, lat: zone.lat, lng: zone.lng }, gaps);
          if (fetched.length > 0) {
            console.log(`[PLANNER] Reactive fetch added ${fetched.length} venues to ${zone.name}`);
            strictCandidates.push(...fetched
              .filter(f => getVenueZone(f.lat, f.lng, f.name, f.address) === zone.name)
              .map(f => ({
              ...f,
              isStrictlyInZone: true,
              venueZone: zone.name,
              popularity: 0.5,
              budgetFriendliness: 0.5,
              conversation: 0.5,
              groupSuitability: 0.5,
              dateSuitability: 0.5,
              friendsSuitability: 0.5,
              familySuitability: 0.5,
              weatherSuitability: 0.5,
              uniqueness: 0.5,
              experienceScore: 0.5,
              overallScore: 0.5
            })));
          }
        } catch (reactiveErr) {
          console.warn('[PLANNER] Reactive fetch failed:', reactiveErr);
        }
        enqueueGapDiscovery({ name: zone.name, lat: zone.lat, lng: zone.lng, radius: radiusKm * 1000 }, gaps);
      }

      if (strictCandidates.length < 5) {
        const fallbacks = await resolveZoneFallbacks(zone.name, zone.lat, zone.lng);
        const filteredFallbacks = hasMoviePreference ? fallbacks : fallbacks.filter(f => f.category.toUpperCase() !== 'MOVIE');
        if (filteredFallbacks.length > 0) {
          strictCandidates.push(...filteredFallbacks
            .filter(f => getVenueZone(f.lat, f.lng, f.name, f.address) === zone.name)
            .map(f => ({
            ...f,
            isStrictlyInZone: true,
            venueZone: zone.name,
            isZoneCurated: true,
            popularity: 0.5,
            budgetFriendliness: 0.5,
            conversation: 0.5,
            groupSuitability: 0.5,
            dateSuitability: 0.5,
            friendsSuitability: 0.5,
            familySuitability: 0.5,
            weatherSuitability: 0.5,
            uniqueness: 0.5,
            experienceScore: 0.5,
            overallScore: 0.5
          })));
        }
      }
    }

    // Assemble final pool. Strict zone integrity is non-negotiable: no adjacent-zone
    // candidates are mixed into a plan labeled as the selected zone.
    const candidatesPool: any[] = [...strictCandidates];

    if (candidatesPool.length < 5 && adjacentCandidates.length > 0) {
      const adjNames = ADJACENT_ZONES[zone.name] || [];
      console.log(`[ZONE EXPANSION SKIPPED] Zone "${zone.name}" has only ${candidatesPool.length} strict candidates. Adjacent venues available (${adjNames.join(', ')}) but not mixed into a single-zone itinerary.`);
    }

    if (candidatesPool.length < 5 && lowQualityCandidates.length > 0) {
      console.log(`[QUALITY RELAXATION] Zone "${zone.name}" has only ${candidatesPool.length} candidates. Relaxing quality gates to satisfy requirements...`);
      candidatesPool.push(...lowQualityCandidates);
    }

    const openCandidates = candidatesPool.filter(c => {
      const isOpen = isVenueOpenAtTime(c.category, groupData.outingTime);
      if (!isOpen) {
        logRejection(c.name, `Closed at outing time (${groupData.outingTime})`);
      }
      return isOpen;
    });

    const filteredCandidates = openCandidates.filter(c => {
      const outdoorCategories = ['PARK', 'OUTDOOR_EXPERIENCE', 'SCENIC_EXPERIENCE'];
      if (isMoreIndoor && outdoorCategories.includes(c.category.toUpperCase())) {
        logRejection(c.name, `REJECTED | Reason: Excluded by "More Indoor" option`);
        return false;
      }

      const effectiveBudget = isCheaper ? zoneLowestBudget * 0.8 : zoneLowestBudget;
      const perSlotCap = Math.max(300, Math.floor(effectiveBudget * 0.8)); // Allow slots to consume up to 80% of total budget (min cap â‚¹300)
      if (c.estimatedCostPerHead > perSlotCap && !c.isFallback && !c.isZoneCurated) {
        logRejection(c.name, `REJECTED | Reason: Budget (cost â‚¹${c.estimatedCostPerHead} exceeds per-slot cap â‚¹${perSlotCap})`);
        return false;
      }

      const dist = getHaversineDistance({ lat: zone.lat, lng: zone.lng }, { lat: c.lat, lng: c.lng });
      // If the venue is in an adjacent zone, allow up to 8km travel, otherwise standard bounds
      const isAdj = !strictCandidates.find(sc => sc.id === c.id);
      const maxDistance = isAdj ? 8.0 : (isLessTravel ? 5.0 : 8.0);
      if (dist > maxDistance && !c.isFallback && !c.isZoneCurated) {
        logRejection(c.name, `REJECTED | Reason: Too far (${dist.toFixed(1)}km exceeds allowed ${maxDistance}km from zone center)`);
        return false;
      }

      return true;
    });

    const scoredCandidatesPromises = filteredCandidates.map(async (c) => {
      const metricsResults = await db
        .select()
        .from(rankingMetrics)
        .where(eq(rankingMetrics.placeId, c.id))
        .limit(1)
        .catch(() => [] as any[]);
      const metricsRecord = (metricsResults && metricsResults.length > 0) ? metricsResults[0] : null;

      const baseScore = scorePlaceCandidateRefactored(
        c,
        groupData.groupType,
        zoneLowestBudget,
        avgMemberCoords,
        metricsRecord,
        (c as any).lastVerified
      );
      const randomOffset = (Math.random() - 0.5) * 0.15;
      const score = baseScore + randomOffset;

      return {
        ...c,
        score
      };
    });

    const scoredCandidates = await Promise.all(scoredCandidatesPromises);
    scoredCandidates.sort((a, b) => b.score - a.score);

    return {
      zone,
      zoneLowestBudget,
      candidates: scoredCandidates
    };
  });

  const zonesData = await Promise.all(zoneCandidatesPromises);

  const usedPlaceIds = new Set<string>();
  const draftItineraries: any[] = [];
  const tiers = ['TRAVEL_FRIENDLY', 'BUDGET_FRIENDLY', 'BALANCED', 'EXPERIENCE_FIRST'] as const;

  // Context first, then archetype, then venues. This is the hierarchical
  // dispatch requested in the audit: we do NOT start from a shuffled template
  // and hope the venues fit — we decide what kind of day to plan up front.
  const planningContext = buildPlanningContext({
    groupType: groupData.groupType,
    groupSize: presentMembers.length,
    outingTime: groupData.outingTime,
    outingDate: groupData.outingDate,
    preferredCategories,
    requiredPreferences: Array.isArray(groupData.requiredPreferences)
      ? groupData.requiredPreferences
      : [],
    vibes: activeVibes,
    options,
    intent: groupData.outingIntent as OutingIntent | undefined,
    extraGroupSignals: { activity: groupData.activity, outingType: groupData.outingType },
  });
  console.log('[PLANNER] planning context:', JSON.stringify({
    groupType: planningContext.groupType,
    sizeBucket: planningContext.sizeBucket,
    timeBucket: planningContext.timeBucket,
    weather: planningContext.weather,
    intent: planningContext.intent,
    preferences: planningContext.preferredCategories,
    requiredPreferences: planningContext.requiredPreferences,
    vibes: planningContext.vibes,
    options: planningContext.options,
  }));

  const buildPass = async (allowSharedVenues = false) => {
    const shuffledZones = [...candidateZones];
    for (let idx = shuffledZones.length - 1; idx > 0; idx--) {
      const j = Math.floor(Math.random() * (idx + 1));
      [shuffledZones[idx], shuffledZones[j]] = [shuffledZones[j], shuffledZones[idx]];
    }

    // Stage 3 primary path: pull a LARGE archetype pool (up to 8) so the
    // 40-candidate generation phase has enough shapes to combine with zones
    // and budget tiers. The final cluster-and-pick step will still return 2.
    const ARCHETYPE_POOL_SIZE = 8;
    const archetypePicks = pickArchetypesForContext(planningContext, ARCHETYPE_POOL_SIZE);
    const isDate = planningContext.groupType === 'DATE';
    const templatePool = isDate ? DATE_ITINERARY_TEMPLATES : ITINERARY_TEMPLATES;

    let pickedTemplates: ItineraryTemplate[];
    let pickedArchetypeMeta: Array<{ key: string; family: string; label: string } | null>;

    if (archetypePicks.length >= 4) {
      pickedTemplates = archetypePicks.map(p =>
        overlayPreferencesOntoTemplate(p.template, planningContext.preferredCategories)
      );
      pickedArchetypeMeta = archetypePicks.map(p => ({
        key: p.archetypeKey,
        family: p.archetypeFamily,
        label: p.archetype.humanLabel,
      }));
      console.log('[PLANNER] archetype dispatch (pool size ' + archetypePicks.length + '):',
        archetypePicks.map(p => ({
          key: p.archetypeKey,
          shape: `${p.template.slot1[0]}->${p.template.slot2[0]}->${p.template.slot3[0]}`,
          label: p.archetype.humanLabel,
        }))
      );
    } else {
      // Fallback: pool badly under-served → top up with Stage 1 legacy templates.
      const target = 6;
      const s1Templates = pickArchetypeTemplates(planningContext, templatePool, target);
      const filled = [
        ...archetypePicks.map(p => p.template),
        ...s1Templates,
      ].slice(0, target);
      pickedTemplates = filled.map(t =>
        overlayPreferencesOntoTemplate(t, planningContext.preferredCategories)
      );
      pickedArchetypeMeta = [
        ...archetypePicks.map(p => ({
          key: p.archetypeKey,
          family: p.archetypeFamily,
          label: p.archetype.humanLabel,
        })),
        ...Array(Math.max(0, target - archetypePicks.length)).fill(null),
      ].slice(0, target);
      console.warn(`[PLANNER] archetype pool short (${archetypePicks.length}) — padding with legacy templates. Context:`,
        JSON.stringify({
          groupType: planningContext.groupType,
          size: planningContext.sizeBucket,
          time: planningContext.timeBucket,
          weather: planningContext.weather,
        }));
    }

    const getActiveTemplate = (idx: number): ItineraryTemplate => {
      return pickedTemplates[idx % pickedTemplates.length];
    };
    const getActiveArchetypeMeta = (idx: number) => {
      return pickedArchetypeMeta[idx % pickedArchetypeMeta.length];
    };

    // Stage 3 candidate pool: generate up to CANDIDATE_TARGET candidates by
    // sweeping (template × zone × budget-tier). We deliberately over-generate
    // so the downstream clustering step can select 2 truly-distinct
    // representatives instead of picking one-best-per-archetype. This is the
    // "avoid local optima via clustering" pattern.
    const CANDIDATE_TARGET = 40;
    const combos: Array<{ templateIdx: number; zoneIdx: number; tierIdx: number }> = [];
    for (let t = 0; t < pickedTemplates.length; t++) {
      for (let z = 0; z < shuffledZones.length; z++) {
        for (let b = 0; b < tiers.length; b++) {
          combos.push({ templateIdx: t, zoneIdx: z, tierIdx: b });
        }
      }
    }
    // Shuffle combos so we don't burn all our budget on template[0].
    for (let idx = combos.length - 1; idx > 0; idx--) {
      const j = Math.floor(Math.random() * (idx + 1));
      [combos[idx], combos[j]] = [combos[j], combos[idx]];
    }

    for (let i = 0; i < Math.min(CANDIDATE_TARGET, combos.length); i++) {
      if (draftItineraries.length >= CANDIDATE_TARGET) break;

      const { templateIdx, zoneIdx, tierIdx } = combos[i];
      const budgetTier = tiers[tierIdx];
      const planIndex = i + 1;

      const zoneObj = shuffledZones[zoneIdx];
      const zoneData = zonesData.find(zd => zd.zone.name === zoneObj.name) || zonesData[0];

      const filterAndUnused = (list: any[]) => allowSharedVenues ? list : list.filter(c => !usedPlaceIds.has(c.id));
      let candidatesPool = filterAndUnused(zoneData.candidates);

      const template = getActiveTemplate(templateIdx);
      const slot1Cats = template.slot1;
      const slot1IsActivity = template.slot1Act;
      const slot2Cats = template.slot2;
      const slot2IsActivity = template.slot2Act;
      const slot3Cats = template.slot3;
      const slot3IsActivity = template.slot3Act;

      // Track categories already picked in this plan to avoid e.g. CAFE+CAFE in same plan
      const selectedPlanCats = new Set<string>();
      let chainCount = 0;

      const getMandatoryCost = (place: PlaceCandidate) => {
        if ((place as any).mandatoryCost !== undefined) {
          return (place as any).mandatoryCost;
        }
        if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase())) {
          return Math.round(place.estimatedCostPerHead * 0.4);
        } else if (place.isExperience) {
          return place.estimatedCostPerHead;
        } else {
          return Math.round(place.estimatedCostPerHead * 0.7);
        }
      };

      const getOptionalCostMin = (place: PlaceCandidate) => {
        if ((place as any).optionalCostMin !== undefined) {
          return (place as any).optionalCostMin;
        }
        if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase())) {
          return Math.round(place.estimatedCostPerHead * 0.6);
        } else if (place.isExperience) {
          return 0;
        } else {
          return Math.round(place.estimatedCostPerHead * 0.3);
        }
      };

      const getOptionalCostMax = (place: PlaceCandidate) => {
        if ((place as any).optionalCostMax !== undefined) {
          return (place as any).optionalCostMax;
        }
        if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase())) {
          return Math.round(place.estimatedCostPerHead * 1.5);
        } else if (place.isExperience) {
          return 0;
        } else {
          return Math.round(place.estimatedCostPerHead * 1.0);
        }
      };

      const selectPlaceForSlot = (preferredCats: string[], isActivity: boolean, remainingBudget: number) => {
        let matches = candidatesPool.filter(c => preferredCats.includes(c.category.toUpperCase()));
        if (chainCount >= 1) {
          matches = matches.filter(c => !isChain(c.name));
        }

        // Realism: prefer NOT to repeat a category that's already in this plan
        // (no CAFE → CAFE → CAFE, no DESSERT → CAFE where CAFE already ran).
        // We only apply this at the primary-match layer — if it empties the
        // pool, we fall through to the existing broad fallbacks which will
        // still cover an already-used category if that's genuinely all that
        // fits the slot.
        const uniqueMatches = matches.filter(c => !selectedPlanCats.has(c.category.toUpperCase()));
        if (uniqueMatches.length > 0) matches = uniqueMatches;

        const getSlotCost = (place: PlaceCandidate) => {
          return getMandatoryCost(place) + getOptionalCostMin(place);
        };

        // Prefer venues whose category isn't already in the plan (extra
        // guarantee on top of uniqueMatches — if two venues tie on score,
        // the unused-category one wins). Keeps within-plan category diversity
        // high without derailing budget/score.
        // Layered sort: (1) preferred-category venues first (user asked
        // for Museum + Park → we aggressively surface those), (2) unused
        // category next (no CAFE→CAFE), (3) fall back to caller ordering
        // (which is DB score ranking). This is what turns "sprinkle prefs
        // as a scoring nudge" into "aggressively search for the pref".
        const userPrefSet = new Set(
          (preferredCategories || []).map(c => c.toUpperCase())
        );
        const rankByUnusedCat = (arr: PlaceCandidate[]) => [...arr].sort((a, b) => {
          const ap = userPrefSet.has(a.category.toUpperCase()) ? 0 : 1;
          const bp = userPrefSet.has(b.category.toUpperCase()) ? 0 : 1;
          if (ap !== bp) return ap - bp; // prefs first
          const au = selectedPlanCats.has(a.category.toUpperCase()) ? 1 : 0;
          const bu = selectedPlanCats.has(b.category.toUpperCase()) ? 1 : 0;
          return au - bu;
        });

        // 1. Try to find a match of the preferred categories under budget constraint
        const budgetMatches = rankByUnusedCat(matches.filter(c => getSlotCost(c) <= remainingBudget));

        let selected: PlaceCandidate | null = null;

        if (budgetMatches.length > 0) {
          const top3 = budgetMatches.slice(0, 3);
          const rand = Math.random();
          if (top3.length === 1) {
            selected = top3[0];
          } else if (top3.length === 2) {
            selected = rand < 0.6 ? top3[0] : top3[1];
          } else {
            if (rand < 0.5) selected = top3[0];
            else if (rand < 0.85) selected = top3[1];
            else selected = top3[2];
          }
        } else {
          // 2. If no preferred category matches under budget constraint, fallback to broad category checks under budget
          let fallbackPool: PlaceCandidate[] = [];
          if (isActivity) {
            // Activities: skip food AND skip categories already used in this
            // plan. If that empties the pool, drop the used-category filter.
            const nonFood = candidatesPool.filter(c => !['CAFE', 'RESTAURANT', 'DESSERT'].includes(c.category.toUpperCase()));
            const unusedNonFood = nonFood.filter(c => !selectedPlanCats.has(c.category.toUpperCase()));
            fallbackPool = unusedNonFood.length > 0 ? unusedNonFood : nonFood;
          } else {
            const FOOD_CATS = ['CAFE', 'RESTAURANT', 'DESSERT'];
            fallbackPool = candidatesPool.filter(c =>
              FOOD_CATS.includes(c.category.toUpperCase()) && !selectedPlanCats.has(c.category.toUpperCase())
            );
            if (fallbackPool.length === 0) {
              fallbackPool = candidatesPool.filter(c => FOOD_CATS.includes(c.category.toUpperCase()));
            }
          }
          if (chainCount >= 1) {
            fallbackPool = fallbackPool.filter(c => !isChain(c.name));
          }
          fallbackPool = rankByUnusedCat(fallbackPool);

          const budgetFallbackMatches = fallbackPool.filter(c => getSlotCost(c) <= remainingBudget);
          if (budgetFallbackMatches.length > 0) {
            const top3 = budgetFallbackMatches.slice(0, 3);
            const rand = Math.random();
            if (top3.length === 1) {
              selected = top3[0];
            } else if (top3.length === 2) {
              selected = rand < 0.6 ? top3[0] : top3[1];
            } else {
              if (rand < 0.5) selected = top3[0];
              else if (rand < 0.85) selected = top3[1];
              else selected = top3[2];
            }
          } else {
            // 3. Relax budget constraint completely, sort by cost ascending, and pick the cheapest option
            const preferredPool = matches.length > 0 ? matches : fallbackPool;
            if (preferredPool.length > 0) {
              const sorted = [...preferredPool].sort((a, b) => getSlotCost(a) - getSlotCost(b));
              selected = sorted[0];
            }
          }
        }

        if (!selected) return null;

        if (isChain(selected.name)) {
          chainCount++;
        }
        return selected;
      };

      // Variable stop count: archetypes with slotCount === 2 (WORK_TEAM_
      // ACTIVITY, WORK_MORNING_MEETUP, NIGHTLIFE-lite) produce 2-stop plans.
      // Everything else stays 3-stop for now.
      const activeArchKey = getActiveArchetypeMeta(templateIdx)?.key ?? null;
      const activeArch = activeArchKey ? ARCHETYPE_BY_KEY[activeArchKey] : undefined;
      let isTwoSlots = activeArch?.slotCount === 2;
      let remainingBudget = zoneData.zoneLowestBudget;

      const slot1Place = selectPlaceForSlot(slot1Cats, slot1IsActivity, remainingBudget);
      if (!slot1Place) continue;
      selectedPlanCats.add(slot1Place.category.toUpperCase());
      candidatesPool = candidatesPool.filter(c => c.id !== slot1Place.id);
      remainingBudget -= (getMandatoryCost(slot1Place) + getOptionalCostMin(slot1Place));

      const slot2Place = selectPlaceForSlot(slot2Cats, slot2IsActivity, remainingBudget);
      if (!slot2Place) continue;
      selectedPlanCats.add(slot2Place.category.toUpperCase());
      candidatesPool = candidatesPool.filter(c => c.id !== slot2Place.id);
      remainingBudget -= (getMandatoryCost(slot2Place) + getOptionalCostMin(slot2Place));

      let slot3Place: PlaceCandidate | null = null;
      if (!isTwoSlots) {
        slot3Place = selectPlaceForSlot(slot3Cats, slot3IsActivity, remainingBudget);
        if (!slot3Place) {
          isTwoSlots = true;
        } else {
          selectedPlanCats.add(slot3Place.category.toUpperCase());
          candidatesPool = candidatesPool.filter(c => c.id !== slot3Place!.id);
        }
      }

      const m1 = getMandatoryCost(slot1Place);
      const m2 = getMandatoryCost(slot2Place);
      const m3 = isTwoSlots ? 0 : getMandatoryCost(slot3Place!);
      const totalMandatorySlotsCost = m1 + m2 + m3;

      const opt1 = getOptionalCostMin(slot1Place);
      const opt2 = getOptionalCostMin(slot2Place);
      const opt3 = isTwoSlots ? 0 : getOptionalCostMin(slot3Place!);
      const totalEstimatedSlotsCost = totalMandatorySlotsCost + opt1 + opt2 + opt3;

      // Budget checks are handled progressively during slot selection; we allow the plan.

      if (!allowSharedVenues) {
        usedPlaceIds.add(slot1Place.id);
        usedPlaceIds.add(slot2Place.id);
        if (!isTwoSlots && slot3Place) {
          usedPlaceIds.add(slot3Place.id);
        }
      }

      const selectedPlaces = isTwoSlots ? [slot1Place, slot2Place] : [slot1Place, slot2Place, slot3Place!];
      
      const slotsPromises = selectedPlaces.map(async (place, slotIdx) => {
        let finalImg = place.imageUrl || null;
        let finalLink = place.sourceUrl || null;
        let needsDbUpdate = false;
        
        // Real Google Places photo lookup. Skipped for fallback venues and
        // for OLA-prefixed ids (Ola's places API doesn't return Google
        // photo references — those venues fall through to the text-search
        // getVenueImageUrl below).
        const isGooglePlaceId = place.id
          && !place.id.startsWith('fb_')
          && !place.id.startsWith('fallback_')
          && !place.id.startsWith('OLA_')
          && !place.isExperience;
        if (isGooglePlaceId) {
          try {
            const actualPlaceId = place.id.startsWith('GOOGLE_')
              ? place.id.slice(7)
              : place.id;
            const details = await getVenueDetails(actualPlaceId);
            if (details && details.photos && details.photos.length > 0) {
              const photoRef = details.photos[0].photo_reference;
              if (photoRef) {
                finalImg = `/api/places/photo?ref=${encodeURIComponent(photoRef)}`;
                if (finalImg !== place.imageUrl) {
                  needsDbUpdate = true;
                }
              }
            }
            if (details && details.website) {
              finalLink = details.website;
            }
          } catch (err) {}
        }

        if (isDisallowedItineraryImage(finalImg)) {
          const googleImg = await getVenueImageUrl(place.name, city, place.category);
          if (!isDisallowedItineraryImage(googleImg)) {
            finalImg = googleImg;
            if (place.id && !place.id.startsWith('fb_') && !place.id.startsWith('fallback_') && !place.isExperience && finalImg !== place.imageUrl) {
              needsDbUpdate = true;
            }
          }
        }
        // Final fallback: never show third-party stock imagery for real itinerary cards.
        if (isDisallowedItineraryImage(finalImg)) {
          finalImg = getFallbackImageUrl(place.category);
        }
        if (!finalLink) {
          finalLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`;
        }

        if (needsDbUpdate && place.id && !place.isExperience) {
          void db.update(places)
            .set({ imageUrl: finalImg })
            .where(eq(places.id, place.id))
            .catch((err: any) => console.warn(`Failed to update imageUrl in DB for place ${place.id}:`, err));
        }

        const duration = getDurationForCategory(place.category);
        let arrivalTime = groupData.outingTime || '11:00 AM';
        if (slotIdx > 0) {
          let prevTime = groupData.outingTime || '11:00 AM';
          for (let i = 0; i < slotIdx; i++) {
            const prevPlace = selectedPlaces[i];
            const prevDuration = getDurationForCategory(prevPlace.category);
            const prevTransit = 15;
            prevTime = addMinutesToTimeString(prevTime, prevDuration + prevTransit);
          }
          arrivalTime = prevTime;
        }

        return {
          order: slotIdx + 1,
          venueId: place.isExperience ? null : place.id,
          experienceId: place.isExperience ? place.id : null,
          name: place.name,
          category: place.category,
          rating: place.rating ?? null,
          arrivalTime,
          durationMinutes: duration,
          travelToNextMinutes: slotIdx === 2 ? null : 15,
          // Honest per-slot spend: mandatory + typical optional min. Matches
          // what the plan-total sums up to, and what a user would actually
          // spend if they order a normal meal / do the standard experience.
          estimatedCostPerHead: getMandatoryCost(place) + getOptionalCostMin(place),
          mandatoryCost: getMandatoryCost(place),
          optionalCostMin: getOptionalCostMin(place),
          optionalCostMax: getOptionalCostMax(place),
          imageUrl: finalImg,
          link: finalLink,
          note: getSlotDescription(place.name, place.category, zoneObj.name),
          lat: place.lat,
          lng: place.lng,
          address: place.address || ''
        };
      });

      const buildItineraryData = async () => {
        const slots = await Promise.all(slotsPromises);

        for (let sIdx = 0; sIdx < slots.length - 1; sIdx++) {
          const current = slots[sIdx];
          const next = slots[sIdx + 1];

          // Use the SAME breakdown model as home→meetup for slot-to-slot.
          // A 200m walk between venues is not "15 min"; a 6km train hop is
          // not "24 min auto". Honest numbers only.
          const hop = calculateMumbaiTravelBreakdown(
            { lat: current.lat, lng: current.lng },
            { lat: next.lat, lng: next.lng },
            groupData.outingTime
          );

          current.travelToNextMinutes = hop.totalTime;
          (current as any).travelToNextCost = Math.ceil(hop.totalCost / Math.min(3, presentMembers.length));
          (current as any).travelToNextMode = hop.trainTime > 0 ? 'TRAIN' : hop.autoTime > 0 ? 'AUTO' : 'WALK';
          (current as any).travelToNextBreakdown = {
            walkMin: hop.walkingTime,
            autoMin: hop.autoTime,
            trainMin: hop.trainTime,
          };
          // Propagate corrected arrival time to the next slot
          next.arrivalTime = addMinutesToTimeString(current.arrivalTime, current.durationMinutes + hop.totalTime);
        }

        const memberTravelsForPlan: any[] = [];
        const totalTimes: number[] = [];
        const totalCosts: number[] = [];

        presentLocations.forEach(loc => {
          const breakdown = calculateMumbaiTravelBreakdown({ lat: loc.lat, lng: loc.lng }, { lat: zoneObj.lat, lng: zoneObj.lng }, groupData.outingTime);
          
          totalTimes.push(breakdown.totalTime);
          totalCosts.push(breakdown.totalCost);

          const travelId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

          memberTravelsForPlan.push({
            id: travelId,
            userId: loc.userId,
            walkingTime: breakdown.walkingTime,
            autoTime: breakdown.autoTime,
            autoCost: breakdown.autoCost,
            trainTime: breakdown.trainTime,
            trainCost: breakdown.trainCost,
            totalTime: breakdown.totalTime,
            totalCost: breakdown.totalCost,
            train_time: breakdown.trainTime,
            train_cost: breakdown.trainCost,
            cab_time: breakdown.autoTime,
            cab_cost: breakdown.autoCost,
            walk_time: breakdown.walkingTime
          });
        });

        const avgTotalTime = Math.round(totalTimes.reduce((sum, t) => sum + t, 0) / totalTimes.length);
        const avgTotalCost = Math.round(totalCosts.reduce((sum, c) => sum + c, 0) / totalCosts.length);
        const longestTravelTime = Math.max(...totalTimes);
        const shortestTravelTime = Math.min(...totalTimes);

        const variance = totalTimes.reduce((sum, t) => sum + Math.pow(t - avgTotalTime, 2), 0) / totalTimes.length;
        const stdDev = Math.sqrt(variance);
        const travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30.0);

        const slotsMandatoryCost = slots.reduce((sum, s) => sum + s.mandatoryCost, 0);
        const slotsOptionalMin = slots.reduce((sum, s) => sum + s.optionalCostMin, 0);
        const slotsOptionalMax = slots.reduce((sum, s) => sum + s.optionalCostMax, 0);

        const totalMandatoryCost = slotsMandatoryCost + avgTotalCost;

        const planId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

        // Dynamic travel score
        const travelScore = Math.max(0.5, Math.min(0.98, 1.0 - (avgTotalTime / 120.0)));

        // Dynamic budget score
        const budgetScore = Math.max(0.5, Math.min(0.98, 1.0 - (totalMandatoryCost / (zoneData.zoneLowestBudget || 2000)) * 0.2));

        // Dynamic preference score based on average candidate suitability/rating
        const preferenceScore = Math.max(0.5, Math.min(0.98, slots.reduce((sum, s) => sum + (s.rating || 4.2), 0) / (slots.length * 5.0)));

        // Dynamic quality score based on average ratings
        const ratings = slots.map(s => s.rating).filter(r => r !== null && r !== undefined);
        const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 4.2;
        const qualityScore = Math.max(0.5, Math.min(0.98, avgRating / 5.0 + 0.1));

        // Dynamic weather score
        const isRainySeason = (() => {
          if (!groupData?.outingDate) return false;
          const parts = groupData.outingDate.split('-');
          if (parts.length < 2) return false;
          const month = parseInt(parts[1]);
          return [6, 7, 8].includes(month);
        })();
        const hasOutdoor = slots.some(s => ['PARK', 'PROMENADE', 'BEACH', 'OUTDOOR'].includes(s.category.toUpperCase()));
        const weatherScore = isRainySeason ? (hasOutdoor ? 0.60 : 0.95) : 0.95;

        // Composite overall score using the weights:
        // Travel (35%), Budget (25%), Preferences (20%), Venue Quality (15%), Weather (5%)
        const overallScore = travelScore * 0.35 + budgetScore * 0.25 + preferenceScore * 0.20 + qualityScore * 0.15 + weatherScore * 0.05;

        // Compute real per-member travel averages from breakdown data
        const avgTrainTime = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.trainTime || 0), 0) / memberTravelsForPlan.length)
          : 0;
        const avgTrainCost = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.trainCost || 0), 0) / memberTravelsForPlan.length)
          : 0;
        const avgAutoTime = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.autoTime || 0), 0) / memberTravelsForPlan.length)
          : 0;
        const avgAutoCost = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.autoCost || 0), 0) / memberTravelsForPlan.length)
          : 0;
        const avgWalkTime = memberTravelsForPlan.length > 0
          ? Math.round(memberTravelsForPlan.reduce((s, m) => s + (m.walkingTime || 0), 0) / memberTravelsForPlan.length)
          : 0;

        const planName = zoneObj.name;
        let tagline = `A wonderful day out in ${zoneObj.name}.`;

        if (planIndex === 1) {
          tagline = `A pocket-friendly day out exploring scenic walks and cozy local spots in ${zoneObj.name}.`;
        } else if (planIndex === 2) {
          tagline = `Start with coffee, explore a local attraction, then end the day with a great meal in ${zoneObj.name}.`;
        } else if (planIndex === 3) {
          tagline = `An exciting day featuring bowling, arcades, and active entertainment in ${zoneObj.name}.`;
        } else if (planIndex === 4) {
          tagline = `Discover pottery classes, art galleries, and cultural experiences in ${zoneObj.name}.`;
        }

        const draftPlanForWhy = {
          longestTravelTime,
          budgetTier,
          budgetScore,
          score: overallScore,
          slots
        };
        const whyRecList = generateWhyRecommended(draftPlanForWhy, groupData);

        return {
          id: planId,
          groupId: groupData.id,
          planIndex,
          name: planName,
          tagline,
          budgetTier,
          totalEstimatedCostPerHead: totalMandatoryCost + slotsOptionalMin,
          totalDurationMinutes: slots.reduce((sum, s) => sum + s.durationMinutes, 0) + slots.reduce((sum, s) => sum + (s.travelToNextMinutes || 0), 0),
          score: overallScore,

          experienceScore: preferenceScore,
          travelScore: travelScore,
          budgetScore: budgetScore,
          fairnessScore: travelFairnessScore,
          popularityScore: qualityScore,
          groupTypeMatchScore: preferenceScore,
          vibeMatchScore: weatherScore,
          compositeScore: overallScore,

          avgTrainTime,
          avgCabTime: avgAutoTime,
          avgTrainCost,
          avgCabCost: avgAutoCost,
          longestTravelTime,
          shortestTravelTime,
          travelFairnessScore,

          avgAutoTime,
          avgAutoCost,
          avgTotalTime,
          avgTotalCost,
          avgWalkTime,
          mandatoryCost: totalMandatoryCost,
          optionalCostMin: slotsOptionalMin,
          optionalCostMax: slotsOptionalMax,
          whyRecommended: whyRecList,
          slots,
          memberTravels: memberTravelsForPlan,
          // Stage 2 metadata — surfaces the archetype behind the plan so eval
          // and downstream UI can label "this is a Family Day Out" etc.
          archetypeKey: getActiveArchetypeMeta(templateIdx)?.key ?? null,
          archetypeFamily: getActiveArchetypeMeta(templateIdx)?.family ?? null,
          archetypeLabel: getActiveArchetypeMeta(templateIdx)?.label ?? null,
        };
      };

      const itinerary = await buildItineraryData();
      draftItineraries.push(itinerary);
    }
  };

  await buildPass(false);

  // Aim for ≥12 usable candidates before we cluster. 12 gives the picker room
  // to select 2 truly-distinct representatives across ≥4 experience shapes.
  if (draftItineraries.length < 12) {
    console.warn(`Only ${draftItineraries.length} plans generated. Running second pass allowing shared venues...`);
    await buildPass(true);
  }

  const outingHourMatch = (groupData.outingTime ?? '').match(/^(\d{1,2}):(\d{2})/);
  const outingHour = outingHourMatch ? parseInt(outingHourMatch[1], 10) : undefined;

  // Stage 5: constraint system. Filter DRAFT candidates first — invalid
  // plans never reach the scorer or clusterer.
  const validationCtx = {
    requiredPreferences: planningContext.requiredPreferences,
    outingHour,
    budget: lowestBudget && lowestBudget > 0 ? lowestBudget : undefined,
  };
  const {
    valid: validCandidates,
    enforcedConstraints,
    relaxedConstraints,
  } = filterValidCandidates(draftItineraries, validationCtx, 2);
  if (relaxedConstraints.length > 0) {
    console.warn(`[PLANNER] constraint relaxation triggered — dropped: ${relaxedConstraints.join(', ')} (enforced: ${enforcedConstraints.join(', ')})`);
  }

  const scoringCtx = {
    preferredCategories: (preferredCategories || []).map(c => c.toUpperCase()),
    zoneLowestBudget: lowestBudget || 1500,
    outingHour,
  };
  validCandidates.forEach(p => {
    p.planLevelScore = scorePlanCandidate(p, scoringCtx);
  });

  // Cluster the valid candidates only. Scoring differentiates within a
  // constraint-satisfying set — it is NOT trying to make bad plans better.
  const finalPlans = clusterAndPickRepresentatives(validCandidates, 2);
  finalPlans.forEach((it, idx) => { it.planIndex = idx + 1; });

  console.log(`[PLANNER] candidates ${draftItineraries.length} → valid ${validCandidates.length} → clustered → returning ${finalPlans.length}`,
    finalPlans.map(p => ({
      key: p.archetypeKey,
      zone: p.name,
      shape: (p.slots ?? []).map((s: any) => (s.category ?? '').toUpperCase()).join('→'),
      score: (p.planLevelScore ?? 0).toFixed(3),
    }))
  );

  // Bump venue-usage counter ONLY for venues that survived diversification.
  for (const plan of finalPlans) {
    for (const s of plan.slots ?? []) {
      const id = s.venueId ?? s.experienceId;
      if (id) bumpVenueUsage(String(id));
    }
  }

  if (finalPlans.length < 4) {
    console.warn(`[PLANNER ENGINE DIAGNOSTICS] Only ${finalPlans.length} database plans generated for group ${groupData.id}. Rejections:`, engineRejections.slice(0, 30));
  }

  return finalPlans;
}

/**
 * Fetch the minimum inputs needed to derive a stable cache key WITHOUT
 * paying the cost of a full planner run. We reuse the two data sources
 * already accessible in both the D1 / local paths — group + members +
 * locations + budget summary — and stop.
 *
 * Returns null if the group is not found (which means the inner path will
 * throw with a friendlier error).
 */
async function peekCacheInputs(
  userId: string,
  _groupId: string,
  options: string[],
  authContext?: { clerkId?: string; ip?: string; email?: string }
): Promise<import('./itineraryCache').CacheKeyInputs | null> {
  try {
    const groupId = _groupId;
    const { isHangoutApiConfigured, hangoutApi } = await import('../cloudflare/hangoutApi');
    let groupData: any;
    let members: any[] = [];
    let locations: any[] = [];
    let budgetSummary: any;

    if (isHangoutApiConfigured()) {
      let clerkId = authContext?.clerkId;
      if (!clerkId) {
        const { userRepository } = await import('../repositories/user.repository');
        const userRecord = await userRepository.findById(userId);
        if (!userRecord) return null;
        clerkId = userRecord.clerkId;
      }
      const res = await hangoutApi<any>(`/groups/${groupId}?clerkId=${encodeURIComponent(clerkId)}`);
      if (!res.success) return null;
      groupData = res.data.group;
      members = res.data.members || [];
      locations = res.data.locations || [];
      budgetSummary = res.data.budgetSummary || {};
    } else {
      const { locationRepository } = await import('../repositories/location.repository');
      const { memberRepository } = await import('../repositories/member.repository');
      const group: any = await groupRepository.findById(groupId);
      if (!group) return null;
      groupData = group;
      members = await memberRepository.getMembersWithUserDetails(groupId) as any[];
      const locsRes = await locationRepository.getGroupLocations(groupId);
      locations = locsRes || [];
      const bs = await budgetRepository.getGroupBudgetSummary(groupId);
      budgetSummary = bs || {};
    }

    const presentUserIds = members.map(m => m.userId);
    const presentLocations = locations.filter(l => presentUserIds.includes(l.userId));
    if (presentLocations.length === 0) return null;

    const vibes: string[] = [];
    try {
      if (groupData?.vibes) {
        const parsed = JSON.parse(groupData.vibes);
        if (Array.isArray(parsed)) vibes.push(...parsed);
      }
    } catch {}

    return {
      groupId,
      groupType: groupData?.groupType ?? 'CUSTOM',
      memberLocations: presentLocations.map(l => ({ lat: l.lat, lng: l.lng })),
      outingTime: groupData?.outingTime ?? null,
      outingDate: groupData?.outingDate ?? null,
      budget: budgetSummary?.min ?? 1000,
      preferredCategories: [],       // resolved from users' favouriteActivities in inner path — see note
      requiredPreferences: Array.isArray(groupData?.requiredPreferences) ? groupData.requiredPreferences : [],
      vibes,
      options,
      intent: groupData?.outingIntent ?? null,
    };
  } catch (err: any) {
    console.warn('[peekCacheInputs] failed:', err?.message ?? err);
    return null;
  }
}

export const plannerService = {
  /**
   * Public entry point. Wraps the expensive `_generatePlanUncached`
   * implementation with:
   *   - request context (AsyncLocalStorage) so all instrumentation
   *     downstream sees the same userId / groupId / requestId
   *   - per-user / per-group / per-IP rate limiting
   *   - deterministic itinerary cache (skip regeneration for identical
   *     input tuples within TTL)
   *   - single-flight coalescing (concurrent identical requests share one
   *     underlying computation)
   *
   * The plan shape returned is IDENTICAL to the uncached path — no UX
   * surface changes.
   */
  async generatePlan(
    userId: string,
    groupId: string,
    options: string[] = [],
    authContext?: { clerkId?: string; ip?: string; email?: string }
  ): Promise<{ success: boolean; plans: PlanWithSlots[] }> {
    const { runWithPlannerContext, plannerLog, PLANNER_VERSION } = await import('../observability/plannerContext');
    const { checkRateLimit, rateLimitMessage } = await import('./rateLimit');
    const { computeCacheKey, lookupCache, storeCache } = await import('./itineraryCache');
    const { runCoalesced } = await import('./inflightRegistry');
    const { recordCost, bumpDailyRollup } = await import('./costLedger');

    const requestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : require('crypto').randomUUID();

    return runWithPlannerContext(
      {
        userId,
        groupId,
        ip: authContext?.ip,
        requestId,
        startedAtMs: Date.now(),
        costCentsAccumulated: 0,
        cacheHit: false,
        coalesced: false,
      },
      async () => {
        plannerLog({ event: 'GENERATION_START', operation: 'PLAN_GENERATE' });

        // 1. Rate limit — fail fast BEFORE any DB or AI work. Admin emails
        //    bypass all limits (see src/lib/auth/adminEmails.ts).
        const rl = await checkRateLimit({
          operation: 'PLAN_GENERATE',
          userId,
          groupId,
          ip: authContext?.ip,
          userEmail: authContext?.email,
        });
        if (!rl.allowed && rl.hit) {
          throw new ValidationError(rateLimitMessage(rl.hit));
        }

        // 2. Load minimal inputs needed for cache key. Reuse whatever the
        //    inner path fetches — we duplicate a lightweight peek here.
        let cacheKey: string | null = null;
        let cacheInputs: any = null;
        try {
          cacheInputs = await peekCacheInputs(userId, groupId, options, authContext);
          if (cacheInputs) {
            cacheKey = computeCacheKey(cacheInputs);

            // 3. Cache lookup. If we have a fresh hit, verify the plans still
            //    exist in the DB — otherwise the row is stale. In D1 mode
            //    read plans via the worker; locally hit the repository.
            const hit = await lookupCache<PlanWithSlots[]>(cacheKey);
            if (hit.hit) {
              const { isHangoutApiConfigured, hangoutApi } = await import('../cloudflare/hangoutApi');
              let persistedPlans: PlanWithSlots[] = [];
              if (isHangoutApiConfigured()) {
                try {
                  const res = await hangoutApi<any>(`/groups/${groupId}/plans`);
                  if (res?.success && Array.isArray(res.data)) persistedPlans = res.data;
                } catch (err: any) {
                  console.warn('[PLANNER] cache-hit plan fetch failed:', err?.message ?? err);
                }
              } else {
                persistedPlans = await planRepository.getPlansForGroup(groupId);
              }
              const stillValid = persistedPlans.length > 0
                && hit.planIds.every(id => persistedPlans.some(p => p.id === id));
              if (stillValid) {
                recordCost({
                  operation: 'CACHE_SAVED',
                  provider: 'INTERNAL',
                  units: 1,
                  costCents: hit.estimatedCostCents,
                  cacheHit: true,
                  userId,
                  groupId,
                  metadata: { generationTimeMsSaved: hit.generationTimeMs, cacheKey },
                });
                await bumpDailyRollup({
                  subjectKind: 'GLOBAL', subjectId: '',
                  plansGenerated: 0, cacheHits: 1,
                  costCents: 0,
                  timeSavedMs: hit.generationTimeMs,
                });
                await bumpDailyRollup({
                  subjectKind: 'USER', subjectId: userId,
                  cacheHits: 1, timeSavedMs: hit.generationTimeMs,
                });
                await bumpDailyRollup({
                  subjectKind: 'GROUP', subjectId: groupId,
                  cacheHits: 1, timeSavedMs: hit.generationTimeMs,
                });
                plannerLog({
                  event: 'GENERATION_END',
                  operation: 'PLAN_GENERATE',
                  durationMs: 0, // cache hit
                  cacheHit: true,
                });
                return { success: true, plans: persistedPlans };
              }
              // Stale — invalidate the row and fall through to regenerate.
              plannerLog({ event: 'CACHE_STALE', key: cacheKey, operation: 'PLAN_GENERATE' });
            }
          }
        } catch (err: any) {
          console.warn('[plannerService] cache peek failed, falling through to generation:', err?.message ?? err);
        }

        // 4. Single-flight coalesce identical requests. Inside the coalesced
        //    function we run the full uncached generation.
        const coalescedKey = cacheKey ?? `NO_KEY:${groupId}:${userId}`;
        const startMs = Date.now();
        const result = await runCoalesced({
          key: coalescedKey,
          operation: 'PLAN_GENERATE',
          subjectId: groupId,
          fn: () => this._generatePlanUncached(userId, groupId, options, authContext),
          onCrossProcessCoalesce: async () => {
            if (!cacheKey) return null;
            const hit = await lookupCache<PlanWithSlots[]>(cacheKey);
            if (!hit.hit) return null;
            const { isHangoutApiConfigured, hangoutApi } = await import('../cloudflare/hangoutApi');
            let persistedPlans: PlanWithSlots[] = [];
            if (isHangoutApiConfigured()) {
              try {
                const res = await hangoutApi<any>(`/groups/${groupId}/plans`);
                if (res?.success && Array.isArray(res.data)) persistedPlans = res.data;
              } catch {}
            } else {
              persistedPlans = await planRepository.getPlansForGroup(groupId);
            }
            if (persistedPlans.length > 0 && hit.planIds.every(id => persistedPlans.some(p => p.id === id))) {
              return { success: true, plans: persistedPlans };
            }
            return null;
          },
        });
        const generationTimeMs = Date.now() - startMs;

        // 5. Store cache (best-effort). Use accumulated cost from the ledger
        //    context so cache hits later credit the correct savings figure.
        if (cacheKey && result.success && result.plans.length > 0) {
          const ctx = (await import('../observability/plannerContext')).currentPlannerContext();
          void storeCache({
            key: cacheKey,
            groupId,
            payload: result.plans,
            planIds: result.plans.map(p => p.id),
            generationTimeMs,
            estimatedCostCents: ctx?.costCentsAccumulated ?? 0,
          });
        }

        recordCost({
          operation: 'PLAN_GENERATE',
          provider: 'INTERNAL',
          units: result.plans?.length ?? 0,
          costCents: 0, // real cost was captured by nested AI / places calls
          userId,
          groupId,
        });
        await bumpDailyRollup({
          subjectKind: 'GLOBAL', subjectId: '',
          plansGenerated: result.plans?.length ?? 0,
          cacheMisses: 1,
        });
        await bumpDailyRollup({
          subjectKind: 'USER', subjectId: userId,
          plansGenerated: result.plans?.length ?? 0,
          cacheMisses: 1,
        });
        await bumpDailyRollup({
          subjectKind: 'GROUP', subjectId: groupId,
          plansGenerated: result.plans?.length ?? 0,
          cacheMisses: 1,
        });

        plannerLog({
          event: 'GENERATION_END',
          operation: 'PLAN_GENERATE',
          durationMs: generationTimeMs,
          cacheHit: false,
        });
        return result;
      }
    );
  },

  async _generatePlanUncached(
    userId: string,
    groupId: string,
    options: string[] = [],
    authContext?: { clerkId?: string; ip?: string; email?: string }
  ): Promise<{ success: boolean; plans: PlanWithSlots[] }> {
    const { isHangoutApiConfigured, hangoutApi } = await import('../cloudflare/hangoutApi');
    if (isHangoutApiConfigured()) {
      let clerkId = authContext?.clerkId;
      if (!clerkId) {
        const { userRepository } = await import('../repositories/user.repository');
        const userRecord = await userRepository.findById(userId);
        if (!userRecord) {
          throw new Error('User not found in local database');
        }
        clerkId = userRecord.clerkId;
      }
      const detailsRes = await hangoutApi<any>(`/groups/${groupId}?clerkId=${encodeURIComponent(clerkId)}`);
      if (!detailsRes.success) {
        throw new Error(detailsRes.error?.message || 'Failed to fetch group details from D1');
      }

      const { group: groupData, members, budgetSummary, locations, currentUser } = detailsRes.data;
      if (currentUser.role !== 'ADMIN') {
        throw new ForbiddenError('Only the group admin can generate itineraries.');
      }

      if (!['COLLECTING_MEMBERS', 'COLLECTING_DETAILS', 'READY_TO_GENERATE', 'VOTING'].includes(groupData.status)) {
        throw new ValidationError(`Group is not in a state ready for itinerary generation (current status: ${groupData.status}).`);
      }

      // Collect present members and their locations, with resilient fallbacks
      const presentMembers = members;
      const presentUserIds = presentMembers.map((m: any) => m.userId);
      const presentLocations = locations.filter((loc: any) => presentUserIds.includes(loc.userId));

      // If some members have no locations, assign the calculated group midpoint/centroid of members who have locations, or Mumbai centroid if none.
      const submittedLocations = presentLocations.filter((loc: any) => loc.lat !== 19.0760 || loc.lng !== 72.8777);
      let defaultLat = 19.0760;
      let defaultLng = 72.8777;
      if (submittedLocations.length > 0) {
        defaultLat = submittedLocations.reduce((sum: number, l: any) => sum + l.lat, 0) / submittedLocations.length;
        defaultLng = submittedLocations.reduce((sum: number, l: any) => sum + l.lng, 0) / submittedLocations.length;
      }

      if (presentLocations.length < presentMembers.length) {
        console.warn(`[PLANNER] ${presentMembers.length - presentLocations.length} member(s) missing locations. Assigning calculated group midpoint/centroid.`);
        for (const m of presentMembers) {
          if (!presentLocations.find((l: any) => l.userId === m.userId)) {
            presentLocations.push({ userId: m.userId, lat: defaultLat, lng: defaultLng, locationName: 'Group Midpoint (default)' });
          }
        }
      }

      // Reject invalid coordinates instead of snapping
      for (const loc of presentLocations) {
        if (!validateCoordinates(loc.lat, loc.lng)) {
          throw new ValidationError(`Member location "${loc.locationName || 'Unknown'}" has coordinates (${loc.lat}, ${loc.lng}) which are outside the supported Mumbai, Navi Mumbai, and Thane region. Please re-enter a valid location.`);
        }
      }

      const minBudget = budgetSummary.min || 1000;
      const avgBudget = budgetSummary.avg || 2000;
      const maxBudget = budgetSummary.max || 5000;

      // Fetch preferred activities from users in parallel
      const favoriteCategories: string[] = [];
      try {
        const userResponses = await Promise.all(
          presentMembers.map((m: any) =>
            hangoutApi<any>(`/users?clerkId=${m.clerkId}`).catch((err: any) => {
              console.error(`Error fetching user activities for ${m.clerkId}:`, err);
              return null;
            })
          )
        );
        for (const userRes of userResponses) {
          if (userRes && userRes.success && userRes.data?.favoriteActivities) {
            try {
              const acts = JSON.parse(userRes.data.favoriteActivities);
              if (Array.isArray(acts)) {
                favoriteCategories.push(...acts);
              }
            } catch (_e) {}
          }
        }
      } catch (err) {
        console.error('Error in parallel activities fetch:', err);
      }
      const uniquePreferredCategories = Array.from(new Set(favoriteCategories));

      const aggregatedVibes = new Set<string>();
      for (const m of presentMembers) {
        if (m.vibes) {
          try {
            const memberVibes = JSON.parse(m.vibes);
            if (Array.isArray(memberVibes)) {
              memberVibes.forEach(v => aggregatedVibes.add(v));
            }
          } catch (_e) {}
        }
      }
      const vibes = Array.from(aggregatedVibes);
      if (vibes.length === 0 && groupData.vibes) {
        try {
          const groupVibes = JSON.parse(groupData.vibes);
          if (Array.isArray(groupVibes)) {
            groupVibes.forEach(v => vibes.push(v));
          }
        } catch (_e) {}
      }

      const lowestBudget = minBudget;

      let draftPlans: any[] = [];
      try {
        draftPlans = await executePlanningEngine(
          groupData,
          presentMembers,
          budgetSummary,
          presentLocations,
          uniquePreferredCategories,
          vibes,
          [], // empty history
          lowestBudget,
          options
        );
      } catch (engineErr) {
        console.error('[PLANNER] executePlanningEngine failed, falling back to hardcoded plans:', engineErr);
      }

      // Pad to exactly 4 plans if fewer are generated
      if (draftPlans.length < 4) {
        console.warn(`[PLANNER] Only ${draftPlans.length} plans generated by engine. Padding with fallback itineraries.`);
        const mLocs = presentLocations.map((l: any) => ({ lat: l.lat, lng: l.lng }));
        const budget = lowestBudget || budgetSummary?.min || 1000;
        const existingIndexes = new Set(draftPlans.map(d => d.planIndex));

        const usedPlaceIds = new Set<string>();
        draftPlans.forEach(plan => {
          plan.slots?.forEach((slot: any) => {
            if (slot.venueId) usedPlaceIds.add(slot.venueId);
            if (slot.experienceId) usedPlaceIds.add(slot.experienceId);
          });
        });

        for (let fi = 1; fi <= 4; fi++) {
          if (!existingIndexes.has(fi)) {
            console.log(`[FALLBACK GENERATION] Plan index ${fi} is generated as a fallback itinerary because the DB engine only produced ${draftPlans.length} plans under budget constraint of â‚¹${budget}. Excluding used place IDs: ${Array.from(usedPlaceIds).join(', ')}`);
            const fallbackPlan = await buildFallbackItineraryData(fi, groupData, presentMembers, presentLocations, mLocs, budget, usedPlaceIds, options);
            fallbackPlan.planIndex = fi;
            draftPlans.push(fallbackPlan);
          }
        }
      }

      const context: ItineraryPromptContext = {
        groupName: groupData.name,
        groupType: groupData.groupType as any,
        vibes,
        memberCount: presentMembers.length,
        groupMinBudget: minBudget,
        groupAvgBudget: avgBudget,
        groupMaxBudget: maxBudget,
        preferredCategories: uniquePreferredCategories,
        midpointAddress: draftPlans[0]?.name || 'Mumbai Central',
        venues: [],
        experiences: [],
        outingDate: groupData.outingDate,
        outingTime: groupData.outingTime,
      };

      const groqResult = await generateItineraries(draftPlans, context);

      const dbPlans: any[] = [];
      const dbSlots: any[] = [];
      const dbMemberTravels: any[] = [];

      const randomUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return require('crypto').randomUUID();
      };

      groqResult.itineraries.forEach((it, idx) => {
        const draft = draftPlans.find(d => d.planIndex === it.id || d.id === it.id) || draftPlans[idx % draftPlans.length];
        const planId = draft.id;

        dbPlans.push({
          id: planId,
          groupId,
          planIndex: idx + 1,
          name: it.name,
          tagline: it.tagline,
          meetupZone: draft.name,
          budgetTier: it.budgetTier || draft.budgetTier,
          totalEstimatedCostPerHead: it.totalEstimatedCostPerHead || draft.totalEstimatedCostPerHead,
          totalDurationMinutes: it.totalDurationMinutes || draft.totalDurationMinutes,
          score: draft.score,

          experienceScore: draft.experienceScore,
          travelScore: draft.travelScore,
          budgetScore: draft.budgetScore,
          fairnessScore: draft.fairnessScore,
          popularityScore: draft.popularityScore,
          groupTypeMatchScore: draft.groupTypeMatchScore,
          vibeMatchScore: draft.vibeMatchScore,
          compositeScore: draft.compositeScore,

          avgTrainTime: draft.avgTrainTime,
          avgCabTime: draft.avgCabTime,
          avgTrainCost: draft.avgTrainCost,
          avgCabCost: draft.avgCabCost,
          longestTravelTime: draft.longestTravelTime,
          shortestTravelTime: draft.shortestTravelTime,
          travelFairnessScore: draft.travelFairnessScore,

          mandatoryCost: draft.mandatoryCost,
          optionalCostMin: draft.optionalCostMin,
          optionalCostMax: draft.optionalCostMax,
          whyRecommended: JSON.stringify(it.whyRecommended || draft.whyRecommended),
          avgAutoTime: draft.avgAutoTime,
          avgAutoCost: draft.avgAutoCost,
          avgTotalTime: draft.avgTotalTime,
          avgTotalCost: draft.avgTotalCost,
          avgWalkTime: draft.avgWalkTime,
          archetypeKey: draft.archetypeKey ?? null,
          archetypeLabel: draft.archetypeLabel ?? null,
          generatedAt: new Date().toISOString()
        });

        it.slots.forEach((s: any) => {
          const draftSlot = draft.slots.find((ds: any) => ds.order === s.order) || draft.slots[s.order - 1];
          const finalVenueId = (draftSlot?.venueId && !draftSlot.venueId.startsWith('fb_') && !draftSlot.venueId.startsWith('fallback_')) ? draftSlot.venueId : null;
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: s.order,
            venueId: finalVenueId,
            experienceId: draftSlot?.experienceId || null,
            venueName: s.name,
            name: s.name,
            category: s.category,
            arrivalTime: s.arrivalTime,
            durationMinutes: s.durationMinutes,
            travelToNextMinutes: s.travelToNextMinutes || null,
            estimatedCostPerHead: s.estimatedCostPerHead,
            note: s.note,
            travelToNextCost: draftSlot?.travelToNextCost || null,
            imageUrl: s.imageUrl || draftSlot?.imageUrl || null,
            link: s.link || draftSlot?.link || null
          });
        });

        draft.memberTravels.forEach((mt: any) => {
          dbMemberTravels.push({
            id: mt.id,
            planId,
            userId: mt.userId,
            trainTime: mt.trainTime,
            trainCost: mt.trainCost,
            cabTime: mt.autoTime,
            cabCost: mt.autoCost,
            walkTime: mt.walkingTime,
            autoTime: mt.autoTime,
            autoCost: mt.autoCost,
            totalTime: mt.totalTime,
            totalCost: mt.totalCost
          });
        });
      });

      const dbVenues: any[] = [];
      const seenVenueIds = new Set<string>();
      draftPlans.forEach((draft: any) => {
        draft.slots.forEach((ds: any) => {
          if (ds.venueId && !ds.venueId.startsWith('fb_') && !ds.venueId.startsWith('fallback_') && !seenVenueIds.has(ds.venueId)) {
            seenVenueIds.add(ds.venueId);
            dbVenues.push({
              id: ds.venueId,
              name: ds.name,
              address: ds.address || '',
              lat: ds.lat,
              lng: ds.lng,
              rating: ds.rating ?? null,
              category: ds.category || '',
              mandatoryCost: ds.mandatoryCost || 0,
              optionalCostMin: ds.optionalCostMin || 0,
              optionalCostMax: ds.optionalCostMax || 0,
              imageUrl: ds.imageUrl || null,
              link: ds.link || null
            });
          }
        });
      });

      let saveSucceeded = false;
      try {
        const saveRes = await hangoutApi<any>(`/groups/${groupId}/plans`, {
          method: 'POST',
          body: {
            plans: dbPlans,
            slots: dbSlots,
            memberTravels: dbMemberTravels,
            venues: dbVenues,
            generationOptions: options,
          },
        });
        saveSucceeded = saveRes.success;
        if (!saveRes.success) {
          console.error('[PLANNER] D1 save failed:', saveRes.error?.message || 'Unknown error');
        }
      } catch (saveErr) {
        console.error('[PLANNER] D1 save threw an error, returning plans anyway:', saveErr);
      }

      // If save succeeded, fetch the persisted plans; otherwise return the in-memory plans directly
      if (saveSucceeded) {
        try {
          const savedPlans = await hangoutApi<any>(`/groups/${groupId}/plans`);
          if (savedPlans.success && savedPlans.data) {
            return { success: true, plans: savedPlans.data };
          }
        } catch (fetchErr) {
          console.error('[PLANNER] Failed to fetch saved plans from D1, returning in-memory plans:', fetchErr);
        }
      }

      // Return in-memory plans as a fallback
      const inMemoryPlans = dbPlans.map((plan: any, idx: number) => {
        const planSlotsList = dbSlots.filter((s: any) => s.planId === plan.id);
        const planMemberTravels = dbMemberTravels.filter((mt: any) => mt.planId === plan.id);
        return {
          ...plan,
          slots: planSlotsList,
          memberTravelMetrics: planMemberTravels,
        };
      });
      return { success: true, plans: inMemoryPlans };
    }

    // 1. Verify group exists
    const group = await groupRepository.findById(groupId);
    if (!group || group.status === 'DELETED') {
      throw new NotFoundError('The specified planning group does not exist.');
    }

    // 2. Verify caller is ADMIN
    const callerMember = await memberRepository.getMember(groupId, userId);
    if (!callerMember || callerMember.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin can generate itineraries.');
    }

    // 3. Verify group status is ready for generation
    if (!['COLLECTING_MEMBERS', 'COLLECTING_DETAILS', 'READY_TO_GENERATE', 'VOTING'].includes(group.status)) {
      throw new ValidationError(`Group is not in a state ready for itinerary generation (current status: ${group.status}).`);
    }

    // 4. Fetch members
    const members = await memberRepository.getMembersWithUserDetails(groupId);
    if (members.length === 0) {
      throw new NotFoundError('No members found in this group.');
    }

    const presentMembers = members;
    const presentUserIds = presentMembers.map(m => m.userId);

    // 5. Check submitted locations â€” resilient fallbacks
    const locations = await locationRepository.getGroupLocations(groupId);
    const presentLocations: any[] = locations.filter(l => presentUserIds.includes(l.userId));

    // If some members have no locations, assign the calculated group midpoint/centroid of members who have locations, or Mumbai centroid if none.
    const submittedLocations = presentLocations.filter((loc: any) => loc.lat !== 19.0760 || loc.lng !== 72.8777);
    let defaultLat = 19.0760;
    let defaultLng = 72.8777;
    if (submittedLocations.length > 0) {
      defaultLat = submittedLocations.reduce((sum: number, l: any) => sum + l.lat, 0) / submittedLocations.length;
      defaultLng = submittedLocations.reduce((sum: number, l: any) => sum + l.lng, 0) / submittedLocations.length;
    }

    if (presentLocations.length < presentMembers.length) {
      console.warn(`[PLANNER-LOCAL] ${presentMembers.length - presentLocations.length} member(s) missing locations. Assigning calculated group midpoint/centroid.`);
      for (const m of presentMembers) {
        if (!presentLocations.find((l: any) => l.userId === m.userId)) {
          presentLocations.push({ userId: m.userId, lat: defaultLat, lng: defaultLng, locationName: 'Group Midpoint (default)' });
        }
      }
    }

    // Reject invalid coordinates instead of snapping
    for (const loc of presentLocations) {
      if (!validateCoordinates(loc.lat, loc.lng)) {
        throw new ValidationError(`Member location "${loc.locationName || 'Unknown'}" has coordinates (${loc.lat}, ${loc.lng}) which are outside the supported Mumbai, Navi Mumbai, and Thane region. Please re-enter a valid location.`);
      }
    }

    // 6. Fetch budgets list (fallback to default 2000 if none)
    const budgetsList = await budgetRepository.getGroupBudgets(groupId);
    const presentBudgetsList = budgetsList.filter(b => presentUserIds.includes(b.userId));
    const presentBudgets = presentBudgetsList.map(b => b.maxBudget);
    
    if (presentBudgets.length === 0) {
      presentBudgets.push(2000);
    }

    const presentBudgetSummary = {
      min: Math.min(...presentBudgets),
      avg: Math.round(presentBudgets.reduce((sum, b) => sum + b, 0) / presentBudgets.length),
      max: Math.max(...presentBudgets),
      submittedCount: presentBudgets.length,
      totalMembers: presentMembers.length,
    };

    // Set group status to GENERATING
    validateStatusTransition(group.status, 'GENERATING');
    await groupRepository.update(groupId, {
      status: 'GENERATING',
    });

    try {
      // 7. Gather preferences and vibes
      const favoriteCategories: string[] = [];
      try {
        const userResults = await Promise.all(presentMembers.map(m => dbSelectUserActivities(m.userId)));
        for (const user of userResults) {
          if (user && user.favoriteActivities) {
            try {
              const acts = JSON.parse(user.favoriteActivities);
              if (Array.isArray(acts)) {
                favoriteCategories.push(...acts);
              }
            } catch (_e) {
              const acts = user.favoriteActivities.split(',').map((s: string) => s.trim());
              favoriteCategories.push(...acts);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching user activities in parallel:', err);
      }
      const uniquePreferredCategories = Array.from(new Set(favoriteCategories));

      // Collect vibes
      const aggregatedVibes = new Set<string>();
      for (const m of presentMembers) {
        if (m.vibes) {
          try {
            const memberVibes = JSON.parse(m.vibes);
            if (Array.isArray(memberVibes)) {
              memberVibes.forEach(v => aggregatedVibes.add(v));
            }
          } catch (_e) {}
        }
      }
      const vibes = Array.from(aggregatedVibes);
      if (vibes.length === 0 && group.vibes) {
        try {
          const groupVibes = JSON.parse(group.vibes);
          if (Array.isArray(groupVibes)) {
            groupVibes.forEach(v => vibes.push(v));
          }
        } catch (_e) {}
      }

      const firstMemberId = presentMembers[0].userId;
      const historyEntries = await historyRepository.getHistoryForUser(firstMemberId);

      const lowestBudget = presentBudgetSummary.min;

      let draftPlans: any[] = [];
      try {
        draftPlans = await executePlanningEngine(
          group,
          presentMembers,
          presentBudgetSummary,
          presentLocations,
          uniquePreferredCategories,
          vibes,
          historyEntries,
          lowestBudget,
          options
        );
      } catch (engineErr) {
        console.error('[PLANNER-LOCAL] executePlanningEngine failed, falling back to hardcoded plans:', engineErr);
      }

      // Pad to exactly 4 plans if fewer are generated
      if (draftPlans.length < 4) {
        console.warn(`[PLANNER-LOCAL] Only ${draftPlans.length} plans generated by engine. Padding with fallback itineraries.`);
        const mLocs = presentLocations.map((l: any) => ({ lat: l.lat, lng: l.lng }));
        const budget = lowestBudget || presentBudgetSummary?.min || 1000;
        const existingIndexes = new Set(draftPlans.map(d => d.planIndex));

        const usedPlaceIds = new Set<string>();
        draftPlans.forEach(plan => {
          plan.slots?.forEach((slot: any) => {
            if (slot.venueId) usedPlaceIds.add(slot.venueId);
            if (slot.experienceId) usedPlaceIds.add(slot.experienceId);
          });
        });

        for (let fi = 1; fi <= 4; fi++) {
          if (!existingIndexes.has(fi)) {
            console.log(`[FALLBACK GENERATION] Plan index ${fi} is generated as a fallback itinerary because the DB engine only produced ${draftPlans.length} plans under budget constraint of â‚¹${budget}. Excluding used place IDs: ${Array.from(usedPlaceIds).join(', ')}`);
            const fallbackPlan = await buildFallbackItineraryData(fi, group, presentMembers, presentLocations, mLocs, budget, usedPlaceIds, options);
            fallbackPlan.planIndex = fi;
            draftPlans.push(fallbackPlan);
          }
        }
      }

      const context: ItineraryPromptContext = {
        groupName: group.name,
        groupType: group.groupType as any,
        vibes,
        memberCount: presentMembers.length,
        groupMinBudget: presentBudgetSummary.min,
        groupAvgBudget: presentBudgetSummary.avg,
        groupMaxBudget: presentBudgetSummary.max,
        preferredCategories: uniquePreferredCategories,
        midpointAddress: draftPlans[0]?.name || 'Mumbai Central',
        venues: [],
        experiences: [],
        outingDate: group.outingDate,
        outingTime: group.outingTime,
      };

      const groqResult = await generateItineraries(draftPlans, context);

      const dbPlans: any[] = [];
      const dbSlots: any[] = [];
      const dbMemberTravels: any[] = [];

      const randomUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return require('crypto').randomUUID();
      };

      groqResult.itineraries.forEach((it, idx) => {
        const draft = draftPlans.find(d => d.planIndex === it.id || d.id === it.id) || draftPlans[idx % draftPlans.length];
        const planId = draft.id;

        dbPlans.push({
          id: planId,
          groupId,
          planIndex: idx + 1,
          name: it.name,
          tagline: it.tagline,
          meetupZone: draft.name,
          budgetTier: it.budgetTier || draft.budgetTier,
          totalEstimatedCostPerHead: it.totalEstimatedCostPerHead || draft.totalEstimatedCostPerHead,
          totalDurationMinutes: it.totalDurationMinutes || draft.totalDurationMinutes,
          score: draft.score,

          experienceScore: draft.experienceScore,
          travelScore: draft.travelScore,
          budgetScore: draft.budgetScore,
          fairnessScore: draft.fairnessScore,
          popularityScore: draft.popularityScore,
          groupTypeMatchScore: draft.groupTypeMatchScore,
          vibeMatchScore: draft.vibeMatchScore,
          compositeScore: draft.compositeScore,

          avgTrainTime: draft.avgTrainTime,
          avgCabTime: draft.avgCabTime,
          avgTrainCost: draft.avgTrainCost,
          avgCabCost: draft.avgCabCost,
          longestTravelTime: draft.longestTravelTime,
          shortestTravelTime: draft.shortestTravelTime,
          travelFairnessScore: draft.travelFairnessScore,

          mandatoryCost: draft.mandatoryCost,
          optionalCostMin: draft.optionalCostMin,
          optionalCostMax: draft.optionalCostMax,
          whyRecommended: JSON.stringify(it.whyRecommended || draft.whyRecommended),
          avgAutoTime: draft.avgAutoTime,
          avgAutoCost: draft.avgAutoCost,
          avgTotalTime: draft.avgTotalTime,
          avgTotalCost: draft.avgTotalCost,
          avgWalkTime: draft.avgWalkTime,
          archetypeKey: draft.archetypeKey ?? null,
          archetypeLabel: draft.archetypeLabel ?? null,
          generatedAt: new Date().toISOString()
        });

        it.slots.forEach((s: any) => {
          const draftSlot = draft.slots.find((ds: any) => ds.order === s.order) || draft.slots[s.order - 1];
          const finalVenueId = (draftSlot?.venueId && !draftSlot.venueId.startsWith('fb_') && !draftSlot.venueId.startsWith('fallback_')) ? draftSlot.venueId : null;
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: s.order,
            venueId: finalVenueId,
            experienceId: draftSlot?.experienceId || null,
            venueName: s.name,
            name: s.name,
            category: s.category,
            arrivalTime: s.arrivalTime,
            durationMinutes: s.durationMinutes,
            travelToNextMinutes: s.travelToNextMinutes || null,
            estimatedCostPerHead: s.estimatedCostPerHead,
            note: s.note,
            travelToNextCost: draftSlot?.travelToNextCost || null,
            imageUrl: s.imageUrl || draftSlot?.imageUrl || null,
            link: s.link || draftSlot?.link || null
          });
        });

        draft.memberTravels.forEach((mt: any) => {
          dbMemberTravels.push({
            id: mt.id,
            planId,
            userId: mt.userId,
            trainTime: mt.trainTime,
            trainCost: mt.trainCost,
            cabTime: mt.autoTime,
            cabCost: mt.autoCost,
            walkTime: mt.walkingTime,
            autoTime: mt.autoTime,
            autoCost: mt.autoCost,
            totalTime: mt.totalTime,
            totalCost: mt.totalCost
          });
        });
      });

      // 12. Transactional Release: delete old plans, write new ones, set status to VOTING
      validateStatusTransition('GENERATING', 'VOTING');
      
      await safeTransaction(async (tx: any) => {
        // Delete old member travel metrics first
        const persistedPlans = await tx.select().from(plans).where(eq(plans.groupId, groupId));
        if (persistedPlans.length > 0) {
          const planIds = persistedPlans.map((p: any) => p.id);
          await tx
            .delete(memberTravelMetrics)
            .where(sql`plan_id IN (${sql.join(planIds.map((id: any) => sql`${id}`), sql`, `)})`);
        }
        await tx.delete(plans).where(eq(plans.groupId, groupId));

        if (dbPlans.length > 0) {
          await tx.insert(plans).values(dbPlans);
        }
        if (dbSlots.length > 0) {
          await tx.insert(planSlots).values(dbSlots);

          // Increment timesGenerated locally for the places
          for (const slot of dbSlots) {
            if (slot.venueId && !slot.venueId.startsWith('fb_') && !slot.venueId.startsWith('fallback_')) {
              await tx.run(sql`
                INSERT INTO ranking_metrics (place_id, times_generated, times_viewed, times_voted, times_won)
                VALUES (${slot.venueId}, 1, 0, 0, 0)
                ON CONFLICT(place_id)
                DO UPDATE SET times_generated = times_generated + 1
              `);
            }
          }
        }
        if (dbMemberTravels.length > 0) {
          await tx.insert(memberTravelMetrics).values(dbMemberTravels);
        }
        
        await tx
          .update(groups)
          .set({
            status: 'VOTING',
            votingStatus: 'OPEN',
            timerExpiresAt: null,
            generationOptions: JSON.stringify(options),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(groups.id, groupId));
      });

      const persistedPlans = await planRepository.getPlansForGroup(groupId);

      return {
        success: true,
        plans: persistedPlans,
      };
    } catch (err) {
      await groupRepository.update(groupId, {
        status: 'READY_TO_GENERATE',
      });
      throw err;
    }
  },
};

async function dbSelectUserActivities(userId: string) {
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}
