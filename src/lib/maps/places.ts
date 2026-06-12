import 'server-only';
import { VenueCategory } from '../types/planner.types';

const getOlaApiKey = () => process.env.OLA_MAPS_API_KEY;
const OLA_BASE_URL = 'https://api.olamaps.io';

// Category-based fallback images (used when Ola Places has no photo)
const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  'CAFE': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=CAFE',
  'RESTAURANT': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=RESTAURANT',
  'DESSERT': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=DESSERT',
  'PARK': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=PARK',
  'ARCADE': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=ARCADE',
  'BOWLING': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=BOWLING',
  'ESCAPE_ROOM': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=ESCAPE_ROOM',
  'POTTERY': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=POTTERY',
  'LIVE_MUSIC': 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=LIVE_MUSIC',
};
const DEFAULT_FALLBACK = 'https://placehold.co/600x400/0f0f0f/DC143C.png?text=OUTING';

/**
 * Resolve a real venue photo URL using the Ola Places API.
 * 
 * Flow:
 * 1. Text Search → get place_id
 * 2. Place Details → get photo_reference from photos[]
 * 3. Construct photo URL with photo_reference + api_key
 * 
 * Falls back to category-based Unsplash image if Ola API fails or returns no photo.
 */
let isOlaPlacesDisabled = false;

export async function getVenueImageUrl(
  venueName: string,
  city: string,
  category?: string
): Promise<string> {
  const apiKey = getOlaApiKey();
  const isPlaceholder = !apiKey || apiKey === 'placeholder_ola_maps_key' || apiKey.includes('placeholder');

  if (isPlaceholder || isOlaPlacesDisabled) {
    return getCategoryFallback(category);
  }

  const searchQuery = `${venueName} ${city}`;
  try {
    // Step 1: Text Search to find the place_id
    const searchUrl = `${OLA_BASE_URL}/places/v1/textsearch?input=${encodeURIComponent(searchQuery)}&api_key=${apiKey}`;

    const searchController = new AbortController();
    const searchTimeout = setTimeout(() => searchController.abort(), 8000);

    let searchRes: Response;
    try {
      searchRes = await fetch(searchUrl, {
        headers: { 
          'X-Request-Id': `hangoutt-${Date.now()}`,
          'Referer': 'http://localhost:3000',
          'Origin': 'http://localhost:3000'
        },
        signal: searchController.signal,
      });
    } finally {
      clearTimeout(searchTimeout);
    }

    if (!searchRes.ok) {
      console.warn(`Ola textsearch returned ${searchRes.status} for "${searchQuery}"`);
      return getCategoryFallback(category);
    }

    const searchData = await searchRes.json() as any;
    const predictions = searchData?.predictions || searchData?.results || [];
    
    if (!predictions.length) {
      console.warn(`Ola textsearch returned 0 results for "${searchQuery}"`);
      return getCategoryFallback(category);
    }

    const placeId = predictions[0]?.place_id;
    if (!placeId) {
      return getCategoryFallback(category);
    }

    // Step 2: Place Details to get photo_reference
    const detailsUrl = `${OLA_BASE_URL}/places/v1/details?place_id=${encodeURIComponent(placeId)}&api_key=${apiKey}`;

    const detailsController = new AbortController();
    const detailsTimeout = setTimeout(() => detailsController.abort(), 8000);

    let detailsRes: Response;
    try {
      detailsRes = await fetch(detailsUrl, {
        headers: { 
          'X-Request-Id': `hangoutt-details-${Date.now()}`,
          'Referer': 'http://localhost:3000',
          'Origin': 'http://localhost:3000'
        },
        signal: detailsController.signal,
      });
    } finally {
      clearTimeout(detailsTimeout);
    }

    if (!detailsRes.ok) {
      console.warn(`Ola place details returned ${detailsRes.status} for place_id="${placeId}"`);
      return getCategoryFallback(category);
    }

    const detailsData = await detailsRes.json() as any;
    const result = detailsData?.result;
    const photos = result?.photos;

    if (!photos || !photos.length || !photos[0]?.photo_reference) {
      console.warn(`No photos found for place_id="${placeId}"`);
      return getCategoryFallback(category);
    }

    const photoRef = photos[0].photo_reference;

    // Step 3: Construct the photo URL
    const photoUrl = `${OLA_BASE_URL}/places/v1/photo?photo_reference=${encodeURIComponent(photoRef)}&api_key=${apiKey}`;

    return photoUrl;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`Ola Places API request aborted (timeout) for "${searchQuery}".`);
    } else {
      console.error(`Ola Places photo resolution failed for "${venueName}":`, err);
    }
    return getCategoryFallback(category);
  }
}

