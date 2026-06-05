import { Venue } from '../types/planner.types';

export interface ScoreBreakdown {
  distanceScore: number;
  budgetScore: number;
  ratingScore: number;
  preferenceScore: number;
  finalScore: number;
}

export function scoreVenue(
  venue: Venue,
  avgBudget: number,
  minBudget: number,
  preferredCategories: string[]
): ScoreBreakdown {
  // 1. Distance Score: linear decay, max 10km (can adjust based on search parameters)
  const maxDistanceKm = 10;
  const distanceScore = Math.max(0, 1 - (venue.distanceKm / maxDistanceKm));

  // 2. Budget Score: 1 if within min budget, decays linearly towards avg budget, 0 if exceeds avg
  let budgetScore = 0;
  if (venue.estimatedCostPerHead <= minBudget) {
    budgetScore = 1;
  } else if (venue.estimatedCostPerHead <= avgBudget) {
    const range = avgBudget - minBudget;
    budgetScore = range > 0 ? (avgBudget - venue.estimatedCostPerHead) / range : 1;
  }

  // 3. Rating Score: normalized out of 5.0
  const ratingScore = Math.min(1, Math.max(0, venue.rating / 5.0));

  // 4. Preference Score: 1 if category matches preferences, 0 otherwise (simplification for Phase 1)
  const preferenceScore = preferredCategories.includes(venue.category) ? 1 : 0;

  // 5. Final Weighted Sum
  const finalScore =
    distanceScore * 0.40 +
    budgetScore * 0.30 +
    ratingScore * 0.20 +
    preferenceScore * 0.10;

  return {
    distanceScore,
    budgetScore,
    ratingScore,
    preferenceScore,
    finalScore,
  };
}

export function rankVenues(
  venues: Venue[],
  avgBudget: number,
  minBudget: number,
  preferredCategories: string[]
): (Venue & { score: number })[] {
  return venues
    .map(v => {
      const { finalScore } = scoreVenue(v, avgBudget, minBudget, preferredCategories);
      return {
        ...v,
        score: finalScore,
      };
    })
    .sort((a, b) => b.score - a.score);
}
