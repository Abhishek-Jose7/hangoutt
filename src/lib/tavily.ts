import type { Place, Mood } from '@/types';
import { cacheGet, cacheSet } from './redis';
import { getBudgetLabel } from './budget';
import { getCuratedVenues } from './venue-catalog';
import { searchTypesensePlaces } from './typesense';

type TavilyResult = { title: string; content: string; url: string; score: number };

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
    const typesensePlaces = await searchTypesensePlaces(hubName, mood, avgBudget);

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      console.warn('[Tavily] No API key — using OSM fallback');
      const fallback = await overpassFallback(hubName, hubLocation.lat, hubLocation.lng);
      const dynamicOnly = dedupePlaces([...typesensePlaces, ...fallback]);
      const filled = dynamicOnly.length >= 6
        ? dynamicOnly
        : dedupePlaces([...dynamicOnly, ...curatedPlaces]);
      return filled;
    }

    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });
    const moodActivityTerms: Record<Mood, string> = {
      fun: 'arcade, standup comedy, live gig, social games, karaoke, bowling',
      chill: 'promenade walk, pottery workshop, board games, art gallery, scenic stroll',
      romantic: 'sunset walk, couple activity, aesthetic experience, art date, live jazz',
      adventure: 'trampoline park, bowling, escape room, go-karting, climbing, action activity',
    };
    const moodEateryTerms: Record<Mood, string> = {
      fun: 'trending cafes, lively restaurants, social food places',
      chill: 'calm cafe, brunch, cozy coffee places, quiet restaurants',
      romantic: 'fancy lunch, date-night restaurant, dessert spots, ice cream parlour',
      adventure: 'budget meals, quick-service food, post-activity meal spots',
    };

    const activityQuery = `top rated activities and events happening today near ${hubName} Mumbai for ${mood} mood, ${moodActivityTerms[mood]}, include only real venue names with timings and avoid listicles`;
    const eateryQuery = `top rated cafes and restaurants open today near ${hubName} Mumbai for ${mood} mood, ${moodEateryTerms[mood]}, budget ${budgetLabel}, include real venue names and approximate per-person cost`;

    const [activityResponse, eateryResponse] = await Promise.all([
      client.search(activityQuery, { maxResults: 10, searchDepth: 'basic' }),
      client.search(eateryQuery, { maxResults: 10, searchDepth: 'basic' }),
    ]);

    const activityPlaces = parseTavilyPlaces(activityResponse.results || [], 'activity', avgBudget);
    const eateryPlaces = parseTavilyPlaces(eateryResponse.results || [], 'eatery', avgBudget);
    const tavilyPlaces = prioritizeDynamicPlaces([...typesensePlaces, ...activityPlaces, ...eateryPlaces], avgBudget, mood);

    const osmPlaces = await overpassFallback(hubName, hubLocation.lat, hubLocation.lng);
    const dynamicOnly = dedupePlaces([...tavilyPlaces, ...osmPlaces]);
    const merged = (dynamicOnly.length >= 6
      ? dynamicOnly
      : dedupePlaces([...dynamicOnly, ...curatedPlaces]));

    const places = merged.length > 0 ? merged : getDefaultPlaces(hubName);

    await cacheSet(cacheKey, places, 86400); // 24h TTL
    return places;
  } catch (err) {
    console.error('[Tavily] Search error:', err);
    const fallback = await overpassFallback(hubName, hubLocation.lat, hubLocation.lng);
    const typesensePlaces = await searchTypesensePlaces(hubName, mood, avgBudget);
    const dynamicOnly = dedupePlaces([...typesensePlaces, ...fallback]);
    const filled = dynamicOnly.length >= 4
      ? dynamicOnly
      : dedupePlaces([...dynamicOnly, ...getCuratedVenues(hubName, hubLocation, mood, avgBudget, 12)]);
    return filled;
  }
}

function parseTavilyPlaces(results: TavilyResult[], intent: 'activity' | 'eatery', avgBudget: number): Place[] {
  return results
    .map((r: TavilyResult, i: number) => {
      const candidateName = cleanPlaceName(r.title || `Place ${i + 1}`);
      const normalizedText = `${r.title} ${r.content}`;
      const costGuess = extractCostEstimate(normalizedText);
      const ratingBoost = extractRatingBoost(normalizedText);
      const inferredRating = extractRatingValue(normalizedText);
      const inferredType = inferPlaceType(r.title, r.content);

      const type = intent === 'eatery'
        ? (inferredType === 'activity' || inferredType === 'outdoor' ? 'restaurant' : inferredType)
        : (inferredType === 'cafe' || inferredType === 'restaurant' ? 'activity' : inferredType);

      return {
        name: candidateName,
        type,
        description: (r.content || '').slice(0, 220),
        source: 'tavily' as const,
        relevance_score: Math.min(1, (r.score || 0.5) + ratingBoost),
        url: r.url,
        inferred_rating: inferredRating,
        estimated_cost: costGuess,
      } satisfies Place;
    })
    .filter((p) => isSpecificVenueName(p.name) && !looksLikeSearchResult(p.name, p.description, p.url))
    .filter((p) => (intent === 'activity' ? !looksLikeGenericTicketedActivityLabel(p.name) : true));
}

