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

function isHangoutWorthyCandidate(candidate: { name: string; category: string; rating?: number | null; reviewCount?: number | null; address?: string | null; isFallback?: boolean; isExperience?: boolean; isZoneCurated?: boolean }) {
  if (candidate.isFallback || candidate.isExperience || candidate.isZoneCurated) return true;
  const category = candidate.category.toUpperCase();
  if (ROLE_ONLY_PLACE_CATEGORIES.has(category) || !SELECTABLE_PLACE_CATEGORIES.has(category)) return false;

  const rating = candidate.rating ?? null;
  const reviewCount = candidate.reviewCount ?? 0;
  const normalized = `${candidate.name} ${candidate.address ?? ''}`.toLowerCase();

  const strongSignal = hasAnyPattern(normalized, STRONG_HANGOUT_NAME_PATTERNS);
  if (hasAnyPattern(normalized, LOW_INTENT_CHAIN_PATTERNS)) return false;
  if (hasAnyPattern(normalized, WEAK_OR_NON_HANGOUT_PATTERNS) && !strongSignal) return false;
  const highlyReviewed = reviewCount >= 75;
  const strongRated = rating !== null && rating >= 4.3 && reviewCount >= 40;

  if (category === 'RESTAURANT') {
    if (hasAnyPattern(normalized, GENERIC_WEAK_FOOD_PATTERNS) && !strongSignal) return false;
    return strongSignal || highlyReviewed || strongRated;
  }

  if (category === 'PARK') {
    const scenicSignal = hasAnyPattern(normalized, ['promenade', 'beach', 'lake', 'fort', 'national park', 'nature park', 'waterfront', 'viewpoint', 'central park', 'jio world garden']);
    return scenicSignal && (reviewCount >= 25 || rating === null || rating >= 4.0);
  }

  if (category === 'MALL') return strongSignal && reviewCount >= 100;
  if (category === 'CAFE' || category === 'DESSERT') return strongSignal || highlyReviewed || strongRated;

  return strongSignal || highlyReviewed || strongRated;
}

