import 'server-only';
import { VenueCategory } from '../types/planner.types';

const OLA_MAPS_API_KEY = process.env.OLA_MAPS_API_KEY;
const OLA_BASE_URL = 'https://api.olamaps.io';

// Category-based Unsplash fallback images (used when Ola Places has no photo)
const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  'CAFE': 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=600&q=80',
  'RESTAURANT': 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80',
  'DESSERT': 'https://images.unsplash.com/photo-1495147400078-be7375268b54?auto=format&fit=crop&w=600&q=80',
  'PARK': 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=600&q=80',
  'ARCADE': 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=600&q=80',
  'BOWLING': 'https://images.unsplash.com/photo-1538510105562-aa60003bcbb1?auto=format&fit=crop&w=600&q=80',
  'ESCAPE_ROOM': 'https://images.unsplash.com/photo-1519074069444-1ba4ae164338?auto=format&fit=crop&w=600&q=80',
  'POTTERY': 'https://images.unsplash.com/photo-1565192647048-f997ded879ab?auto=format&fit=crop&w=600&q=80',
  'LIVE_MUSIC': 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=600&q=80',
};
const DEFAULT_FALLBACK = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80';

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
export async function getVenueImageUrl(
  venueName: string,
  city: string,
  category?: string
): Promise<string> {
  const apiKey = OLA_MAPS_API_KEY;
  const isPlaceholder = !apiKey || apiKey === 'placeholder_ola_maps_key' || apiKey.includes('placeholder');

  if (isPlaceholder) {
    return getCategoryFallback(category);
  }

  try {
    // Step 1: Text Search to find the place_id
    const searchQuery = `${venueName} ${city}`;
    const searchUrl = `${OLA_BASE_URL}/places/v1/textsearch?input=${encodeURIComponent(searchQuery)}&api_key=${apiKey}`;

    const searchRes = await fetch(searchUrl, {
      headers: { 'X-Request-Id': `hangoutt-${Date.now()}` },
    });

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

    const detailsRes = await fetch(detailsUrl, {
      headers: { 'X-Request-Id': `hangoutt-details-${Date.now()}` },
    });

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
  } catch (err) {
    console.error(`Ola Places photo resolution failed for "${venueName}":`, err);
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