function enforceEateryQualityThreshold(places: Place[]): Place[] {
  const eateries = places.filter((p) => p.type === 'restaurant' || p.type === 'cafe');
  const highQuality = eateries.filter((p) => (p.inferred_rating ?? 0) >= 4.0);

  if (highQuality.length === 0) return places;

  const highQualityNames = new Set(highQuality.map((p) => p.name));
  return places.filter((p) => {
    if (p.type !== 'restaurant' && p.type !== 'cafe') return true;
    return highQualityNames.has(p.name);
  });
}

function prioritizeDynamicPlaces(places: Place[], avgBudget: number, mood: Mood): Place[] {
  const eateryMoodBonus: Record<Mood, string[]> = {
    fun: ['social', 'lively', 'trending', 'music'],
    chill: ['calm', 'quiet', 'cozy', 'brunch'],
    romantic: ['romantic', 'date', 'dessert', 'ice cream', 'aesthetic', 'fancy'],
    adventure: ['quick', 'budget', 'fast', 'post activity'],
  };

  const ranked = [...places].map((place) => {
    const text = `${place.name} ${place.description}`.toLowerCase();
    const isEatery = place.type === 'cafe' || place.type === 'restaurant';
    const budget = place.estimated_cost ?? defaultEstimatedCost(place.type, avgBudget);
    const budgetFit = budget <= avgBudget ? 1 : Math.max(0.25, 1 - (budget - avgBudget) / Math.max(avgBudget, 1));
    const moodHit = eateryMoodBonus[mood].some((k) => text.includes(k)) ? 1 : 0;
    const eateryBoost = isEatery ? 0.1 : 0;
    const ratingSignal = Math.min(1, (place.inferred_rating ?? 0) / 5);
    const adventureTicketedBoost =
      mood === 'adventure' && isTicketedActivityPlace(place)
        ? 0.18
        : 0;
    const score =
      place.relevance_score * 0.5 +
      budgetFit * 0.22 +
      moodHit * 0.08 +
      eateryBoost +
      ratingSignal * 0.1 +
      adventureTicketedBoost;
    return { place, score };
  });

  ranked.sort((a, b) => b.score - a.score);
  return enforceEateryQualityThreshold(ranked.map((r) => r.place));
}

function looksLikeGenericTicketedActivityLabel(name: string): boolean {
  const lowered = name.toLowerCase().trim();
  const genericOnly = [
    'bowling',
    'escape room',
    'trampoline park',
    'arcade',
    'gaming zone',
    'go karting',
  ];

  if (genericOnly.includes(lowered)) return true;

  // Ticketed labels should generally have a venue token with location or brand.
  if (/(bowling|escape|trampoline|arcade|go kart)/i.test(lowered)) {
    const hasVenueHint = /(mall|marketcity|palacio|smaaash|bounce|mumbai|andheri|bandra|kurla|powai|malad|phoenix)/i.test(lowered);
    return !hasVenueHint;
  }

  return false;
}

function isTicketedActivityPlace(place: Place): boolean {
  if (place.type !== 'activity') return false;
  const text = `${place.name} ${place.description}`.toLowerCase();
  return /(ticket|book|slot|session|trampoline|bounce|bowling|escape room|arcade|go kart)/i.test(text);
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

  if (/[.!?]/.test(name) && name.split(' ').length > 6) return false;
  if (/\b(get ready|celebrating|happening today|book now|limited seats)\b/i.test(lowered)) return false;

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
    'activity spot',
    'food court',
    'promenade',
  ];

  if (genericPatterns.some((pattern) => lowered.includes(pattern))) {
    return false;
  }

  const words = lowered.split(/\s+/).filter(Boolean);
  if (words.length > 9 && /\b(best|top|places|things|guide|visit)\b/.test(lowered)) {
    return false;
  }

  if (!/[a-z]/i.test(name)) return false;

  if (/\b(food court|activity spot|promenade)\b/i.test(lowered)) {
    const allowNamedPromenade = /(marine drive|carter road)/i.test(lowered);
    if (!allowNamedPromenade) return false;
  }

  return true;
}

