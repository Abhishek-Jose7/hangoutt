import type { Place } from '@/types';
import { haversineDistance } from './transit';

export const PLACE_CONFIDENCE_THRESHOLD = 0.45;

export function validateGroundedPlaces(
  places: Place[],
  hub: { lat: number; lng: number }
): Place[] {
  const seen = new Set<string>();

  return places.filter((place) => {
    if (!place.name || place.name.trim().length < 4) return false;
    if (typeof place.lat !== 'number' || typeof place.lng !== 'number') return false;
    if (!place.type) return false;
    if ((place.confidence_score || 0) < PLACE_CONFIDENCE_THRESHOLD) return false;

    const key = place.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);

    const dist = haversineDistance({ lat: place.lat, lng: place.lng }, hub);
    return dist <= 4;
  });
}

export function finalValidatePlacesBeforeEngine(places: Place[]): Place[] {
  return places.filter((place) =>
    Boolean(place.name) &&
    place.name.trim().length > 3 &&
    typeof place.lat === 'number' &&
    Number.isFinite(place.lat) &&
    typeof place.lng === 'number' &&
    Number.isFinite(place.lng) &&
    Boolean(place.type) &&
    (place.confidence_score || 0) >= PLACE_CONFIDENCE_THRESHOLD
  );
}
