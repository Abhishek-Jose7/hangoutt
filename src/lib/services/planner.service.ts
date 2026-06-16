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
import { selectCandidateZones, getHaversineDistance, LatLng } from '../algorithms/zoneSelection';
import { db, safeTransaction } from '../db/client';
import { users, groups, plans, planSlots, memberTravelMetrics, zones, places, placeCategories, placeCosts, placeScores, experiences, zoneFallbacks, rankingMetrics, featuredExperiences } from '../db/schema';
import { eq, sql, and, between } from 'drizzle-orm';
import { InsufficientLocationsError, NotFoundError, ValidationError, ForbiddenError } from '../errors';
import { ItineraryPromptContext } from '../types/planner.types';
import { validateStatusTransition } from './group.service';
import { getVenueImageUrl, getVenueDetails, searchTextVenues } from '../maps/places';

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
}

function validateCoordinates(lat: number, lng: number): boolean {
  return lat >= 18.8 && lat <= 19.5 && lng >= 72.6 && lng <= 73.3;
}

const MUMBAI_FALLBACK_CANDIDATES: PlaceCandidate[] = [
  // Activities / Museums (PRIMARY)
  {
    id: 'fallback_palacio',
    name: 'The Game Palacio',
    category: 'BOWLING',
    rating: 4.6,
    lat: 19.0596,
    lng: 72.8295,
    estimatedCostPerHead: 1000,
    address: 'Bandra West, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_smaaash',
    name: 'Smaaash',
    category: 'ARCADE',
    rating: 4.4,
    lat: 19.0034,
    lng: 72.8276,
    estimatedCostPerHead: 800,
    address: 'Lower Parel, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_museum_solutions',
    name: 'Museum of Solutions',
    category: 'MUSEUM',
    rating: 4.8,
    lat: 19.0080,
    lng: 72.8250,
    estimatedCostPerHead: 500,
    address: 'Lower Parel, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_pottery_lab',
    name: 'Bandra Pottery Lab',
    category: 'POTTERY',
    rating: 4.7,
    lat: 19.0500,
    lng: 72.8300,
    estimatedCostPerHead: 1200,
    address: 'Bandra West, Mumbai',
    openNow: true,
    isExperience: true,
    isFallback: true
  },
  {
    id: 'fallback_snow_world',
    name: 'Snow World Mumbai',
    category: 'SPORTS',
    rating: 4.2,
    lat: 19.0607,
    lng: 72.8826,
    estimatedCostPerHead: 600,
    address: 'Kurla West, Mumbai',
    openNow: true,
    isFallback: true
  },

  // Cafes / Restaurants (FOOD)
  {
    id: 'fallback_prithvi_cafe',
    name: 'Prithvi Cafe',
    category: 'CAFE',
    rating: 4.6,
    lat: 19.1075,
    lng: 72.8263,
    estimatedCostPerHead: 300,
    address: 'Juhu, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_grandmamas',
    name: "Grandmama's Cafe",
    category: 'CAFE',
    rating: 4.3,
    lat: 19.0178,
    lng: 72.8478,
    estimatedCostPerHead: 600,
    address: 'Dadar East, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_pizza_bay',
    name: 'Pizza By The Bay',
    category: 'RESTAURANT',
    rating: 4.5,
    lat: 18.9345,
    lng: 72.8272,
    estimatedCostPerHead: 1000,
    address: 'Churchgate, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_joeys',
    name: "Joey's Pizza",
    category: 'RESTAURANT',
    rating: 4.5,
    lat: 19.1136,
    lng: 72.8697,
    estimatedCostPerHead: 500,
    address: 'Andheri West, Mumbai',
    openNow: true,
    isFallback: true
  },

  // Parks / Scenic (OPTIONAL)
  {
    id: 'fallback_shivaji_park',
    name: 'Shivaji Park',
    category: 'PARK',
    rating: 4.5,
    lat: 19.0268,
    lng: 72.8415,
    estimatedCostPerHead: 0,
    address: 'Dadar West, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_marine_drive',
    name: 'Marine Drive Promenade',
    category: 'PARK',
    rating: 4.8,
    lat: 18.9448,
    lng: 72.8236,
    estimatedCostPerHead: 0,
    address: 'Marine Lines, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_carter_road',
    name: 'Carter Road Promenade',
    category: 'PARK',
    rating: 4.6,
    lat: 19.0690,
    lng: 72.8360,
    estimatedCostPerHead: 0,
    address: 'Bandra West, Mumbai',
    openNow: true,
    isFallback: true
  },
  {
    id: 'fallback_le15',
    name: 'Le15 Patisserie',
    category: 'DESSERT',
    rating: 4.4,
    lat: 19.0596,
    lng: 72.8295,
    estimatedCostPerHead: 300,
    address: 'Bandra West, Mumbai',
    openNow: true,
    isFallback: true
  }
];

