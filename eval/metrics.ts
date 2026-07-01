import type { Scenario } from './scenarios';
import { getVenueZone } from '../src/lib/services/planner.service';

export interface SlotMetrics {
  name: string;
  category: string;
  venueId: string | null;
  estimatedCostPerHead: number;
  durationMinutes: number;
  isFallback: boolean;
  rating: number | null;
  address?: string;
}

export interface PlanMetrics {
  planId: string;
  score: number;
  totalEstimatedCostPerHead: number;
  totalDurationMinutes: number;
  meetupZone: string;
  budgetTier: string;
  avgTravelTime: number;
  slots: SlotMetrics[];
}

export interface ItineraryMetrics {
  scenarioId: string;
  durationMs: number;
  planCount: number;
  isFallbackOnly: boolean;
  engineFallback: boolean;  // engine returned 0 plans → fallback builder was used
  hasLiveFetch: boolean;
  budgetRespected: boolean;
  budgetUtilization: number;
  avgVenueRating: number;
  duplicateVenueCount: number;
  duplicateCategoryCount: number;
  uniqueVenueCount: number;
  constraintViolations: string[];
  overallScore: number;
  avgTravelTimeMinutes: number;
  preferenceMatchRatio: number;
  plans: PlanMetrics[];
  error?: string;
}

const ROLE_ONLY_CATEGORIES = new Set(['FOOD_STOP', 'PRIMARY_EXPERIENCE', 'OPTIONAL_STOP']);
const STRONG_HANGOUT_PATTERNS = [
  'social', 'cafe', 'café', 'coffee', 'bistro', 'bakery', 'patisserie', 'dessert',
  'creamery', 'ice cream', 'gelato', 'waffle', 'theobroma', 'le15', 'taproom',
  'bar', 'brew', 'brewery', 'diner', 'kitchen', 'restaurant', 'pizza', 'sushi',
  'ramen', 'bbq', 'barbeque', 'arcade', 'game', 'gaming', 'timezone', 'smaaash',
  'bowling', 'escape', 'museum', 'gallery', 'art', 'studio', 'pottery', 'workshop',
  'promenade', 'beach', 'lake', 'garden', 'fort', 'national park', 'nature park',
  'waterfront', 'viewpoint', 'cinema', 'pvr', 'inox', 'cinepolis', 'theatre', 'mall'
];
const WEAK_PLACE_PATTERNS = [
  'family restaurant', 'veg restaurant', 'pure veg', 'hotel ', 'fast food',
  'snacks corner', 'sweets', 'caterers', 'biryani', 'chinese foods',
  'juice centre', 'cold drinks', 'tea stall', 'dhaba', 'mess', 'enterprises',
  'services', 'store', 'shop', 'mart', 'supermarket', 'medical', 'pharma',
  'pharmacy', 'school', 'college', 'classes', 'hostel', 'gymkhana',
  'club house', 'ground', 'maidan', 'kridangan', 'football turf', 'cricket ground',
  'mandir', 'temple', 'masjid', 'church', 'vihar', 'holiday', 'holidays',
  'travel', 'travels', 'tour', 'tours', 'frame', 'frames', 'branding',
  'conclave', 'dynamic positioning', 'training centre', 'training center',
  'guest house', 'resturant service', 'hotel ', 'max', 'wholesale',
  'exhibition centre'
];
const LOW_INTENT_CHAIN_PATTERNS = [
  'mcdonald', 'domino', 'kfc', 'subway', 'burger king', 'pizza hut',
  'barbeque nation', 'bbq nation', 'monginis', 'ribbons and balloons',
  'cafe coffee day', 'café coffee day', 'ccd', 'mad over donuts',
  'belgian waffle', 'naturals ice cream', 'starbucks', 'barista', 'mccafé',
  'mccafe', 'coffee day express'
];
const DATE_BAD_CATEGORIES = new Set(['ARCADE', 'BOWLING', 'SPORTS', 'MALL']);
const DATE_GOOD_CATEGORIES = new Set(['CAFE', 'RESTAURANT', 'DESSERT', 'PARK', 'MUSEUM', 'ART_GALLERY', 'POTTERY', 'WORKSHOP', 'PAINTING']);

function includesAny(text: string, patterns: string[]) {
  return patterns.some(pattern => text.includes(pattern));
}