const DATE_ITINERARY_TEMPLATES: ItineraryTemplate[] = [
  { slot1: ['CAFE', 'RESTAURANT'], slot1Act: false, slot2: ['PARK', 'MUSEUM', 'ART_GALLERY'], slot2Act: true, slot3: ['DESSERT', 'CAFE'], slot3Act: false },
  { slot1: ['CAFE', 'RESTAURANT'], slot1Act: false, slot2: ['ART_GALLERY', 'MUSEUM', 'POTTERY', 'WORKSHOP'], slot2Act: true, slot3: ['DESSERT'], slot3Act: false },
  { slot1: ['PARK', 'MUSEUM', 'ART_GALLERY'], slot1Act: true, slot2: ['CAFE', 'RESTAURANT'], slot2Act: false, slot3: ['DESSERT', 'CAFE'], slot3Act: false },
  { slot1: ['ART_GALLERY', 'MUSEUM', 'POTTERY', 'WORKSHOP'], slot1Act: true, slot2: ['CAFE', 'RESTAURANT'], slot2Act: false, slot3: ['DESSERT'], slot3Act: false },
];

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

    let mandatoryCost = place.estimatedCostPerHead;
    let optionalCostMin = 0;
    let optionalCostMax = 0;

    if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase())) {
      const est = place.estimatedCostPerHead;
      mandatoryCost = Math.round(est * 0.4);
      optionalCostMin = Math.round(est * 0.6);
      optionalCostMax = Math.round(est * 1.5);
    } else if (place.isExperience) {
      mandatoryCost = place.estimatedCostPerHead;
      optionalCostMin = 0;
      optionalCostMax = 0;
    } else {
      const est = place.estimatedCostPerHead;
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
      estimatedCostPerHead: place.estimatedCostPerHead,
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
    const slotDist = getHaversineDistance({ lat: current.lat, lng: current.lng }, { lat: next.lat, lng: next.lng });

    const travelMin = Math.max(15, Math.round(slotDist * 4.0) + 5);
    const travelCost = Math.round(23 + Math.max(0, slotDist - 1.5) * 15);

    current.travelToNextMinutes = travelMin;
    (current as any).travelToNextCost = Math.ceil(travelCost / Math.min(3, presentMembers.length));
    // Propagate corrected arrival time to the next slot
    next.arrivalTime = addMinutesToTimeString(current.arrivalTime, current.durationMinutes + travelMin);
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

  return {
    id: planId,
    groupId: groupData.id,
    planIndex,
    name: activeZoneObj.name,
    tagline,
    budgetTier,
    totalEstimatedCostPerHead: totalMandatoryCost + slotsOptionalMin,
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

  // Apply generation frequency penalty to encourage diversity
  if (metrics && metrics.timesGenerated > 0) {
    const generationPenalty = Math.min(0.25, metrics.timesGenerated * 0.02);
    score = score - generationPenalty;
  }

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

  // Prioritize major transit hubs (Dadar, Bandra, Kurla, Andheri, Vashi, Thane) so they are selected first and skip adjacent clustered minor stations
  const MAJOR_HUBS = ['Dadar', 'Bandra', 'Kurla', 'Andheri', 'Vashi', 'Thane'];
  shuffledAllZones.sort((a, b) => {
    const aIsHub = MAJOR_HUBS.includes(a.name);
    const bIsHub = MAJOR_HUBS.includes(b.name);
    if (aIsHub && !bIsHub) return -1;
    if (!aIsHub && bIsHub) return 1;
    return 0;
  });

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

  const buildPass = async (allowSharedVenues = false) => {
    const shuffledZones = [...candidateZones];
    for (let idx = shuffledZones.length - 1; idx > 0; idx--) {
      const j = Math.floor(Math.random() * (idx + 1));
      [shuffledZones[idx], shuffledZones[j]] = [shuffledZones[j], shuffledZones[idx]];
    }

    // Shuffle the templates pool to guarantee diversity
    const templatesPool = [...ITINERARY_TEMPLATES];
    for (let j = templatesPool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [templatesPool[j], templatesPool[k]] = [templatesPool[k], templatesPool[j]];
    }

    const getActiveTemplate = (idx: number): ItineraryTemplate => {
      const groupSize = presentMembers.length;
      const isLargeGroup = groupSize >= 5;

      const groupPreferredCats = (preferredCategories || []).map(c => c.toUpperCase()).filter(c => SELECTABLE_PLACE_CATEGORIES.has(c));

      const isDate = String(groupData.groupType ?? '').toUpperCase() === 'DATE';
      if (isDate) {
        if (isMoreActivities) {
          const actCats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS', 'POTTERY', 'PAINTING', 'WORKSHOP', 'MUSEUM'];
          const preferredActCats = groupPreferredCats.filter(c => actCats.includes(c));
          const finalActCats = preferredActCats.length > 0 ? preferredActCats : actCats;
          return {
            slot1: finalActCats,
            slot1Act: true,
            slot2: ['RESTAURANT', 'CAFE'],
            slot2Act: false,
            slot3: ['DESSERT', 'CAFE'],
            slot3Act: false
          };
        }
        if (isMoreCreative) {
          const creativeCats = ['POTTERY', 'WORKSHOP', 'ART_GALLERY', 'PAINTING', 'MUSEUM'];
          const preferredCreative = groupPreferredCats.filter(c => creativeCats.includes(c));
          const finalCreative = preferredCreative.length > 0 ? preferredCreative : creativeCats;
          return {
            slot1: finalCreative,
            slot1Act: true,
            slot2: ['CAFE', 'RESTAURANT'],
            slot2Act: false,
            slot3: ['DESSERT'],
            slot3Act: false
          };
        }
        if (isMoreFood) {
          return {
            slot1: ['CAFE'],
            slot1Act: false,
            slot2: ['RESTAURANT'],
            slot2Act: false,
            slot3: ['DESSERT', 'CAFE'],
            slot3Act: false
          };
        }
        return DATE_ITINERARY_TEMPLATES[idx % DATE_ITINERARY_TEMPLATES.length];
      }
      if (isMoreActivities) {
        const actCats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS', 'POTTERY', 'PAINTING', 'WORKSHOP', 'MUSEUM'];
        const preferredActCats = groupPreferredCats.filter(c => actCats.includes(c));
        const finalActCats = preferredActCats.length > 0 ? preferredActCats : actCats;

        return {
          slot1: finalActCats,
          slot1Act: true,
          slot2: ['RESTAURANT', 'CAFE'],
          slot2Act: false,
          slot3: finalActCats,
          slot3Act: true
        };
      }
      if (isMoreCreative) {
        const creativeCats = ['POTTERY', 'WORKSHOP', 'ART_GALLERY', 'PAINTING', 'MUSEUM'];
        const preferredCreative = groupPreferredCats.filter(c => creativeCats.includes(c));
        const finalCreative = preferredCreative.length > 0 ? preferredCreative : creativeCats;

        return {
          slot1: finalCreative,
          slot1Act: true,
          slot2: ['CAFE', 'RESTAURANT'],
          slot2Act: false,
          slot3: finalCreative,
          slot3Act: true
        };
      }
      if (isMoreFood) {
        return {
          slot1: ['CAFE'],
          slot1Act: false,
          slot2: ['RESTAURANT'],
          slot2Act: false,
          slot3: ['DESSERT', 'CAFE'],
          slot3Act: false
        };
      }
      if (isLargeGroup) {
        const groupInteractiveCats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS', 'WORKSHOP', 'POTTERY', 'PAINTING'];
        const preferredInteractive = groupPreferredCats.filter(c => groupInteractiveCats.includes(c));
        const actCats = preferredInteractive.length > 0 ? preferredInteractive : groupInteractiveCats;

        if (idx % 2 === 0) {
          return {
            slot1: actCats,
            slot1Act: true,
            slot2: ['RESTAURANT', 'MALL'],
            slot2Act: false,
            slot3: ['DESSERT', 'PARK', 'MALL'],
            slot3Act: false
          };
        } else {
          return {
            slot1: ['CAFE', 'MALL'],
            slot1Act: false,
            slot2: actCats,
            slot2Act: true,
            slot3: ['RESTAURANT'],
            slot3Act: false
          };
        }
      }
      if (groupPreferredCats.length > 0) {
        const baseTemplate = templatesPool[idx % templatesPool.length];
        const newTemplate = { ...baseTemplate };
        const activityCats = ['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'MUSEUM', 'SPORTS', 'POTTERY', 'PAINTING', 'WORKSHOP', 'MOVIE', 'ART_GALLERY'];
        const preferredActivities = groupPreferredCats.filter(c => activityCats.includes(c));
        const preferredFood = groupPreferredCats.filter(c => !activityCats.includes(c));

        if (newTemplate.slot1Act && preferredActivities.length > 0) {
          newTemplate.slot1 = preferredActivities;
        } else if (!newTemplate.slot1Act && preferredFood.length > 0) {
          newTemplate.slot1 = preferredFood;
        }

        if (newTemplate.slot2Act && preferredActivities.length > 0) {
          newTemplate.slot2 = preferredActivities;
        } else if (!newTemplate.slot2Act && preferredFood.length > 0) {
          newTemplate.slot2 = preferredFood;
        }

        if (newTemplate.slot3Act && preferredActivities.length > 0) {
          newTemplate.slot3 = preferredActivities;
        } else if (!newTemplate.slot3Act && preferredFood.length > 0) {
          newTemplate.slot3 = preferredFood;
        }

        return newTemplate;
      }

      const isChillVibe = vibes && vibes.some(v => String(v).toUpperCase() === 'CHILL');
      const baseTemplate = templatesPool[idx % templatesPool.length];
      const isBoring = !baseTemplate.slot1Act && !baseTemplate.slot2Act && !baseTemplate.slot3Act;

      if (isBoring && !isChillVibe) {
        return {
          slot1: ['ARCADE', 'BOWLING', 'MUSEUM', 'PARK'],
          slot1Act: true,
          slot2: ['RESTAURANT', 'CAFE'],
          slot2Act: false,
          slot3: ['DESSERT', 'CAFE'],
          slot3Act: false
        };
      }

      return baseTemplate;
    };

    for (let i = 0; i < 4; i++) {
      if (draftItineraries.length >= 4) break;

      const budgetTier = tiers[i];
      const planIndex = i + 1;

      if (draftItineraries.some(it => it.planIndex === planIndex)) continue;

      const zoneObj = shuffledZones[i % shuffledZones.length];
      const zoneData = zonesData.find(zd => zd.zone.name === zoneObj.name) || zonesData[0];

      const filterAndUnused = (list: any[]) => allowSharedVenues ? list : list.filter(c => !usedPlaceIds.has(c.id));
      let candidatesPool = filterAndUnused(zoneData.candidates);

      const template = getActiveTemplate(planIndex - 1);
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

        const getSlotCost = (place: PlaceCandidate) => {
          return getMandatoryCost(place) + getOptionalCostMin(place);
        };

        // 1. Try to find a match of the preferred categories under budget constraint
        const budgetMatches = matches.filter(c => getSlotCost(c) <= remainingBudget);

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
            fallbackPool = candidatesPool.filter(c => !['CAFE', 'RESTAURANT', 'DESSERT'].includes(c.category.toUpperCase()));
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

      let isTwoSlots = false; // Always generate 3-slot itineraries
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
        
        if (place.id && !place.id.startsWith('fb_') && !place.id.startsWith('fallback_') && !place.isExperience) {
          try {
            let actualPlaceId = place.id;
            if (place.id.startsWith('GOOGLE_')) {
              actualPlaceId = place.id.slice(7);
            } else if (place.id.startsWith('OLA_')) {
              actualPlaceId = place.id.slice(4);
            }
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
          estimatedCostPerHead: place.estimatedCostPerHead,
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
          const slotDist = getHaversineDistance({ lat: current.lat, lng: current.lng }, { lat: next.lat, lng: next.lng });

          const travelMin = Math.max(15, Math.round(slotDist * 4.0) + 5);
          const travelCost = Math.round(23 + Math.max(0, slotDist - 1.5) * 15);

          current.travelToNextMinutes = travelMin;
          (current as any).travelToNextCost = Math.ceil(travelCost / Math.min(3, presentMembers.length));
          // Propagate corrected arrival time to the next slot
          next.arrivalTime = addMinutesToTimeString(current.arrivalTime, current.durationMinutes + travelMin);
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
          memberTravels: memberTravelsForPlan
        };
      };

      const itinerary = await buildItineraryData();
      draftItineraries.push(itinerary);
    }
  };

  await buildPass(false);

  if (draftItineraries.length < 4) {
    console.warn(`Only ${draftItineraries.length} plans generated. Running second pass allowing shared venues...`);
    await buildPass(true);
  }

  draftItineraries.sort((a, b) => b.score - a.score);
  draftItineraries.forEach((it, idx) => {
    it.planIndex = idx + 1;
  });

  if (draftItineraries.length < 4) {
    console.warn(`[PLANNER ENGINE DIAGNOSTICS] Only ${draftItineraries.length} database plans generated for group ${groupData.id}. Rejections:`, engineRejections.slice(0, 30));
  }

  return draftItineraries;
}

export const plannerService = {
  async generatePlan(
    userId: string,
    groupId: string,
    options: string[] = [],
    authContext?: { clerkId?: string }
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