function looksLikeSearchResultWithUrl(text: string, url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return /\b(best|top|guide|list|ranking|review|reviews|near|visit|places|things)\b/.test(text)
    || text.includes('justdial')
    || text.includes('tripadvisor')
    || text.includes('wanderlog')
    || text.includes('thrillophilia')
    || text.includes('google maps')
    || text.includes('blog')
    || text.includes('permanently closed')
    || text.includes('temporarily closed')
    || text.includes('closed today')
    || lowerUrl.includes('tripadvisor')
    || lowerUrl.includes('wanderlog')
    || lowerUrl.includes('thrillophilia')
    || lowerUrl.includes('justdial')
    || lowerUrl.includes('zomato')
    || lowerUrl.includes('bookmyshow/event/venues');
}

function looksLikeSearchResult(name: string, description: string, url?: string): boolean {
  const text = `${name} ${description}`.toLowerCase();
  return looksLikeSearchResultWithUrl(text, url || '');
}

function extractRatingBoost(text: string): number {
  const raw = extractRatingValue(text);
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  if (raw >= 4.7) return 0.2;
  if (raw >= 4.4) return 0.16;
  if (raw >= 4.1) return 0.12;
  if (raw >= 3.8) return 0.08;
  return 0.03;
}

function extractRatingValue(text: string): number | undefined {
  const ratingMatch = text.match(/\b([3-5](?:\.[0-9])?)\s*\/?\s*5\b|\b([3-5](?:\.[0-9])?)\s*stars?\b/i);
  if (!ratingMatch) return undefined;
  const raw = Number(ratingMatch[1] || ratingMatch[2]);
  if (!Number.isFinite(raw)) return undefined;
  return Math.min(5, Math.max(0, raw));
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
      estimated_cost: undefined,
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
  const key = hubName.toLowerCase();
  if (key.includes('bandra')) {
    return [
      { name: 'Candies, Bandra', type: 'cafe', description: 'Popular all-day cafe for group meetups.', source: 'osm_fallback', relevance_score: 0.94, estimated_cost: 350, inferred_rating: 4.4 },
      { name: 'The Game Palacio, High Street Phoenix', type: 'activity', description: 'Ticketed bowling and arcade experience.', source: 'osm_fallback', relevance_score: 0.92, estimated_cost: 900, inferred_rating: 4.5 },
      { name: 'Bastian, Bandra', type: 'restaurant', description: 'High-rated dining option for curated meals.', source: 'osm_fallback', relevance_score: 0.9, estimated_cost: 1200, inferred_rating: 4.4 },
    ];
  }
  if (key.includes('andheri')) {
    return [
      { name: 'Mystery Rooms Andheri', type: 'activity', description: 'Ticketed escape room in Andheri West.', source: 'osm_fallback', relevance_score: 0.94, estimated_cost: 950, inferred_rating: 4.5 },
      { name: 'McDonald\'s Andheri West', type: 'restaurant', description: 'Reliable budget-friendly post-activity meal.', source: 'osm_fallback', relevance_score: 0.84, estimated_cost: 230, inferred_rating: 4.1 },
      { name: 'Prithvi Cafe', type: 'cafe', description: 'Known cafe with strong ambience and quality.', source: 'osm_fallback', relevance_score: 0.93, estimated_cost: 320, inferred_rating: 4.5 },
    ];
  }
  if (key.includes('kurla')) {
    return [
      { name: 'Snow World Mumbai, Phoenix Marketcity Kurla', type: 'activity', description: 'Ticketed indoor snow attraction at Phoenix Marketcity.', source: 'osm_fallback', relevance_score: 0.88, estimated_cost: 1200, inferred_rating: 4.2 },
      { name: 'PizzaExpress, Phoenix Marketcity Kurla', type: 'restaurant', description: 'Mall-based rated meal stop in Kurla.', source: 'osm_fallback', relevance_score: 0.86, estimated_cost: 650, inferred_rating: 4.2 },
      { name: 'Starbucks, Phoenix Marketcity Kurla', type: 'cafe', description: 'Popular coffee stop with consistent quality.', source: 'osm_fallback', relevance_score: 0.82, estimated_cost: 350, inferred_rating: 4.2 },
    ];
  }

  return [
    { name: 'Leopold Cafe, Colaba', type: 'cafe', description: 'Historic cafe with dependable crowd vibe.', source: 'osm_fallback', relevance_score: 0.86, estimated_cost: 400, inferred_rating: 4.1 },
    { name: 'SMAAASH Lower Parel (Kamala Mills)', type: 'activity', description: 'Ticketed bowling and arcade zone.', source: 'osm_fallback', relevance_score: 0.93, estimated_cost: 850, inferred_rating: 4.4 },
    { name: 'Social, Lower Parel', type: 'restaurant', description: 'Popular rated social dining space.', source: 'osm_fallback', relevance_score: 0.86, estimated_cost: 650, inferred_rating: 4.2 },
  ];
}