function looksLikeHangoutSlot(slot: SlotMetrics) {
  const category = slot.category.toUpperCase();
  if (ROLE_ONLY_CATEGORIES.has(category)) return false;
  const text = `${slot.name} ${slot.address ?? ''}`.toLowerCase();
  const strongSignal = includesAny(text, STRONG_HANGOUT_PATTERNS);
  if (includesAny(text, LOW_INTENT_CHAIN_PATTERNS)) return false;
  if (includesAny(text, WEAK_PLACE_PATTERNS) && !strongSignal) return false;
  if (category === 'PARK') {
    return includesAny(text, ['promenade', 'beach', 'lake', 'fort', 'national park', 'nature park', 'waterfront', 'viewpoint', 'central park', 'jio world garden']);
  }
  return strongSignal || (slot.rating !== null && slot.rating >= 4.3);
}

export function computeMetrics(
  scenario: Scenario,
  plans: any[],
  durationMs: number,
  usedFallback = false,
  error?: string
): ItineraryMetrics {
  if (error || !plans || plans.length === 0) {
    return {
      scenarioId: scenario.id,
      durationMs,
      planCount: 0,
      isFallbackOnly: true,
      engineFallback: usedFallback,
      hasLiveFetch: false,
      budgetRespected: false,
      budgetUtilization: 0,
      avgVenueRating: 0,
      duplicateVenueCount: 0,
      duplicateCategoryCount: 0,
      uniqueVenueCount: 0,
      constraintViolations: ['NO_PLANS_GENERATED'],
      overallScore: 0,
      avgTravelTimeMinutes: 0,
      preferenceMatchRatio: 0,
      plans: [],
      error,
    };
  }

  const violations: string[] = [];

  const planMetrics: PlanMetrics[] = plans.map((plan: any) => {
    const slots: SlotMetrics[] = (plan.slots ?? []).map((s: any) => ({
      name: s.name ?? '',
      category: s.category ?? '',
      venueId: s.venueId ?? null,
      estimatedCostPerHead: s.estimatedCostPerHead ?? 0,
      durationMinutes: s.durationMinutes ?? 0,
      isFallback: (s.venueId ?? '').startsWith('fallback_') || (s.venueId ?? '').startsWith('fb_'),
      rating: s.rating ?? null,
      address: s.address ?? '',
    }));
    return {
      planId: plan.id,
      score: plan.score ?? 0,
      totalEstimatedCostPerHead: plan.totalEstimatedCostPerHead ?? 0,
      totalDurationMinutes: plan.totalDurationMinutes ?? 0,
      meetupZone: plan.meetupZone ?? plan.name ?? '',
      budgetTier: plan.budgetTier ?? 'BALANCED',
      avgTravelTime: plan.avgTotalTime ?? plan.avgCabTime ?? 0,
      slots,
    };
  });

  const bestPlan = planMetrics[0]; // plans are sorted by score already
  const allSlots = bestPlan?.slots ?? [];

  // === Budget ===
  const cost = bestPlan?.totalEstimatedCostPerHead ?? 0;
  const budgetRespected = cost <= scenario.budget;
  const budgetUtilization = scenario.budget > 0 ? cost / scenario.budget : 0;
  if (!budgetRespected) violations.push(`BUDGET_EXCEEDED:₹${cost}>₹${scenario.budget}`);

  // === Fallback / live-fetch flags ===
  const isFallbackOnly = planMetrics.every(p => p.slots.every(s => s.isFallback));
  const hasLiveFetch = planMetrics.some(p => p.slots.some(s => (s.venueId ?? '').startsWith('OLA_')));

  // === Diversity: duplicate venues ===
  const venueIds = allSlots.map(s => s.venueId).filter(Boolean);
  const uniqueVenueIds = new Set(venueIds);
  const duplicateVenueCount = venueIds.length - uniqueVenueIds.size;
  if (duplicateVenueCount > 0) violations.push(`DUPLICATE_VENUES:${duplicateVenueCount}`);

  // === Diversity: duplicate categories ===
  const cats = allSlots.map(s => s.category?.toUpperCase()).filter(Boolean);
  const uniqueCats = new Set(cats);
  const duplicateCategoryCount = cats.length - uniqueCats.size;

  // === Average rating ===
  const ratings: number[] = allSlots.map(s => (s as any).rating).filter((r: any) => r != null && r > 0);
  const avgVenueRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

  // === Travel ===
  const avgTravelTimeMinutes = bestPlan?.avgTravelTime ?? 0;

  // === Preference match ===
  const prefSet = new Set(scenario.preferences.map(p => p.toUpperCase()));
  const matchingSlots = allSlots.filter(s => prefSet.has(s.category?.toUpperCase()));
  const preferenceMatchRatio = allSlots.length > 0 ? matchingSlots.length / allSlots.length : 0;

  // === Impossible schedule check: slots must have positive duration ===
  allSlots.forEach((s, i) => {
    if (s.durationMinutes <= 0) violations.push(`INVALID_DURATION:slot${i + 1}`);
  });

  allSlots.forEach((s) => {
    if (ROLE_ONLY_CATEGORIES.has(s.category.toUpperCase())) {
      violations.push(`ROLE_CATEGORY_SELECTED:${s.category}:${s.name}`);
    }
    if (!looksLikeHangoutSlot(s)) {
      violations.push(`WEAK_HANGOUT_SPOT:${s.category}:${s.name}`);
    }
  });

  if (scenario.groupType.toUpperCase() === 'DATE') {
    const badDateSlots = allSlots.filter(s => DATE_BAD_CATEGORIES.has(s.category.toUpperCase()));
    const goodDateSlots = allSlots.filter(s => DATE_GOOD_CATEGORIES.has(s.category.toUpperCase()));
    if (badDateSlots.length > 0) {
      violations.push(`DATE_MISMATCH:${badDateSlots.map(s => s.name).join(',')}`);
    }
    if (goodDateSlots.length < Math.min(2, allSlots.length)) {
      violations.push(`DATE_LOW_INTENT:${goodDateSlots.length}/${allSlots.length}`);
    }
  }

  if (preferenceMatchRatio < 0.34 && scenario.preferences.length > 0) {
    violations.push(`LOW_PREFERENCE_MATCH:${Math.round(preferenceMatchRatio * 100)}%`);
  }

  // === Museum/Park opening hours: night slots ===
  const nightHour = (() => {
    const m = scenario.outingTime?.match(/^(\d{1,2}):(\d{2})$/);
    return m ? parseInt(m[1]) : 12;
  })();
  allSlots.forEach(s => {
    const cat = s.category?.toUpperCase();
    if ((cat === 'MUSEUM' || cat === 'PARK') && nightHour >= 21) {
      violations.push(`HOURS_VIOLATION:${s.name}(${cat})@${scenario.outingTime}`);
    }
  });

  // === Strict zone integrity ===
  for (const plan of plans) {
    const labelZone = String(plan.meetupZone ?? plan.name ?? '');
    for (const slot of plan.slots ?? []) {
      if (typeof slot.lat !== 'number' || typeof slot.lng !== 'number') continue;
      const slotZone = getVenueZone(slot.lat, slot.lng, slot.name ?? '', slot.address ?? '');
      if (labelZone && slotZone !== labelZone) {
        violations.push(`ZONE_MISMATCH:${labelZone}->${slotZone}:${slot.name}`);
      }
    }
  }

  // === Quality score 0–100 ===
  const budgetScore = budgetRespected ? 25 : Math.max(0, 25 - (budgetUtilization - 1) * 25);
  const ratingNorm = avgVenueRating > 0 ? (avgVenueRating / 5.0) * 20 : 10;
  const diversityNorm = allSlots.length > 0 ? (uniqueCats.size / allSlots.length) * 15 : 0;
  const travelNorm = (1 - Math.min(1, avgTravelTimeMinutes / 60)) * 15;
  const prefNorm = preferenceMatchRatio * 15;
  const constraintScore = violations.length === 0 ? 10 : Math.max(0, 10 - violations.length * 3);

  const overallScore = Math.round(
    Math.min(100, budgetScore + ratingNorm + diversityNorm + travelNorm + prefNorm + constraintScore)
  );

  return {
    scenarioId: scenario.id,
    durationMs,
    planCount: plans.length,
    isFallbackOnly,
    engineFallback: usedFallback,
    hasLiveFetch,
    budgetRespected,
    budgetUtilization,
    avgVenueRating,
    duplicateVenueCount,
    duplicateCategoryCount,
    uniqueVenueCount: uniqueVenueIds.size,
    constraintViolations: violations,
    overallScore,
    avgTravelTimeMinutes,
    preferenceMatchRatio,
    plans: planMetrics,
    error: undefined,
  };
}
