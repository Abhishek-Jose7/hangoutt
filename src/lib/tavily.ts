import type { Place, Mood } from '@/types';
import { cacheGet, cacheSet } from './redis';
import { getBudgetLabel } from './budget';
import { getCuratedVenues } from './venue-catalog';

/**
 * Search for places near a hub using Tavily
 */
export async function searchPlaces(
  hubName: string,
  hubLocation: { lat: number; lng: number },
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
    const curatedPlaces = getCuratedVenues(hubName, hubLocation, mood, avgBudget, 12);

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      console.warn('[Tavily] No API key — using OSM fallback');
      const fallback = await overpassFallback(hubName, hubLocation.lat, hubLocation.lng);
      const dynamicOnly = dedupePlaces([...fallback]);
      const filled = dynamicOnly.length >= 6
        ? dynamicOnly
        : dedupePlaces([...dynamicOnly, ...curatedPlaces]);
      return filled.map((place) => ({
        ...place,
        estimated_cost: place.estimated_cost || defaultEstimatedCost(place.type, avgBudget),
      }));
    }

    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });
    const moodTerms: Record<Mood, string> = {
      fun: 'arcade, bowling, social cafe, live events, high-energy activities',
      chill: 'quiet cafe, scenic walk, board games cafe, peaceful hangout spots',
      romantic: 'date cafe, sunset point, romantic restaurants, cozy activities',
      adventure: 'escape room, sports activity, climbing, experiential places',
    };
    const query = `specific cafe and activity venues open today for ${mood} hangout near ${hubName} Mumbai, ${moodTerms[mood]}, budget ${budgetLabel}, include real place names and avoid listicles`;

    const response = await client.search(query, {
      maxResults: 10,
      searchDepth: 'basic',
    });

    const tavilyPlaces: Place[] = (response.results || [])
      .map((r: { title: string; content: string; url: string; score: number }, i: number) => {
        const candidateName = cleanPlaceName(r.title || `Place ${i + 1}`);
        const costGuess = extractCostEstimate(`${r.title} ${r.content}`);

        return {
          name: candidateName,
          type: inferPlaceType(r.title, r.content),
          description: (r.content || '').slice(0, 220),
          source: 'tavily' as const,
          relevance_score: r.score || 0.5,
          url: r.url,
          estimated_cost: costGuess,
        } satisfies Place;
      })
      .filter((p) => isSpecificVenueName(p.name) && !looksLikeSearchResult(p.name, p.description));

    const osmPlaces = await overpassFallback(hubName, hubLocation.lat, hubLocation.lng);
    const dynamicOnly = dedupePlaces([...tavilyPlaces, ...osmPlaces]);
    const merged = (dynamicOnly.length >= 6
      ? dynamicOnly
      : dedupePlaces([...dynamicOnly, ...curatedPlaces]))
      .map((place) => ({
      ...place,
      estimated_cost: place.estimated_cost || defaultEstimatedCost(place.type, avgBudget),
    }));

    const places = merged.length > 0 ? merged : getDefaultPlaces(hubName);

    await cacheSet(cacheKey, places, 86400); // 24h TTL
    return places;
  } catch (err) {
    console.error('[Tavily] Search error:', err);
    const fallback = await overpassFallback(hubName, hubLocation.lat, hubLocation.lng);
    const dynamicOnly = dedupePlaces([...fallback]);
    const filled = dynamicOnly.length >= 4
      ? dynamicOnly
      : dedupePlaces([...dynamicOnly, ...getCuratedVenues(hubName, hubLocation, mood, avgBudget, 12)]);
    return filled.map((place) => ({
      ...place,
      estimated_cost: place.estimated_cost || defaultEstimatedCost(place.type, avgBudget),
    }));
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

function cleanPlaceName(raw: string): string {
  const withoutPipe = raw.split('|')[0]?.trim() || raw;
  return withoutPipe
    .replace(/^[0-9]+\.?\s*/g, '')
    .replace(/^(best|top|ultimate)\s+/i, '')
    .replace(/\s+in\s+mumbai.*$/i, '')
    .trim();
}

function isSpecificVenueName(name: string): boolean {
  const lowered = name.toLowerCase();
  if (name.length < 3) return false;

  const genericPatterns = [
    'best places',
    'top places',
    'places to visit',
    'things to do',
    'top 10',
    'best 10',
    'best 5',
    'top 5',
    'near me',
    'justdial',
    'zomato',
    'tripadvisor',
    'bookmyshow',
    'wanderlog',
    'thrillophilia',
    'lounge bars',
    'best lounge',
    'restaurants in',
    'cafe in',
  ];

  if (genericPatterns.some((pattern) => lowered.includes(pattern))) {
    return false;
  }

  const words = lowered.split(/\s+/).filter(Boolean);
  if (words.length > 9 && /\b(best|top|places|things|guide|visit)\b/.test(lowered)) {
    return false;
  }

  return /[a-z]/i.test(name);
}

function looksLikeSearchResult(name: string, description: string): boolean {
  const text = `${name} ${description}`.toLowerCase();
  return /\b(best|top|guide|list|ranking|review|reviews|near|visit|places|things)\b/.test(text)
    || text.includes('justdial')
    || text.includes('tripadvisor')
    || text.includes('wanderlog')
    || text.includes('thrillophilia')
    || text.includes('google maps')
    || text.includes('blog')
    || text.includes('permanently closed')
    || text.includes('temporarily closed')
    || text.includes('closed today');
}

function extractCostEstimate(text: string): number | undefined {
  const rupeeMatch = text.match(/₹\s?([0-9]{2,5})/);
  if (!rupeeMatch) return undefined;
  const value = Number(rupeeMatch[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.max(value, 80), 3000);
}

function defaultEstimatedCost(type: Place['type'], budget: number): number {
  const cap = Math.max(200, budget);
  const defaults: Record<Place['type'], number> = {
    cafe: Math.round(cap * 0.28),
    activity: Math.round(cap * 0.35),
    restaurant: Math.round(cap * 0.4),
    outdoor: Math.round(cap * 0.12),
  };
  return defaults[type];
}

function dedupePlaces(places: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];

  for (const place of places) {
    const key = place.name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }

  return out;
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

    const query = `[out:json];(
      node["amenity"~"restaurant|cafe|bar|fast_food|ice_cream|food_court"]["name"](around:2200,${coords.lat},${coords.lng});
      node["tourism"~"attraction|museum|gallery|viewpoint"]["name"](around:2200,${coords.lat},${coords.lng});
      node["leisure"~"escape_game|bowling_alley|amusement_arcade|park"]["name"](around:2200,${coords.lat},${coords.lng});
    );out 20;`;
    const response = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
    );

    if (!response.ok) return getDefaultPlaces(hubName);

    const data = await response.json();
    const elements = data.elements || [];

    return elements.map((el: { tags?: { name?: string; amenity?: string; leisure?: string; tourism?: string }; lat?: number; lon?: number }, i: number) => ({
      name: el.tags?.name || `Place ${i + 1}`,
      type: el.tags?.amenity === 'cafe'
        ? 'cafe' as const
        : el.tags?.amenity === 'bar' || el.tags?.amenity === 'restaurant' || el.tags?.amenity === 'fast_food'
        ? 'restaurant' as const
        : el.tags?.amenity === 'ice_cream' || el.tags?.amenity === 'food_court'
        ? 'activity' as const
        : el.tags?.leisure === 'park' || el.tags?.amenity === 'beach' || el.tags?.tourism === 'viewpoint'
        ? 'outdoor' as const
        : el.tags?.leisure === 'escape_game' || el.tags?.leisure === 'bowling_alley' || el.tags?.leisure === 'amusement_arcade'
        ? 'activity' as const
        : 'activity' as const,
      lat: el.lat,
      lng: el.lon,
      description: `${el.tags?.amenity || 'venue'} near ${hubName}`,
      estimated_cost: el.tags?.amenity === 'cafe'
        ? 250
        : el.tags?.amenity === 'restaurant'
        ? 450
        : el.tags?.amenity === 'fast_food'
        ? 220
        : el.tags?.amenity === 'bar'
        ? 500
        : el.tags?.tourism === 'museum' || el.tags?.tourism === 'gallery'
        ? 300
        : el.tags?.leisure === 'bowling_alley' || el.tags?.leisure === 'escape_game' || el.tags?.leisure === 'amusement_arcade'
        ? 600
        : 320,
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
  const areaLabel = hubName || 'the area';
  return [
    {
      name: `${areaLabel} Coffee Bar`,
      type: 'cafe',
      description: `A casual coffee stop near ${areaLabel} for meetups and conversation`,
      source: 'osm_fallback',
      relevance_score: 0.4,
    },
    {
      name: `${areaLabel} Food Court`,
      type: 'restaurant',
      description: `A reliable food stop near ${areaLabel} station`,
      source: 'osm_fallback',
      relevance_score: 0.4,
    },
    {
      name: `${areaLabel} Promenade`,
      type: 'outdoor',
      description: `A scenic walking spot near ${areaLabel}`,
      source: 'osm_fallback',
      relevance_score: 0.3,
    },
    {
      name: `${areaLabel} Activity Spot`,
      type: 'activity',
      description: `A casual hangout activity near ${areaLabel}`,
      source: 'osm_fallback',
      relevance_score: 0.3,
    },
  ];
}
