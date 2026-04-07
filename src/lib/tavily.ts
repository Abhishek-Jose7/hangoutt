import type { Mood, Place } from '@/types';
import { cacheGet, cacheSet } from './redis';
import { haversineDistance } from './transit';

type TavilyResult = { title: string; content: string; url: string; score: number };
type OsmElement = {
  tags?: Record<string, string | undefined>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
};

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSpecificVenueName(name: string): boolean {
  const lowered = normalizeText(name);
  if (name.trim().length < 3) return false;

  const blocked = [
    'best places',
    'top places',
    'things to do',
    'places to visit',
    'near me',
    'justdial',
    'tripadvisor',
    'wanderlog',
    'thrillophilia',
    'zomato',
  ];

  return !blocked.some((term) => lowered.includes(term));
}

function inferTypeFromTags(tags: Record<string, string | undefined>): Place['type'] {
  const amenity = (tags.amenity || '').toLowerCase();
  const leisure = (tags.leisure || '').toLowerCase();
  const tourism = (tags.tourism || '').toLowerCase();

  if (amenity === 'cafe' || amenity === 'ice_cream') return 'cafe';
  if (amenity === 'restaurant' || amenity === 'fast_food') return 'restaurant';
  if (leisure === 'park' || leisure === 'garden' || leisure === 'nature_reserve' || tourism === 'viewpoint') return 'outdoor';

  if (
    amenity === 'cinema' ||
    leisure === 'sports_centre' ||
    leisure === 'pitch' ||
    leisure === 'escape_game' ||
    leisure === 'bowling_alley' ||
    leisure === 'amusement_arcade' ||
    tourism === 'attraction' ||
    tourism === 'museum' ||
    tourism === 'gallery' ||
    tourism === 'theme_park'
  ) {
    return 'activity';
  }

  return 'activity';
}

function defaultEstimatedCost(type: Place['type'], budget: number): number {
  const cap = Math.max(200, budget);
  const defaults: Record<Place['type'], number> = {
    cafe: Math.round(cap * 0.28),
    activity: Math.round(cap * 0.36),
    restaurant: Math.round(cap * 0.4),
    outdoor: Math.round(cap * 0.12),
  };
  return defaults[type];
}

function dedupePlaces(places: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];

  for (const place of places) {
    const key = normalizeText(place.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }

  return out;
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

function extractSnippet(text: string, fallback: string): string {
  const sentence = text
    .replace(/\s+/g, ' ')
    .split(/[.!?]/)
    .map((part) => part.trim())
    .find((part) => part.length > 12);

  if (!sentence) return fallback;
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence;
}

function pickBestResultForPlace(placeName: string, results: TavilyResult[]): TavilyResult | null {
  const nameTokens = normalizeText(placeName)
    .split(' ')
    .filter((token) => token.length >= 3);

  let best: TavilyResult | null = null;
  let bestScore = 0;

  for (const result of results) {
    const text = normalizeText(`${result.title} ${result.content}`);
    const overlap = nameTokens.filter((token) => text.includes(token)).length;
    const score = overlap / Math.max(nameTokens.length, 1);

    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  return bestScore >= 0.45 ? best : null;
}

async function enrichPlacesWithTavilyHints(
  places: Place[],
  hubName: string,
  mood: Mood
): Promise<Place[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || places.length === 0) return places;

  try {
    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });
    const shortlist = places.slice(0, 14);
    const query = `For each exact venue in ${hubName}, Mumbai (${shortlist
      .map((p) => `"${p.name}"`)
      .join(', ')}), return short factual vibe hints and approximate per-person cost for ${mood} mood.`;

    const response = await client.search(query, {
      maxResults: 16,
      searchDepth: 'basic',
    });

    const results = (response.results || []) as TavilyResult[];
    if (!results.length) return places;

    return places.map((place) => {
      const best = pickBestResultForPlace(place.name, results);
      if (!best) return place;

      const text = `${best.title} ${best.content}`;
      return {
        ...place,
        description: extractSnippet(text, place.description),
        inferred_rating: place.inferred_rating ?? extractRatingValue(text),
        estimated_cost: place.estimated_cost ?? extractCostEstimate(text),
      };
    });
  } catch {
    return places;
  }
}

function scorePlaceForMood(place: Place, mood: Mood, perPersonCap: number): number {
  const text = normalizeText(`${place.name} ${place.description}`);
  const budget = place.estimated_cost ?? defaultEstimatedCost(place.type, perPersonCap);
  const budgetFit = budget <= perPersonCap
    ? 1
    : Math.max(0.2, 1 - (budget - perPersonCap) / Math.max(perPersonCap, 1));

  const moodTokens: Record<Mood, string[]> = {
    fun: ['arcade', 'social', 'lively', 'music', 'games'],
    chill: ['calm', 'cozy', 'walk', 'relax', 'quiet'],
    romantic: ['date', 'sunset', 'dessert', 'romantic', 'aesthetic'],
    adventure: ['escape', 'bowling', 'trampoline', 'thrill', 'action'],
  };

  const moodTypeBoost: Record<Mood, Record<Place['type'], number>> = {
    fun: { cafe: 0.72, activity: 1, restaurant: 0.74, outdoor: 0.62 },
    chill: { cafe: 1, activity: 0.65, restaurant: 0.72, outdoor: 0.9 },
    romantic: { cafe: 0.82, activity: 0.66, restaurant: 1, outdoor: 0.78 },
    adventure: { cafe: 0.56, activity: 1, restaurant: 0.68, outdoor: 0.88 },
  };

  const moodHits = moodTokens[mood].filter((token) => text.includes(token)).length;
  const moodScore = Math.min(1, moodHits / 2) * 0.55 + moodTypeBoost[mood][place.type] * 0.45;
  const ratingScore = place.inferred_rating ? Math.min(1, Math.max(0, (place.inferred_rating - 3) / 2)) : 0.5;

  return place.relevance_score * 0.45 + budgetFit * 0.25 + moodScore * 0.2 + ratingScore * 0.1;
}

