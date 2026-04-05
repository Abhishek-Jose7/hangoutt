import type { Place } from '@/types';
import type { Mood } from '@/types';
import { haversineDistance } from './transit';

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
  // Relevance score from source (0-1)
  const relevance = place.relevance_score;

  // Budget fit (0-1): how well does the estimated cost fit within budget?
  let budgetFit = 0.5; // default when no cost data
  if (place.estimated_cost !== undefined && place.estimated_cost > 0) {
    const ratio = place.estimated_cost / perPersonCap;
    if (ratio <= 0.5) budgetFit = 1.0;
    else if (ratio <= 0.8) budgetFit = 0.8;
    else if (ratio <= 1.0) budgetFit = 0.6;
    else if (ratio <= 1.3) budgetFit = 0.3;
    else budgetFit = 0.1;
  }

  // Distance from hub (0-1): closer is better
  let proximityScore = 0.5; // default when no coords
  if (place.lat !== undefined && place.lng !== undefined) {
    const distKm = haversineDistance(
      { lat: hubLat, lng: hubLng },
      { lat: place.lat, lng: place.lng }
    );
    // Normalize: 0km = 1.0, 2km = 0.0
    proximityScore = Math.max(0, 1 - distKm / 2);
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
  const moodScore = Math.min(1, keywordScore * 0.6 + moodTypeBoost[mood][place.type] * 0.4);

  const qualityBoost = relevance >= 0.9 ? 0.06 : 0;

  // Weighted score: prioritize venue quality + vibe first, budget second
  return relevance * 0.4 + moodScore * 0.28 + proximityScore * 0.17 + budgetFit * 0.15 + qualityBoost;
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
    _score: scorePlace(p, perPersonCap, hubLat, hubLng, mood),
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
