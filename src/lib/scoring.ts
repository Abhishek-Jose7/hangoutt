import type { Place } from '@/types';
import type { Mood } from '@/types';
import { haversineDistance } from './transit';

export interface PlaceScoreBreakdown {
  distance_score: number;
  budget_match: number;
  vibe_match: number;
  rating_score: number;
  total_score: number;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Score a place based on relevance, budget fit, and distance from hub
 */
export function scorePlace(
  place: Place,
  perPersonCap: number,
  hubLat: number,
  hubLng: number,
  mood: Mood
): number {
  return scorePlaceBreakdown(place, perPersonCap, hubLat, hubLng, mood).total_score;
}

export function scorePlaceBreakdown(
  place: Place,
  perPersonCap: number,
  hubLat: number,
  hubLng: number,
  mood: Mood
): PlaceScoreBreakdown {
  // Distance score (0-1): closer to hub is better.
  let distanceScore = 0.6;
  if (place.lat !== undefined && place.lng !== undefined) {
    const distKm = haversineDistance(
      { lat: hubLat, lng: hubLng },
      { lat: place.lat, lng: place.lng }
    );
    distanceScore = clamp01(1 - distKm / 3);
  }

  // Budget match (0-1): fit against per-person budget.
  let budgetMatch = 0.5;
  if (place.estimated_cost !== undefined && place.estimated_cost > 0) {
    const ratio = place.estimated_cost / perPersonCap;
    if (ratio <= 0.5) budgetMatch = 0.95;
    else if (ratio <= 0.8) budgetMatch = 0.85;
    else if (ratio <= 1.0) budgetMatch = 0.7;
    else if (ratio <= 1.2) budgetMatch = 0.4;
    else budgetMatch = 0.15;
  }

  const moodKeywords: Record<Mood, string[]> = {
    fun: ['arcade', 'music', 'gaming', 'lively', 'party', 'social', 'entertainment'],
    chill: ['quiet', 'cozy', 'calm', 'board game', 'slow', 'relax', 'peaceful'],
    romantic: ['date', 'sunset', 'romantic', 'cozy', 'fine dining', 'couple'],
    adventure: ['escape', 'sports', 'climb', 'adventure', 'thrill', 'interactive'],
  };
  const moodTypeBoost: Record<Mood, Record<Place['type'], number>> = {
    fun: { cafe: 0.75, activity: 1, restaurant: 0.7, outdoor: 0.6 },
    chill: { cafe: 1, activity: 0.65, restaurant: 0.72, outdoor: 0.85 },
    romantic: { cafe: 0.8, activity: 0.65, restaurant: 1, outdoor: 0.78 },
    adventure: { cafe: 0.55, activity: 1, restaurant: 0.65, outdoor: 0.9 },
  };

  const text = `${place.name} ${place.description}`.toLowerCase();
  const keywordHits = moodKeywords[mood].filter((k) => text.includes(k)).length;
  const keywordScore = Math.min(1, keywordHits / 2);
  const moodScore = clamp01(keywordScore * 0.55 + moodTypeBoost[mood][place.type] * 0.45);

  // Rating score (0-1): explicit venue quality signal.
  const ratingRaw = place.inferred_rating;
  const ratingScore = ratingRaw && ratingRaw > 0
    ? clamp01((ratingRaw - 3) / 2)
    : clamp01(place.relevance_score * 0.75);

  const totalScore =
    distanceScore +
    budgetMatch +
    moodScore +
    ratingScore;

  return {
    distance_score: distanceScore,
    budget_match: budgetMatch,
    vibe_match: moodScore,
    rating_score: ratingScore,
    total_score: totalScore,
  };
}

/**
 * Score and rank places, group by type, and return top candidates
 */
export function selectTopCandidates(
  places: Place[],
  perPersonCap: number,
  hubLat: number,
  hubLng: number,
  mood: Mood,
  topPerType: number = 2
): Place[] {
  const scored = places.map((p) => ({
    ...p,
    _score: scorePlaceBreakdown(p, perPersonCap, hubLat, hubLng, mood).total_score,
  }));

  // Group by type
  const groups: Record<string, typeof scored> = {};
  for (const place of scored) {
    if (!groups[place.type]) groups[place.type] = [];
    groups[place.type].push(place);
  }

  // Sort each group by score and take top N
  const selected: Place[] = [];
  for (const type of Object.keys(groups)) {
    groups[type].sort((a, b) => {
      if (type === 'restaurant' || type === 'cafe') {
        const aCost = a.estimated_cost ?? perPersonCap * 0.3;
        const bCost = b.estimated_cost ?? perPersonCap * 0.3;
        const aComposite = a._score - (aCost / perPersonCap) * 0.2;
        const bComposite = b._score - (bCost / perPersonCap) * 0.2;
        return bComposite - aComposite;
      }
      return b._score - a._score;
    });
    const topPlaces = groups[type].slice(0, topPerType);
    selected.push(...topPlaces.map(({ _score, ...rest }) => rest));
  }

  return selected;
}
