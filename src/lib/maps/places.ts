import 'server-only';
import { VenueCategory } from '../types/planner.types';
import { recordCost } from '../services/costLedger';

const getGoogleApiKey = () => process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_BASE_URL = 'https://maps.googleapis.com/maps/api/place';

const DEFAULT_FALLBACK = '/images/mumbai_map.png';

/**
 * Resolve a real venue photo URL using the Google Places API.
 * 
 * Flow:
 * 1. Text Search → get place_id & photo_reference
 * 2. Construct photo URL with photo_reference + api_key
 */
export async function getVenueImageUrl(
  venueName: string,
  city: string,
  category?: string
): Promise<string> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    return getCategoryFallback(category);
  }

  const searchQuery = `${venueName} ${city}`;
  try {
    const searchUrl = `${GOOGLE_BASE_URL}/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${apiKey}`;

    const searchController = new AbortController();
    const searchTimeout = setTimeout(() => searchController.abort(), 8000);

    let searchRes: Response;
    try {
      searchRes = await fetch(searchUrl, { signal: searchController.signal });
    } finally {
      clearTimeout(searchTimeout);
    }
    // Chargeable regardless of hit — the API bills for every request.
    recordCost({ operation: 'PLACES_TEXTSEARCH', provider: 'GOOGLE_PLACES' });

    if (!searchRes.ok) {
      console.warn(`Google textsearch returned ${searchRes.status} for "${searchQuery}"`);
      return getCategoryFallback(category);
    }

    const searchData = await searchRes.json() as any;
    const results = searchData?.results || [];
    
    if (!results.length) {
      console.warn(`Google textsearch returned 0 results for "${searchQuery}"`);
      return getCategoryFallback(category);
    }

    const result = results[0];
    const photos = result?.photos;

    if (!photos || !photos.length || !photos[0]?.photo_reference) {
      return getCategoryFallback(category);
    }

    const photoRef = photos[0].photo_reference;
    return `/api/places/photo?ref=${encodeURIComponent(photoRef)}`;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`Google Places API request aborted (timeout) for "${searchQuery}".`);
    } else {
      console.error(`Google Places photo resolution failed for "${venueName}":`, err);
    }
    return getCategoryFallback(category);
  }
}

/**
 * Returns a local fallback when Google Places has no usable photo.
 */
export function getCategoryFallback(_category?: string): string {
  return DEFAULT_FALLBACK;
}

const categoryToGoogleType: Record<string, string> = {
  'CAFE': 'cafe',
  'RESTAURANT': 'restaurant',
  'PARK': 'park',
  'ARCADE': 'amusement_park',
  'BOWLING': 'bowling_alley',
  'ESCAPE_ROOM': 'tourist_attraction',
  'MOVIE': 'movie_theater',
  'MALL': 'shopping_mall',
  'DESSERT': 'bakery',
  'SPORTS': 'stadium',
  'MUSEUM': 'museum',
};

export async function searchNearbyVenues(
  lat: number,
  lng: number,
  category: VenueCategory,
  radiusMeters = 3000
): Promise<any[]> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    return [];
  }

  const type = categoryToGoogleType[category] || 'restaurant';
  const url = `${GOOGLE_BASE_URL}/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=${type}&key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    recordCost({ operation: 'PLACES_NEARBY', provider: 'GOOGLE_PLACES' });

    if (!res.ok) {
      console.warn(`Google nearbysearch returned ${res.status} for category ${category}`);
      return [];
    }

    const data = await res.json() as any;
    return data?.results || [];
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`Google Nearby Search request aborted (timeout) for category ${category}.`);
    } else {
      console.error(`Google Nearby Search failed for category ${category}:`, err);
    }
    return [];
  }
}

export async function getVenueDetails(placeId: string): Promise<any> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    return {};
  }

  const url = `${GOOGLE_BASE_URL}/details/json?place_id=${encodeURIComponent(placeId)}&key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    recordCost({ operation: 'PLACES_DETAILS', provider: 'GOOGLE_PLACES' });

    if (!res.ok) {
      console.warn(`Google details returned ${res.status} for place_id="${placeId}"`);
      return {};
    }

    const data = await res.json() as any;
    return data?.result || {};
  } catch (err) {
    console.error(`Google Details failed for place_id="${placeId}":`, err);
    return {};
  }
}

export async function searchTextVenues(query: string): Promise<any[]> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    return [];
  }

  const url = `${GOOGLE_BASE_URL}/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    recordCost({ operation: 'PLACES_TEXTSEARCH', provider: 'GOOGLE_PLACES' });

    if (!res.ok) {
      console.warn(`Google textsearch returned ${res.status} for query "${query}"`);
      return [];
    }

    const data = await res.json() as any;
    return data?.results || [];
  } catch (err) {
    console.error(`Google Text Search failed for query "${query}":`, err);
    return [];
  }
}
