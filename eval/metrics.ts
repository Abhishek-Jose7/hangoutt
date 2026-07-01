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
