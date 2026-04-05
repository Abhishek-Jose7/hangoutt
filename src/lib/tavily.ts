import type { Place, Mood } from '@/types';
import { cacheGet, cacheSet } from './redis';
import { getBudgetLabel } from './budget';

/**
 * Search for places near a hub using Tavily
 */
export async function searchPlaces(
  hubName: string,
  mood: Mood,
  avgBudget: number
): Promise<Place[]> {
  const budgetLabel = getBudgetLabel(avgBudget);
  const slug = hubName.toLowerCase().replace(/\s+/g, '_');
  const cacheKey = `tavily:v1:${slug}:${mood}:${budgetLabel}`;

  // Check cache first
  const cached = await cacheGet<Place[]>(cacheKey);
  if (cached) return cached;

  try {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      console.warn('[Tavily] No API key — using OSM fallback');
      return overpassFallback(hubName, 0, 0);
    }

    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });
    const query = `${mood} hangout spots near ${hubName} Mumbai under ₹${budgetLabel} per person`;

    const response = await client.search(query, {
      maxResults: 8,
      searchDepth: 'basic',
    });

    const places: Place[] = (response.results || []).map((r: { title: string; content: string; url: string; score: number }, i: number) => ({
      name: r.title || `Place ${i + 1}`,
      type: inferPlaceType(r.title, r.content),
      description: (r.content || '').slice(0, 200),
      source: 'tavily' as const,
      relevance_score: r.score || 0.5,
      url: r.url,
    }));

    await cacheSet(cacheKey, places, 86400); // 24h TTL
    return places;
  } catch (err) {
    console.error('[Tavily] Search error:', err);
    return overpassFallback(hubName, 0, 0);
  }
}

/**
 * Infer place type from title and description
 */
function inferPlaceType(
  title: string,
  description: string
): Place['type'] {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes('cafe') || text.includes('coffee') || text.includes('brunch') || text.includes('bakery'))
    return 'cafe';
  if (text.includes('restaurant') || text.includes('dining') || text.includes('food') || text.includes('cuisine'))
    return 'restaurant';
  if (text.includes('park') || text.includes('beach') || text.includes('garden') || text.includes('promenade'))
    return 'outdoor';
  return 'activity';
}

/**
 * OSM Overpass API fallback
 */
async function overpassFallback(
  hubName: string,
  hubLat: number,
  hubLng: number
): Promise<Place[]> {
  try {
    // Use a known lat/lng for popular areas if hub coords are missing
    const areaCoords: Record<string, { lat: number; lng: number }> = {
      Bandra: { lat: 19.0544, lng: 72.8406 },
      'Lower Parel': { lat: 19.0, lng: 72.827 },
      Andheri: { lat: 19.1197, lng: 72.8461 },
      Dadar: { lat: 19.0178, lng: 72.8422 },
      Churchgate: { lat: 18.9322, lng: 72.8264 },
      Kurla: { lat: 19.0711, lng: 72.8792 },
      CSMT: { lat: 18.94, lng: 72.8356 },
    };

    const coords = hubLat && hubLng
      ? { lat: hubLat, lng: hubLng }
      : areaCoords[hubName] || { lat: 19.076, lng: 72.8777 };

    const query = `[out:json];node["amenity"~"restaurant|cafe|bar"]["name"](around:2000,${coords.lat},${coords.lng});out 10;`;
    const response = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
    );

    if (!response.ok) return getDefaultPlaces(hubName);

    const data = await response.json();
    const elements = data.elements || [];

    return elements.map((el: { tags?: { name?: string; amenity?: string }; lat?: number; lon?: number }, i: number) => ({
      name: el.tags?.name || `Place ${i + 1}`,
      type: el.tags?.amenity === 'cafe' ? 'cafe' as const : 'restaurant' as const,
      lat: el.lat,
      lng: el.lon,
      description: `${el.tags?.amenity || 'venue'} near ${hubName}`,
      source: 'osm_fallback' as const,
      relevance_score: 0.5,
    }));
  } catch {
    return getDefaultPlaces(hubName);
  }
}

/**
 * Hardcoded fallback when all APIs fail
 */
function getDefaultPlaces(hubName: string): Place[] {
  return [
    {
      name: `${hubName} Café`,
      type: 'cafe',
      description: `A popular café in the ${hubName} area`,
      source: 'osm_fallback',
      relevance_score: 0.4,
    },
    {
      name: `${hubName} Street Food`,
      type: 'restaurant',
      description: `Street food options near ${hubName} station`,
      source: 'osm_fallback',
      relevance_score: 0.4,
    },
    {
      name: `${hubName} Park`,
      type: 'outdoor',
      description: `Green space near ${hubName}`,
      source: 'osm_fallback',
      relevance_score: 0.3,
    },
    {
      name: `${hubName} Entertainment Zone`,
      type: 'activity',
      description: `Entertainment options near ${hubName}`,
      source: 'osm_fallback',
      relevance_score: 0.3,
    },
  ];
}
