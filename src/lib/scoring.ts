import type { Place } from '@/types';
import { haversineDistance } from './transit';

/**
 * Score a place based on relevance, budget fit, and distance from hub
 */
export function scorePlace(
  place: Place,
  perPersonCap: number,
  hubLat: number,
  hubLng: number
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

  // Weighted score
  return relevance * 0.4 + budgetFit * 0.3 + proximityScore * 0.3;
}

/**
 * Score and rank places, group by type, and return top candidates
 */
export function selectTopCandidates(
  places: Place[],
  perPersonCap: number,
  hubLat: number,
  hubLng: number,
  topPerType: number = 2
): Place[] {
  const scored = places.map((p) => ({
    ...p,
    _score: scorePlace(p, perPersonCap, hubLat, hubLng),
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
    groups[type].sort((a, b) => b._score - a._score);
    const topPlaces = groups[type].slice(0, topPerType);
    selected.push(...topPlaces.map(({ _score, ...rest }) => rest));
  }

  return selected;
}