function selectBalancedTopPlaces(places: Place[]): Place[] {
  const quotas: Record<Place['type'], number> = {
    activity: 6,
    restaurant: 5,
    cafe: 5,
    outdoor: 4,
  };

  const selected: Place[] = [];
  for (const type of ['activity', 'restaurant', 'cafe', 'outdoor'] as Place['type'][]) {
    const typed = places.filter((place) => place.type === type).slice(0, quotas[type]);
    selected.push(...typed);
  }

  if (selected.length >= 10) return selected;

  for (const place of places) {
    if (selected.some((picked) => normalizeText(picked.name) === normalizeText(place.name))) continue;
    selected.push(place);
    if (selected.length >= 14) break;
  }

  return selected;
}

async function fetchStructuredOsmPlaces(
  hubName: string,
  hubLocation: { lat: number; lng: number },
  avgBudget: number
): Promise<Place[]> {
  const query = `[out:json][timeout:30];(
    nwr["amenity"~"cafe|restaurant|fast_food|ice_cream|cinema"]["name"](around:3200,${hubLocation.lat},${hubLocation.lng});
    nwr["leisure"~"park|garden|nature_reserve|sports_centre|pitch|escape_game|bowling_alley|amusement_arcade"]["name"](around:3200,${hubLocation.lat},${hubLocation.lng});
    nwr["tourism"~"attraction|museum|gallery|theme_park|viewpoint"]["name"](around:3200,${hubLocation.lat},${hubLocation.lng});
  );out center 160;`;

  const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
  if (!response.ok) return [];

  const data = await response.json();
  const elements = (data.elements || []) as OsmElement[];

  const places = elements
    .map((element): Place | null => {
      const tags = element.tags || {};
      const name = (tags.name || '').trim();
      const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat;
      const lng = typeof element.lon === 'number' ? element.lon : element.center?.lon;

      if (!name || typeof lat !== 'number' || typeof lng !== 'number') return null;
      if (!isSpecificVenueName(name)) return null;

      const type = inferTypeFromTags(tags);
      const distanceKm = haversineDistance(hubLocation, { lat, lng });
      const relevance = Math.max(0.2, 1 - distanceKm / 5);
      const detail = tags.cuisine || tags.leisure || tags.tourism || tags.amenity || 'venue';
      const place: Place = {
        name,
        type,
        lat,
        lng,
        description: detail + ' near ' + hubName,
        estimated_cost: defaultEstimatedCost(type, avgBudget),
        source: 'osm_fallback',
        relevance_score: Math.round(relevance * 100) / 100,
      };

      return place;
    })
    .filter((place): place is Place => place !== null);

  return dedupePlaces(places);
}

/**
 * Data pipeline (OSM-only for place sourcing):
 * 1) Fetch real nearby places from OSM around hub centroid.
 * 2) Optionally enrich existing places with Tavily hints (never add new places).
 * 3) Rank by budget, mood, and proximity with type variety constraints.
 */
export async function searchPlaces(
  hubName: string,
  hubLocation: { lat: number; lng: number },
  mood: Mood,
  avgBudget: number
): Promise<Place[]> {
  const slug = hubName.toLowerCase().replace(/\s+/g, '_');
  const cacheKey = `places_pipeline:v3:${slug}:${mood}:${Math.round(avgBudget / 50) * 50}`;

  const cached = await cacheGet<Place[]>(cacheKey);
  if (cached) return cached;

  try {
    const osmPlaces = await fetchStructuredOsmPlaces(hubName, hubLocation, avgBudget);
    if (osmPlaces.length === 0) {
      console.warn(`[PlacePipeline] OSM returned no places for hub ${hubName}`);
      return [];
    }

    const enrichedPlaces = await enrichPlacesWithTavilyHints(osmPlaces, hubName, mood);
    const ranked = [...enrichedPlaces]
      .map((place) => ({ place, score: scorePlaceForMood(place, mood, avgBudget) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.place);

    const balanced = selectBalancedTopPlaces(ranked);
    const finalPlaces = dedupePlaces(balanced);

    await cacheSet(cacheKey, finalPlaces, 60 * 60); // 1 hour TTL
    return finalPlaces;
  } catch (err) {
    console.error('[PlacePipeline] searchPlaces failed:', err);
    return [];
  }
}
