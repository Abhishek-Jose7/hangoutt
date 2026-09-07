import 'server-only';
import type { VenueCategory } from '../types/planner.types';

const DEFAULT_FALLBACK = '/images/mumbai_map.webp';

/**
 * Maps photo/search calls are intentionally disabled.
 * Venue discovery and imagery come from sourced web imports and catalog rows.
 * Keep these compatibility functions so old callers fail closed without API
 * spend or opaque photo-reference tokens.
 */
export function getCategoryFallback(_category?: string): string {
  void _category;
  return DEFAULT_FALLBACK;
}

export async function getVenueImageUrl(
  _venueName: string,
  _city: string,
  category?: string,
): Promise<string> {
  return getCategoryFallback(category);
}

export async function searchNearbyVenues(
  _lat: number,
  _lng: number,
  _category: VenueCategory,
  _radiusMeters = 3000,
): Promise<any[]> {
  void _lat;
  void _lng;
  void _category;
  void _radiusMeters;
  return [];
}

export async function getVenueDetails(_placeId: string): Promise<Record<string, never>> {
  void _placeId;
  return {};
}

export async function searchTextVenues(_query: string): Promise<any[]> {
  void _query;
  return [];
}