/**
 * Returns a category-based Unsplash fallback image URL.
 */
export function getCategoryFallback(category?: string): string {
  if (category && CATEGORY_FALLBACK_IMAGES[category]) {
    return CATEGORY_FALLBACK_IMAGES[category];
  }
  return DEFAULT_FALLBACK;
}

const categoryToOlaType: Record<string, string> = {
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
  const apiKey = getOlaApiKey();
  const isPlaceholder = !apiKey || apiKey === 'placeholder_ola_maps_key' || apiKey.includes('placeholder');

  if (isPlaceholder || isOlaPlacesDisabled) {
    return [];
  }

  const type = categoryToOlaType[category] || 'restaurant';
  const url = `${OLA_BASE_URL}/places/v1/nearbysearch?layers=venue&types=${type}&location=${lat},${lng}&radius=${radiusMeters}&api_key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 
          'X-Request-Id': `hangoutt-nearby-${Date.now()}`,
          'Referer': 'http://localhost:3000',
          'Origin': 'http://localhost:3000'
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.warn(`Ola nearbysearch returned ${res.status} for category ${category}`);
      return [];
    }

    const data = await res.json() as any;
    return data?.predictions || data?.results || [];
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn(`Ola Nearby Search request aborted (timeout) for category ${category}.`);
    } else {
      console.error(`Ola Nearby Search failed for category ${category}:`, err);
    }
    return [];
  }
}

export async function getVenueDetails(placeId: string): Promise<any> {
  const apiKey = getOlaApiKey();
  const isPlaceholder = !apiKey || apiKey === 'placeholder_ola_maps_key' || apiKey.includes('placeholder');

  if (isPlaceholder || isOlaPlacesDisabled) {
    return {};
  }

  const url = `${OLA_BASE_URL}/places/v1/details?place_id=${encodeURIComponent(placeId)}&api_key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      headers: {
        'X-Request-Id': `hangoutt-details-${Date.now()}`,
        'Referer': 'http://localhost:3000',
        'Origin': 'http://localhost:3000',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`Ola details returned ${res.status} for place_id="${placeId}"`);
      return {};
    }

    const data = await res.json() as any;
    return data?.result || {};
  } catch (err) {
    console.error(`Ola Details failed for place_id="${placeId}":`, err);
    return {};
  }
}

export async function searchTextVenues(query: string): Promise<any[]> {
  const apiKey = getOlaApiKey();
  const isPlaceholder = !apiKey || apiKey === 'placeholder_ola_maps_key' || apiKey.includes('placeholder');

  if (isPlaceholder || isOlaPlacesDisabled) {
    return [];
  }

  const url = `${OLA_BASE_URL}/places/v1/textsearch?input=${encodeURIComponent(query)}&api_key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      headers: {
        'X-Request-Id': `hangoutt-text-${Date.now()}`,
        'Referer': 'http://localhost:3000',
        'Origin': 'http://localhost:3000',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`Ola textsearch returned ${res.status} for query "${query}"`);
      return [];
    }

    const data = await res.json() as any;
    return data?.predictions || data?.results || [];
  } catch (err) {
    console.error(`Ola Text Search failed for query "${query}":`, err);
    return [];
  }
}
