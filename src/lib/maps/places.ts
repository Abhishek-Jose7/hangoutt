import 'server-only';
import { VenueCategory } from '../types/planner.types';

export async function searchNearbyVenues(
  _lat: number,
  _lng: number,
  _category: VenueCategory,
  _radiusMeters = 3000
): Promise<any[]> {
  // Real endpoint: POST /places/v1/nearbysearch
  // For Phase 1, return stub results
  return [];
}

export async function getVenueDetails(_placeId: string): Promise<any> {
  // Real endpoint: GET /places/v1/details?place_id=...
  return {};
}
