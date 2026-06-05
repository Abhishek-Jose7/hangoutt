import { Venue } from '../types/planner.types';
import { type Experience } from '../repositories/experience.repository';

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
  // 1. Distance Score: linear decay, max 10km
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
  const ratingScore = Math.min(1, Math.max(0, (venue.rating || 0) / 5.0));

  // 4. Preference Score: 1 if category matches preferences, 0 otherwise
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

// 8-Factor Experience Scoring Engine
export interface ExperienceScoreBreakdown {
  distanceScore: number;
  ticketCostScore: number;
  popularityScore: number;
  preferenceScore: number;
  conversationQualityScore: number;
  freshnessScore: number;
  weatherSuitabilityScore: number;
  groupTypeBoost: number;
  vibeBoost: number;
  availabilityBonus: number;
  finalScore: number;
}

export function scoreExperience(
  exp: Experience & { distanceKm: number },
  groupType: 'FRIENDS' | 'DATE' | 'FAMILY' | 'WORK' | 'CUSTOM',
  vibes: string[],
  maxBudget: number,
  preferredCategories: string[],
  history: { planName: string; createdAt: string }[] = [],
  proposedDate?: string,
  forecastRainy: boolean = false
): ExperienceScoreBreakdown {
  // 1. Distance Score: max 15km search radius
  const maxRadiusKm = 15;
  const distanceScore = Math.max(0, 1 - (exp.distanceKm / maxRadiusKm));

  // 2. Ticket Cost Score: 1.0 if free, decays linearly if under maxBudget, 0 if exceeds
  let ticketCostScore = 0;
  if (exp.ticketPrice === 0 || exp.category === 'FREE_EXPERIENCE') {
    ticketCostScore = 1.0;
  } else if (exp.ticketPrice <= maxBudget) {
    ticketCostScore = 1.0 - (exp.ticketPrice / maxBudget);
  }

  // 3. Popularity Score: normalized 0.0 - 1.0
  const popularityScore = Math.min(1.0, Math.max(0.0, exp.popularityScore || 0.0));

  // 4. Preference Score
  const preferenceScore = preferredCategories.includes(exp.category) ? 1.0 : 0.0;

  // 5. Conversation Quality Score
  let conversationQualityScore = 0.0;
  const highConvCategories = ['POTTERY', 'WORKSHOP', 'PAINTING', 'BOARD_GAME_EVENT', 'EXHIBITION', 'MUSEUM', 'ART_GALLERY'];
  const lowConvCategories = ['MOVIE', 'CONCERT', 'THEATRE'];
  
  if (highConvCategories.includes(exp.category)) {
    conversationQualityScore = 0.30; // boost
  } else if (lowConvCategories.includes(exp.category)) {
    if (groupType === 'DATE' || groupType === 'WORK') {
      conversationQualityScore = -0.20; // penalty
    }
  }

  // 6. Freshness Score (Penalize recently recommended/visited)
  let freshnessScore = 1.0;
  const matchesTitle = (entry: any) => entry.planName.toLowerCase().includes(exp.title.toLowerCase());
  const matchCount = history.filter(matchesTitle).length;
  if (matchCount > 0) {
    freshnessScore -= 0.50; // Simple penalty
  }

  // 7. Weather Suitability Score
  let weatherSuitabilityScore = 0.0;
  const outdoorCategories = ['OUTDOOR_EXPERIENCE', 'SCENIC_EXPERIENCE', 'FOOD_FESTIVAL', 'NIGHT_MARKET', 'FLEA_MARKET', 'PARK'];
  const indoorCategories = ['MUSEUM', 'ART_GALLERY', 'AQUARIUM', 'ESCAPE_ROOM', 'BOWLING', 'THEATRE', 'MALL', 'CAFE', 'RESTAURANT'];
  
  if (forecastRainy) {
    if (outdoorCategories.includes(exp.category)) {
      weatherSuitabilityScore = -0.50;
    } else if (indoorCategories.includes(exp.category)) {
      weatherSuitabilityScore = 0.40;
    }
  }

  // 8. Group Type Boost
  let groupTypeBoost = 0.0;
  if (groupType === 'DATE') {
    const dateHigh = ['MUSEUM', 'ART_GALLERY', 'EXHIBITION', 'AQUARIUM', 'POTTERY', 'PAINTING', 'WORKSHOP', 'LIVE_MUSIC', 'SCENIC_EXPERIENCE'];
    const dateMed = ['RESTAURANT', 'CAFE', 'THEATRE'];
    const dateLow = ['CONCERT', 'SPORTS_EVENT'];

    if (dateHigh.includes(exp.category)) groupTypeBoost = 0.40;
    else if (dateMed.includes(exp.category)) groupTypeBoost = 0.20;
    else if (dateLow.includes(exp.category)) groupTypeBoost = -0.20;
  } else if (groupType === 'FRIENDS') {
    const friendsHigh = ['CONCERT', 'LIVE_MUSIC', 'COMEDY', 'NIGHT_MARKET', 'CONVENTION', 'GAMING_EVENT', 'SPORTS_EVENT'];
    const friendsMed = ['BOARD_GAME_EVENT', 'FOOD_FESTIVAL', 'ARCADE', 'BOWLING', 'ESCAPE_ROOM'];
    const friendsLow = ['MUSEUM'];

    if (friendsHigh.includes(exp.category)) groupTypeBoost = 0.40;
    else if (friendsMed.includes(exp.category)) groupTypeBoost = 0.20;
    else if (friendsLow.includes(exp.category)) groupTypeBoost = -0.20;
  } else if (groupType === 'FAMILY') {
    const famHigh = ['MUSEUM', 'AQUARIUM', 'PARK', 'CULTURAL_EVENT', 'SEASONAL_EVENT'];
    const famMed = ['BOARD_GAME_EVENT', 'WORKSHOP', 'CAFE', 'RESTAURANT'];
    const famLow = ['NIGHT_MARKET', 'COMEDY'];

    if (famHigh.includes(exp.category)) groupTypeBoost = 0.40;
    else if (famMed.includes(exp.category)) groupTypeBoost = 0.20;
    else if (famLow.includes(exp.category)) groupTypeBoost = -0.20;
  } else if (groupType === 'WORK') {
    const workHigh = ['WORKSHOP', 'POTTERY', 'PAINTING', 'ESCAPE_ROOM', 'RESTAURANT'];
    const workMed = ['CAFE'];
    const workLow = ['ROMANTIC', 'LIVE_MUSIC'];

    if (workHigh.includes(exp.category)) groupTypeBoost = 0.40;
    else if (workMed.includes(exp.category)) groupTypeBoost = 0.20;
    else if (workLow.includes(exp.category)) groupTypeBoost = -0.20;
  }

  // 9. Vibe Boost
  let vibeBoost = 0.0;
  const vibeMap: Record<string, string[]> = {
    CHILL: ['PARK', 'SCENIC_EXPERIENCE', 'CAFE', 'DESSERT'],
    CREATIVE: ['POTTERY', 'PAINTING', 'WORKSHOP', 'BOOK_EVENT'],
    FOODIE: ['FOOD_FESTIVAL', 'NIGHT_MARKET', 'RESTAURANT', 'DESSERT', 'CAFE'],
    CULTURAL: ['MUSEUM', 'ART_GALLERY', 'EXHIBITION', 'CULTURAL_EVENT', 'BOOK_EVENT'],
    COMPETITIVE: ['BOARD_GAME_EVENT', 'ARCADE', 'ESCAPE_ROOM', 'SPORTS_EVENT'],
    ADVENTUROUS: ['OUTDOOR_EXPERIENCE', 'ESCAPE_ROOM'],
    ROMANTIC: ['LIVE_MUSIC', 'SCENIC_EXPERIENCE', 'RESTAURANT', 'CULTURAL_EVENT'],
    LUXURY: ['RESTAURANT', 'ART_GALLERY', 'THEATRE'],
    BUDGET: ['FREE_EXPERIENCE', 'FLEA_MARKET', 'PARK'],
  };

  let matchCountVibes = 0;
  for (const vibe of vibes) {
    const categoriesForVibe = vibeMap[vibe.toUpperCase()];
    if (categoriesForVibe && categoriesForVibe.includes(exp.category)) {
      matchCountVibes++;
    }
  }
  vibeBoost = Math.min(0.60, matchCountVibes * 0.30);

  // 10. Availability Bonus
  let availabilityBonus = 0.0;
  if (proposedDate && exp.startDate && exp.endDate) {
    const propDay = proposedDate.split('T')[0];
    const startDay = exp.startDate.split('T')[0];
    const endDay = exp.endDate.split('T')[0];
    if (propDay >= startDay && propDay <= endDay) {
      availabilityBonus = 0.50; // availability multiplier equivalent
    }
  }

  // Final Experience Score Sum
  const finalScore =
    distanceScore * 0.20 +
    ticketCostScore * 0.15 +
    popularityScore * 0.10 +
    preferenceScore * 0.10 +
    conversationQualityScore +
    (freshnessScore * 0.15) +
    weatherSuitabilityScore +
    groupTypeBoost +
    vibeBoost +
    availabilityBonus;

  return {
    distanceScore,
    ticketCostScore,
    popularityScore,
    preferenceScore,
    conversationQualityScore,
    freshnessScore,
    weatherSuitabilityScore,
    groupTypeBoost,
    vibeBoost,
    availabilityBonus,
    finalScore,
  };
}

export function rankExperiences(
  exps: (Experience & { distanceKm: number })[],
  groupType: 'FRIENDS' | 'DATE' | 'FAMILY' | 'WORK' | 'CUSTOM',
  vibes: string[],
  maxBudget: number,
  preferredCategories: string[],
  history: any[] = [],
  proposedDate?: string,
  forecastRainy: boolean = false
): (Experience & { distanceKm: number; score: number })[] {
  return exps
    .map(e => {
      const breakdown = scoreExperience(e, groupType, vibes, maxBudget, preferredCategories, history, proposedDate, forecastRainy);
      return {
        ...e,
        score: breakdown.finalScore,
      };
    })
    .sort((a, b) => b.score - a.score);
}