function getFallbackSlotsForPlan(planIndex: number): PlaceCandidate[] {
  if (planIndex === 1) {
    return [
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_shivaji_park')!,
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_prithvi_cafe')!,
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_marine_drive')!,
    ];
  } else if (planIndex === 3) {
    return [
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_palacio')!,
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_pizza_bay')!,
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_smaaash')!,
    ];
  } else if (planIndex === 4) {
    return [
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_pottery_lab')!,
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_joeys')!,
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_carter_road')!,
    ];
  } else {
    return [
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_museum_solutions')!,
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_grandmamas')!,
      MUMBAI_FALLBACK_CANDIDATES.find(c => c.id === 'fallback_le15')!,
    ];
  }
}

function buildFallbackItineraryData(
  planIndex: number,
  groupData: any,
  presentMembers: any[],
  presentLocations: any[]
) {
  const budgetTiers = ['BUDGET_FRIENDLY', 'BALANCED', 'PREMIUM', 'BALANCED'] as const;
  const budgetTier = budgetTiers[(planIndex - 1) % 4];
  const fallbackZones = [
    { name: 'Bandra', lat: 19.0596, lng: 72.8295 },
    { name: 'Dadar', lat: 19.0178, lng: 72.8478 },
    { name: 'Kurla', lat: 19.0607, lng: 72.8826 },
    { name: 'Ghatkopar', lat: 19.0860, lng: 72.9082 },
  ];
  const zoneObj = fallbackZones[(planIndex - 1) % fallbackZones.length];
  const selectedPlaces = getFallbackSlotsForPlan(planIndex);
  
  const slots = selectedPlaces.map((place, slotIdx) => {
    let arrivalTime = '11:00 AM';
    let duration = 90;
    if (slotIdx === 0) {
      arrivalTime = groupData.outingTime || '11:00 AM';
      duration = 120;
    } else if (slotIdx === 1) {
      arrivalTime = addMinutesToTimeString(groupData.outingTime || '11:00 AM', 120 + 15);
      duration = 90;
    } else {
      arrivalTime = addMinutesToTimeString(groupData.outingTime || '11:00 AM', 120 + 15 + 90 + 15);
      duration = 60;
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
      imageUrl: place.imageUrl || null,
      link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`,
      note: `Enjoy a wonderful outing at ${place.name} matching the ${groupData.groupType?.toLowerCase() || 'friends'} vibe.`,
      lat: place.lat,
      lng: place.lng
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
  let travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30.0);

  const slotsMandatoryCost = slots.reduce((sum, s) => sum + s.mandatoryCost, 0);
  const slotsOptionalMin = slots.reduce((sum, s) => sum + s.optionalCostMin, 0);
  const slotsOptionalMax = slots.reduce((sum, s) => sum + s.optionalCostMax, 0);

  const totalMandatoryCost = slotsMandatoryCost + avgTotalCost;

  const planId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

  return {
    id: planId,
    groupId: groupData.id,
    planIndex,
    name: zoneObj.name,
    tagline: `A wonderful ${budgetTier.toLowerCase().replace('_', ' ')} day out in ${zoneObj.name}.`,
    budgetTier,
    totalEstimatedCostPerHead: totalMandatoryCost + slotsOptionalMin,
    totalDurationMinutes: slots.reduce((sum, s) => sum + s.durationMinutes, 0) + (slots[0].travelToNextMinutes || 0) + (slots[1].travelToNextMinutes || 0),
    score: 0.85,

    experienceScore: 0.85,
    travelScore: 0.85,
    budgetScore: 0.85,
    fairnessScore: travelFairnessScore,
    popularityScore: 0.90,
    groupTypeMatchScore: 1.0,
    vibeMatchScore: 1.0,
    compositeScore: 0.85,

    avgTrainTime: 20,
    avgCabTime: 25,
    avgTrainCost: 15,
    avgCabCost: 150,
    longestTravelTime,
    shortestTravelTime,
    travelFairnessScore,

    avgAutoTime: 25,
    avgAutoCost: 150,
    avgTotalTime,
    avgTotalCost,
    avgWalkTime: 10,
    mandatoryCost: totalMandatoryCost,
    optionalCostMin: slotsOptionalMin,
    optionalCostMax: slotsOptionalMax,
    whyRecommended: [
      "Everyone can afford this plan",
      `Average travel time ${avgTotalTime} minutes`,
      `Matches ${groupData.groupType?.toLowerCase() || 'friends'} vibe`,
      "Highest conversation score"
    ],
    slots,
    memberTravels: memberTravelsForPlan
  };
}

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

function scorePlaceCandidate(
  place: PlaceCandidate,
  groupType: string,
  vibes: string[],
  maxBudget: number,
  lowestBudget: number,
  avgMemberCoords: LatLng,
  options: string[] = []
): number {
  // 1. Experience score based on category weights
  const weights = CATEGORY_WEIGHTS[groupType.toUpperCase()] || CATEGORY_WEIGHTS.CUSTOM;
  const weight = weights[place.category.toUpperCase()] || 5;
  const experienceScore = weight / 10.0;

  // 2. Budget score
  let budgetScore = 0.0;
  if (place.estimatedCostPerHead <= lowestBudget) {
    budgetScore = 1.0;
  } else if (place.estimatedCostPerHead <= maxBudget) {
    const range = maxBudget - lowestBudget;
    budgetScore = range > 0 ? 1.0 - ((place.estimatedCostPerHead - lowestBudget) / range) : 1.0;
  }
  budgetScore = Math.min(1.0, Math.max(0.0, budgetScore));

  // 3. Travel score from average member coordinate
  const dist = getHaversineDistance(avgMemberCoords, { lat: place.lat, lng: place.lng });
  const distPenaltyMultiplier = options.includes('Less Travel') ? 3.0 : 1.0;
  const travelScore = Math.max(0.0, 1.0 - ((dist * distPenaltyMultiplier) / 15.0)); // 15km scale

  // 4. Rating score
  const ratingScore = Math.min(1.0, Math.max(0.0, (place.rating || 4.0) / 5.0));

  // 5. Vibe score
  const vibeMap: Record<string, string[]> = {
    CHILL: ['PARK', 'CAFE', 'DESSERT'],
    CREATIVE: ['POTTERY', 'PAINTING', 'WORKSHOP', 'MUSEUM', 'ART_GALLERY'],
    FOODIE: ['RESTAURANT', 'DESSERT', 'CAFE'],
    CULTURAL: ['MUSEUM', 'ART_GALLERY'],
    COMPETITIVE: ['ARCADE', 'BOWLING', 'ESCAPE_ROOM'],
    ADVENTUROUS: ['ESCAPE_ROOM'],
    ROMANTIC: ['CAFE', 'RESTAURANT', 'PARK'],
    LUXURY: ['RESTAURANT', 'ART_GALLERY'],
    BUDGET: ['PARK', 'MUSEUM', 'CAFE']
  };

  let matchCount = 0;
  for (const vibe of vibes) {
    const cats = vibeMap[vibe.toUpperCase()];
    if (cats && cats.includes(place.category.toUpperCase())) {
      matchCount++;
    }
  }
  const vibeScore = Math.min(1.0, matchCount * 0.5);

  // 6. Conversation score boost (especially for Date group types)
  const conversationScore = CONVERSATION_SCORES[place.category.toUpperCase()] || 5;
  const conversationBoost = (conversationScore / 10.0) * (groupType.toUpperCase() === 'DATE' ? 2.5 : 1.0);

  // 7. Romantic boost if More Romantic option is chosen
  let romanticBoost = 0.0;
  if (options.includes('More Romantic') && ['CAFE', 'RESTAURANT', 'LIVE_MUSIC', 'SCENIC_EXPERIENCE'].includes(place.category.toUpperCase())) {
    romanticBoost = 1.0;
  }

  // 8. Activities vs Food boost if options are chosen
  let typeBoost = 0.0;
  const isFoodCategory = ['CAFE', 'RESTAURANT', 'DESSERT'].includes(place.category.toUpperCase());
  if (options.includes('More Food') && isFoodCategory) {
    typeBoost = 1.0;
  } else if (options.includes('More Activities') && !isFoodCategory) {
    typeBoost = 1.0;
  }

  return (
    experienceScore * 2.0 +
    budgetScore * 1.5 +
    travelScore * 1.5 +
    ratingScore * 1.0 +
    vibeScore * 1.0 +
    conversationBoost * 1.5 +
    romanticBoost * 1.0 +
    typeBoost * 1.0
  );
}

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
  let finalMin = totalMin % 60;

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
  const allFallbacks = await db.select().from(zoneFallbacks);
  if (allFallbacks.length === 0) return [];

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
      isFallback: true
    }));
  }

  const allZones = await db.select().from(zones);
  
  let nearestZoneName = '';
  let minDist = Infinity;

  for (const zone of allZones) {
    const hasFb = Object.keys(fallbacksByZone).some(
      k => k.toLowerCase() === zone.name.toLowerCase()
    );
    if (!hasFb) continue;

    const dist = getHaversineDistance({ lat: zoneLat, lng: zoneLng }, { lat: zone.centerLat, lng: zone.centerLng });
    if (dist < minDist) {
      minDist = dist;
      nearestZoneName = zone.name;
    }
  }

  const nearestZoneKey = Object.keys(fallbacksByZone).find(
    k => k.toLowerCase() === nearestZoneName.toLowerCase()
  );
  if (nearestZoneKey && fallbacksByZone[nearestZoneKey].length > 0) {
    console.log(`Zone "${zoneName}" has no fallbacks. Using fallbacks from nearest zone: "${nearestZoneName}" (${minDist.toFixed(1)}km away)`);
    return fallbacksByZone[nearestZoneKey].map((fb: any) => ({
      id: fb.id,
      name: fb.name,
      category: fb.category,
      rating: fb.rating || 4.5,
      lat: fb.lat,
      lng: fb.lng,
      estimatedCostPerHead: fb.estimatedCostPerHead,
      address: fb.address || '',
      openNow: true,
      isFallback: true
    }));
  }

  return [];
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

  // Calculate freshness using decay formula Math.exp(-daysSinceDiscovery / 14) based on firstSeen
  const firstSeenDate = place.firstSeen ? new Date(place.firstSeen).getTime() : Date.now() - 60 * 24 * 60 * 60 * 1000;
  const daysSinceDiscovery = Math.max(0, (Date.now() - firstSeenDate) / (24 * 60 * 60 * 1000));
  const freshness = Math.exp(-daysSinceDiscovery / 14);

  // Calculate uniqueness score (Interestingness)
  const nameLower = (place.name || '').toLowerCase();
  const chains = [
    'mcdonald',
    'starbucks',
    'subway',
    'domino',
    'kfc',
    'burger king',
    'pizza hut',
    'baskin robbins',
    'dunkin',
    'cafe coffee day',
    'ccd',
    'pizza express',
    'barbeque nation',
    'taco bell',
    'coffee bean',
    'third wave',
    'blue tokai'
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

  // Adjusted weights totaling 1.0 (35% Category, 20% Budget, 15% Popularity component, 15% Freshness, 10% Travel, 5% Rating)
  let score = 0.35 * categoryMatch +
              0.20 * budgetMatch +
              0.15 * popularityComponent +
              0.15 * freshness +
              0.10 * travelFairness +
              0.05 * ratingScore;
  
  // Apply boostFactor
  const boost = typeof place.boostFactor === 'number' ? place.boostFactor : 1.0;
  score = score * boost;

  // Apply a 1.25 boost multiplier to candidates whose daysSinceDiscovery < 30 (Recently Discovered)
  if (daysSinceDiscovery < 30) {
    score = score * 1.25;
  }

  return score;
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
  const candidateZones = selectCandidateZones(memberCoords);

  const avgLat = memberCoords.reduce((sum, c) => sum + c.lat, 0) / memberCoords.length;
  const avgLng = memberCoords.reduce((sum, c) => sum + c.lng, 0) / memberCoords.length;
  const avgMemberCoords = { lat: avgLat, lng: avgLng };

  const logRejection = (name: string, reason: string) => {
    console.log(`[VENUE REJECTED] "${name}" | Reason: ${reason}`);
  };

  const isCheaper = options.includes('Cheaper');
  const isMoreIndoor = options.includes('More Indoor');
  const isLessTravel = options.includes('Less Travel');
  const isMoreActivities = options.includes('More Activities');
  const isMoreFood = options.includes('More Food');
  const isMoreCreative = options.includes('More Creative');

  let activeVibes = [...vibes];
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
      const maxBudget = budgetRecord ? budgetRecord.maxBudget : 2000;
      const travelIncluded = budgetRecord ? budgetRecord.travelIncluded : 1;

      const availableBudget = travelIncluded === 1 ? maxBudget - travelCost : maxBudget;

      return {
        userId: m.userId,
        availableBudget,
        travelCost
      };
    });

    const zoneLowestBudget = Math.min(...memberAvailableBudgets.map(m => m.availableBudget));

    const radiusKm = 5.0;
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
        firstSeen: places.firstSeen
      })
      .from(places)
      .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
      .innerJoin(placeCosts, eq(placeCosts.placeId, places.id))
      .where(
        and(
          between(places.lat, zone.lat - latDiff, zone.lat + latDiff),
          between(places.lng, zone.lng - lngDiff, zone.lng + lngDiff)
        )
      );

    const candidates: PlaceCandidate[] = [];

    dbPlaces.forEach((p: any) => {
      // Quality Gate: filter hidden places
      if (p.isHidden === 1) {
        logRejection(p.name, 'Hidden by admin curation');
        return;
      }

      const dist = getHaversineDistance({ lat: zone.lat, lng: zone.lng }, { lat: p.lat, lng: p.lng });
      if (dist <= radiusKm) {
        candidates.push({
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
          firstSeen: p.firstSeen
        } as any);
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

      const dist = getHaversineDistance({ lat: zone.lat, lng: zone.lng }, { lat: e.latitude, lng: e.longitude });
      const isFeatured = e.featuredId !== null;
      if (dist <= 10.0 || isFeatured) {
        candidates.push({
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
          mandatoryCost: e.ticketPrice,
          optionalCostMin: 0,
          optionalCostMax: 0,
          lastVerified: e.updatedAt,
          isFeatured: isFeatured ? 1 : 0,
          isHidden: 0,
          boostFactor: 1.0,
          firstSeen: e.firstSeen
        } as any);
      }
    });

    if (candidates.length < 5) {
      const fallbacks = await resolveZoneFallbacks(zone.name, zone.lat, zone.lng);
      candidates.push(...fallbacks);
    }

    const openCandidates = candidates.filter(c => {
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

      const maxLimit = isCheaper ? zoneLowestBudget * 0.8 : zoneLowestBudget;
      if (c.estimatedCostPerHead > maxLimit && !c.isFallback) {
        logRejection(c.name, `REJECTED | Reason: Budget (cost ₹${c.estimatedCostPerHead} exceeds cap ₹${Math.round(maxLimit)})`);
        return false;
      }

      const dist = getHaversineDistance(avgMemberCoords, { lat: c.lat, lng: c.lng });
      const maxDistance = isLessTravel ? 5 : 8;
      if (dist > maxDistance && !c.isFallback) {
        logRejection(c.name, `REJECTED | Reason: Too far (${dist.toFixed(1)}km exceeds allowed ${maxDistance}km)`);
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

      const score = scorePlaceCandidateRefactored(
        c,
        groupData.groupType,
        zoneLowestBudget,
        avgMemberCoords,
        metricsRecord,
        (c as any).lastVerified
      );

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
  const tiers = ['BUDGET_FRIENDLY', 'BALANCED', 'PREMIUM', 'BALANCED'] as const;

  const buildPass = async (allowSharedVenues = false) => {
    const shuffledZones = [...candidateZones];
    for (let idx = shuffledZones.length - 1; idx > 0; idx--) {
      const j = Math.floor(Math.random() * (idx + 1));
      [shuffledZones[idx], shuffledZones[j]] = [shuffledZones[j], shuffledZones[idx]];
    }

    for (let i = 0; i < 4; i++) {
      if (draftItineraries.length >= 4) break;

      const budgetTier = tiers[i];
      const planIndex = i + 1;

      if (draftItineraries.some(it => it.planIndex === planIndex)) continue;

      let zoneObj = shuffledZones[i % shuffledZones.length];
      let zoneData = zonesData.find(zd => zd.zone.name === zoneObj.name) || zonesData[0];

      const filterAndUnused = (list: any[]) => allowSharedVenues ? list : list.filter(c => !usedPlaceIds.has(c.id));
      let candidatesPool = filterAndUnused(zoneData.candidates);

      let slot1Cats: string[] = [];
      let slot1IsActivity = true;
      let slot2Cats: string[] = [];
      let slot2IsActivity = false;
      let slot3Cats: string[] = [];
      let slot3IsActivity = false;

      if (isMoreActivities) {
        slot1Cats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'MUSEUM', 'SPORTS', 'POTTERY', 'PAINTING'];
        slot1IsActivity = true;
        slot2Cats = ['CAFE', 'RESTAURANT'];
        slot2IsActivity = false;
        slot3Cats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'MUSEUM', 'SPORTS', 'POTTERY', 'PAINTING'];
        slot3IsActivity = true;
      } else if (isMoreCreative) {
        slot1Cats = ['POTTERY', 'WORKSHOP', 'ART_GALLERY', 'PAINTING'];
        slot1IsActivity = true;
        slot2Cats = ['CAFE', 'RESTAURANT'];
        slot2IsActivity = false;
        slot3Cats = ['POTTERY', 'WORKSHOP', 'ART_GALLERY', 'PAINTING'];
        slot3IsActivity = true;
      } else if (isMoreFood) {
        slot1Cats = ['CAFE'];
        slot1IsActivity = false;
        slot2Cats = ['RESTAURANT'];
        slot2IsActivity = false;
        slot3Cats = ['DESSERT', 'CAFE'];
        slot3IsActivity = false;
      } else {
        if (planIndex === 1) {
          slot1Cats = ['PARK', 'MUSEUM'];
          slot1IsActivity = true;
          slot2Cats = ['CAFE'];
          slot2IsActivity = false;
          slot3Cats = ['DESSERT', 'PARK'];
          slot3IsActivity = false;
        } else if (planIndex === 2) {
          slot1Cats = ['CAFE'];
          slot1IsActivity = false;
          slot2Cats = ['RESTAURANT'];
          slot2IsActivity = false;
          slot3Cats = ['DESSERT'];
          slot3IsActivity = false;
        } else if (planIndex === 3) {
          slot1Cats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS', 'MUSEUM'];
          slot1IsActivity = true;
          slot2Cats = ['RESTAURANT', 'CAFE'];
          slot2IsActivity = false;
          slot3Cats = ['BOWLING', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS', 'MUSEUM'];
          slot3IsActivity = true;
        } else {
          slot1Cats = ['POTTERY', 'WORKSHOP', 'ART_GALLERY', 'MUSEUM'];
          slot1IsActivity = true;
          slot2Cats = ['CAFE', 'RESTAURANT'];
          slot2IsActivity = false;
          slot3Cats = ['PARK', 'DESSERT', 'CAFE'];
          slot3IsActivity = false;
        }
      }

      const selectPlaceForSlot = (preferredCats: string[], isActivity: boolean) => {
        let matches = candidatesPool.filter(c => preferredCats.includes(c.category.toUpperCase()));
        if (matches.length === 0) {
          if (isActivity) {
            matches = candidatesPool.filter(c => !['CAFE', 'RESTAURANT', 'DESSERT'].includes(c.category.toUpperCase()));
          } else {
            matches = candidatesPool.filter(c => ['CAFE', 'RESTAURANT', 'DESSERT'].includes(c.category.toUpperCase()));
          }
        }
        if (matches.length === 0) return null;

        const top3 = matches.slice(0, 3);
        const rand = Math.random();
        if (top3.length === 1) {
          return top3[0];
        } else if (top3.length === 2) {
          return rand < 0.6 ? top3[0] : top3[1];
        } else {
          if (rand < 0.5) return top3[0];
          if (rand < 0.85) return top3[1];
          return top3[2];
        }
      };

      const slot1Place = selectPlaceForSlot(slot1Cats, slot1IsActivity);
      if (!slot1Place) continue;
      candidatesPool = candidatesPool.filter(c => c.id !== slot1Place.id);

      const slot2Place = selectPlaceForSlot(slot2Cats, slot2IsActivity);
      if (!slot2Place) continue;
      candidatesPool = candidatesPool.filter(c => c.id !== slot2Place.id);

      const slot3Place = selectPlaceForSlot(slot3Cats, slot3IsActivity);
      if (!slot3Place) continue;
      candidatesPool = candidatesPool.filter(c => c.id !== slot3Place.id);

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

      const m1 = getMandatoryCost(slot1Place);
      const m2 = getMandatoryCost(slot2Place);
      const m3 = getMandatoryCost(slot3Place);
      const totalMandatorySlotsCost = m1 + m2 + m3;

      const opt1 = getOptionalCostMin(slot1Place);
      const opt2 = getOptionalCostMin(slot2Place);
      const opt3 = getOptionalCostMin(slot3Place);
      const totalEstimatedSlotsCost = totalMandatorySlotsCost + opt1 + opt2 + opt3;

      if (totalEstimatedSlotsCost > zoneData.zoneLowestBudget) {
        logRejection(`Plan-${planIndex}`, `Total slots estimated cost (₹${totalEstimatedSlotsCost}) exceeds lowest member available budget (₹${Math.round(zoneData.zoneLowestBudget)})`);
        continue;
      }

      if (!allowSharedVenues) {
        usedPlaceIds.add(slot1Place.id);
        usedPlaceIds.add(slot2Place.id);
        usedPlaceIds.add(slot3Place.id);
      }

      const selectedPlaces = [slot1Place, slot2Place, slot3Place];
      
      const slotsPromises = selectedPlaces.map(async (place, slotIdx) => {
        let finalImg = place.imageUrl || null;
        let finalLink = place.sourceUrl || null;
        
        if (place.id && !place.id.startsWith('fb_') && !place.id.startsWith('fallback_')) {
          try {
            const details = await getVenueDetails(place.id.startsWith('OLA_') ? place.id.slice(4) : place.id);
            if (details && details.photos && details.photos.length > 0) {
              const photoRef = details.photos[0].photo_reference;
              if (photoRef) {
                const apiKey = process.env.OLA_MAPS_API_KEY;
                finalImg = `https://api.olamaps.io/places/v1/photo?photo_reference=${encodeURIComponent(photoRef)}&api_key=${apiKey}`;
              }
            }
            if (details && details.website) {
              finalLink = details.website;
            }
          } catch (err) {}
        }

        if (!finalImg) {
          finalImg = await getVenueImageUrl(place.name, city, place.category);
        }
        if (!finalLink) {
          finalLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`;
        }

        let arrivalTime = '11:00 AM';
        let duration = 90;
        if (slotIdx === 0) {
          arrivalTime = groupData.outingTime || '11:00 AM';
          duration = 120;
        } else if (slotIdx === 1) {
          arrivalTime = addMinutesToTimeString(groupData.outingTime || '11:00 AM', 120 + 15);
          duration = 90;
        } else {
          arrivalTime = addMinutesToTimeString(groupData.outingTime || '11:00 AM', 120 + 15 + 90 + 15);
          duration = 60;
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
          mandatoryCost: getMandatoryCost(place),
          optionalCostMin: getOptionalCostMin(place),
          optionalCostMax: getOptionalCostMax(place),
          imageUrl: finalImg,
          link: finalLink,
          note: `Enjoy a wonderful outing at ${place.name} matching the ${groupData.groupType.toLowerCase()} vibe.`,
          lat: place.lat,
          lng: place.lng
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
        let travelFairnessScore = stdDev <= 10 ? 1.0 : Math.max(0.0, 1.0 - (stdDev - 10) / 30.0);

        const slotsMandatoryCost = slots.reduce((sum, s) => sum + s.mandatoryCost, 0);
        const slotsOptionalMin = slots.reduce((sum, s) => sum + s.optionalCostMin, 0);
        const slotsOptionalMax = slots.reduce((sum, s) => sum + s.optionalCostMax, 0);

        const totalMandatoryCost = slotsMandatoryCost + avgTotalCost;

        const planId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : require('crypto').randomUUID();

        const slotsPopularity = slots.reduce((sum, s) => {
          const matched = zoneData.candidates.find(cand => cand.id === s.venueId || cand.id === s.experienceId);
          return sum + (matched?.score || 0.8);
        }, 0) / slots.length;

        const rating = 0.40 * (slotsPopularity) + 0.20 * (1.0 - (totalMandatoryCost / 2000)) + 0.20 * (travelFairnessScore) + 0.20 * (1.0);

        let planName = zoneObj.name;
        let tagline = `A wonderful day out in ${zoneObj.name}.`;
        
        if (planIndex === 1) {
          tagline = `A pocket-friendly day out exploring parks and cozy cafes in ${zoneObj.name}.`;
        } else if (planIndex === 2) {
          tagline = `A culinary journey with premium cafes, local eateries, and sweet desserts in ${zoneObj.name}.`;
        } else if (planIndex === 3) {
          tagline = `An exciting day featuring bowling, arcades, and active entertainment in ${zoneObj.name}.`;
        } else if (planIndex === 4) {
          tagline = `Discover pottery classes, art galleries, and cultural experiences in ${zoneObj.name}.`;
        }

        return {
          id: planId,
          groupId: groupData.id,
          planIndex,
          name: planName,
          tagline,
          budgetTier,
          totalEstimatedCostPerHead: totalMandatoryCost + slotsOptionalMin,
          totalDurationMinutes: slots.reduce((sum, s) => sum + s.durationMinutes, 0) + (slots[0].travelToNextMinutes || 0) + (slots[1].travelToNextMinutes || 0),
          score: rating,

          experienceScore: slotsPopularity,
          travelScore: travelFairnessScore,
          budgetScore: Math.max(0.0, 1.0 - (totalMandatoryCost / 2000)),
          fairnessScore: travelFairnessScore,
          popularityScore: slotsPopularity,
          groupTypeMatchScore: 1.0,
          vibeMatchScore: 1.0,
          compositeScore: rating,

          avgTrainTime: 20,
          avgCabTime: 25,
          avgTrainCost: 15,
          avgCabCost: 150,
          longestTravelTime,
          shortestTravelTime,
          travelFairnessScore,

          avgAutoTime: 25,
          avgAutoCost: 150,
          avgTotalTime,
          avgTotalCost,
          avgWalkTime: 10,
          mandatoryCost: totalMandatoryCost,
          optionalCostMin: slotsOptionalMin,
          optionalCostMax: slotsOptionalMax,
          whyRecommended: [
            totalMandatoryCost + slotsOptionalMin <= zoneData.zoneLowestBudget ? "Everyone can afford this plan" : "Fits budget preferences",
            `Average travel time ${avgTotalTime} minutes`,
            vibes && vibes.length > 0 ? `Matches ${vibes.join(' & ')} vibe` : "Matches Activities vibe",
            planIndex === 1 ? "Highest conversation score" : "Great venue variety"
          ],
          slots,
          memberTravels: memberTravelsForPlan
        };
      };

      const itinerary = await buildItineraryData();
      draftItineraries.push(itinerary);
    }
  };

  await buildPass(false);

  if (draftItineraries.length < 2) {
    console.warn("Fewer than 2 plans generated. Running second pass allowing shared venues...");
    await buildPass(true);
  }

  draftItineraries.sort((a, b) => b.score - a.score);
  draftItineraries.forEach((it, idx) => {
    it.planIndex = idx + 1;
  });

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
      let presentLocations = locations.filter((loc: any) => presentUserIds.includes(loc.userId));

      // If some members have no locations, assign them the Mumbai centroid instead of failing
      if (presentLocations.length < presentMembers.length) {
        console.warn(`[PLANNER] ${presentMembers.length - presentLocations.length} member(s) missing locations. Assigning Mumbai centroid as fallback.`);
        for (const m of presentMembers) {
          if (!presentLocations.find((l: any) => l.userId === m.userId)) {
            presentLocations.push({ userId: m.userId, lat: 19.0760, lng: 72.8777, locationName: 'Mumbai (default)' });
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

      // If the planning engine produced no plans, fall back to hardcoded itineraries
      if (draftPlans.length === 0) {
        console.warn('[PLANNER] No plans generated by engine. Using fallback itinerary builder.');
        for (let fi = 1; fi <= 3; fi++) {
          draftPlans.push(buildFallbackItineraryData(fi, groupData, presentMembers, presentLocations));
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
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: s.order,
            venueId: draftSlot?.venueId || null,
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

      let saveSucceeded = false;
      try {
        const saveRes = await hangoutApi<any>(`/groups/${groupId}/plans`, {
          method: 'POST',
          body: {
            plans: dbPlans,
            slots: dbSlots,
            memberTravels: dbMemberTravels,
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

    // 5. Check submitted locations — resilient fallbacks
    const locations = await locationRepository.getGroupLocations(groupId);
    const presentLocations: any[] = locations.filter(l => presentUserIds.includes(l.userId));

    // If some members have no locations, assign Mumbai centroid instead of failing
    if (presentLocations.length < presentMembers.length) {
      console.warn(`[PLANNER-LOCAL] ${presentMembers.length - presentLocations.length} member(s) missing locations. Assigning Mumbai centroid.`);
      for (const m of presentMembers) {
        if (!presentLocations.find((l: any) => l.userId === m.userId)) {
          presentLocations.push({ userId: m.userId, lat: 19.0760, lng: 72.8777, locationName: 'Mumbai (default)' });
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

      // If the planning engine produced no plans, fall back to hardcoded itineraries
      if (draftPlans.length === 0) {
        console.warn('[PLANNER-LOCAL] No plans generated by engine. Using fallback itinerary builder.');
        for (let fi = 1; fi <= 3; fi++) {
          draftPlans.push(buildFallbackItineraryData(fi, group, presentMembers, presentLocations));
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
          dbSlots.push({
            id: randomUUID(),
            planId,
            slotOrder: s.order,
            venueId: draftSlot?.venueId || null,
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
            if (slot.venueId && !slot.venueId.startsWith('fallback_')) {
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
