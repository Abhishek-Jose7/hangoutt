import type { Mood, Place } from '@/types';
import { cacheGet, cacheSet } from './redis';
import { haversineDistance } from './transit';
import { searchTypesensePlaces } from './typesense';

type TavilyResult = { title: string; content: string; url: string; score: number };
type OsmElement = {
  tags?: Record<string, string | undefined>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
};

const VALID_OSM_TYPES = new Set([
  'cafe',
  'restaurant',
  'fast_food',
  'bar',
  'park',
  'garden',
  'mall',
  'cinema',
  'tourist_attraction',
]);

const BLOCKED_KEYWORDS = [
  'bank',
  'atm',
  'office',
  'government',
  'school',
  'hospital',
  'clinic',
  'pharmacy',
  'toilet',
  'fuel',
  'warehouse',
];

const DISALLOWED_AMENITIES = new Set([
  'bank',
  'atm',
  'pharmacy',
  'hospital',
  'clinic',
  'doctors',
  'dentist',
  'school',
  'college',
  'university',
  'police',
  'fire_station',
  'post_office',
  'courthouse',
  'government',
  'bus_station',
  'fuel',
  'parking',
  'toilets',
]);

const MAX_PLACE_DISTANCE_KM = 4;
const PLACE_CONFIDENCE_THRESHOLD = 0.6;
const OVERPASS_TIMEOUT_MS = 12000;
const TAVILY_TIMEOUT_MS = 4500;

const inflightSearches = new Map<string, Promise<Place[]>>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenQuality(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function hasBalancedAlpha(name: string): boolean {
  const compact = name.replace(/\s+/g, '');
  if (!compact) return false;
  const alphaChars = compact.replace(/[^A-Za-z]/g, '').length;
  return alphaChars / compact.length >= 0.55;
}

function looksLikeGarbagePoi(name: string): boolean {
  const lowered = normalizeText(name);
  if (!lowered || lowered.length < 4) return true;

  const genericPatterns = [
    /^unnamed/,
    /^plot\s*\d+/,
    /^shop\s*\d+/,
    /^building\s*\d+/,
    /^gate\s*\d+/,
    /^house\s*\d+/,
    /^flat\s*\d+/,
    /^road\s*\d+/,
    /^lane\s*\d+/,
  ];

  if (genericPatterns.some((pattern) => pattern.test(lowered))) return true;
  if (BLOCKED_KEYWORDS.some((keyword) => lowered.includes(keyword))) return true;
  if (!hasBalancedAlpha(name)) return true;
  if (tokenQuality(name).length < 2) return true;

  return false;
}

function hasBlockedOsmContext(tags: Record<string, string | undefined>, name: string): boolean {
  const amenity = (tags.amenity || '').toLowerCase();
  if (amenity && DISALLOWED_AMENITIES.has(amenity)) return true;

  const blob = normalizeText(
    `${name} ${tags.amenity || ''} ${tags.office || ''} ${tags.building || ''} ${tags.healthcare || ''}`
  );
  return BLOCKED_KEYWORDS.some((keyword) => blob.includes(keyword));
}

function isSpecificVenueName(name: string): boolean {
  if (looksLikeGarbagePoi(name)) return false;

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

  return !blocked.some((term) => normalizeText(name).includes(term));
}

function resolveOsmType(tags: Record<string, string | undefined>): string | null {
  const amenity = (tags.amenity || '').toLowerCase();
  const leisure = (tags.leisure || '').toLowerCase();
  const tourism = (tags.tourism || '').toLowerCase();
  const shop = (tags.shop || '').toLowerCase();

  if (amenity === 'cafe') return 'cafe';
  if (amenity === 'restaurant') return 'restaurant';
  if (amenity === 'fast_food') return 'fast_food';
  if (amenity === 'bar') return 'bar';
  if (leisure === 'park') return 'park';
  if (leisure === 'garden') return 'garden';
  if (shop === 'mall') return 'mall';
  if (amenity === 'cinema') return 'cinema';
  if (tourism === 'attraction') return 'tourist_attraction';

  return null;
}

function mapOsmTypeToPlaceType(osmType: string): Place['type'] {
  if (osmType === 'cafe') return 'cafe';
  if (osmType === 'restaurant' || osmType === 'fast_food' || osmType === 'bar') return 'restaurant';
  if (osmType === 'park' || osmType === 'garden') return 'outdoor';
  return 'activity';
}

function localityMatches(placeArea: string | undefined, hubName: string): boolean {
  if (!placeArea) return false;
  const a = normalizeText(placeArea);
  const b = normalizeText(hubName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const aTokens = new Set(a.split(' ').filter((token) => token.length >= 3));
  const bTokens = b.split(' ').filter((token) => token.length >= 3);
  const overlap = bTokens.filter((token) => aTokens.has(token)).length;
  return overlap >= Math.min(2, bTokens.length);
}

function nameHintsLocality(placeName: string, hubName: string): boolean {
  const n = normalizeText(placeName);
  const h = normalizeText(hubName);
  if (!n || !h) return false;
  if (n.includes(h) || h.includes(n)) return true;

  const hTokens = h.split(' ').filter((token) => token.length >= 4);
  return hTokens.some((token) => n.includes(token));
}

function normalizePopularity(raw: number | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.5;
  return Math.max(0, Math.min(1, raw / 100));
}

function inferOsmPopularity(tags: Record<string, string | undefined>): number {
  let score = 35;
  if (tags.website || tags['contact:website']) score += 18;
  if (tags.phone || tags['contact:phone']) score += 10;
  if (tags.opening_hours) score += 9;
  if (tags.brand || tags.operator) score += 11;
  if (tags.wikidata || tags.wikipedia) score += 14;

  const stars = Number(tags.stars || tags.rating || 0);
  if (Number.isFinite(stars) && stars >= 4) score += 8;

  return Math.max(1, Math.min(100, Math.round(score)));
}

function computePlaceConfidence(place: Place): number {
  const hasRating = typeof place.inferred_rating === 'number' && place.inferred_rating > 0 ? 1 : 0;
  const hasTags = Array.isArray(place.tags) && place.tags.length > 0 ? 1 : 0;
  const nameQuality = isSpecificVenueName(place.name) ? 1 : 0;
  const typeValidity = ['cafe', 'restaurant', 'activity', 'outdoor'].includes(place.type) ? 1 : 0;

  return (hasRating + hasTags + nameQuality + typeValidity) / 4;
}

function passesGeoAndLocality(place: Place, hubName: string, hubLocation: { lat: number; lng: number }): boolean {
  if (typeof place.lat !== 'number' || typeof place.lng !== 'number') return false;
  const distanceKm = haversineDistance(hubLocation, { lat: place.lat, lng: place.lng });
  if (distanceKm > MAX_PLACE_DISTANCE_KM) return false;

  const areaMatch = localityMatches(place.area, hubName);
  const localityMatch = nameHintsLocality(place.name, hubName);
  return areaMatch || localityMatch;
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

function blendOsmAndTypesense(
  osmPlaces: Place[],
  typesensePlaces: Place[],
  hubLocation: { lat: number; lng: number },
  avgBudget: number,
  hubName: string
): Place[] {
  if (typesensePlaces.length === 0) return osmPlaces;

  const osmKeys = new Set(osmPlaces.map((place) => normalizeText(place.name)));
  const enrichedTypesense = typesensePlaces
    .filter((place) => isSpecificVenueName(place.name))
    .filter((place) => passesGeoAndLocality(place, hubName, hubLocation))
    .map((place) => {
      const distanceBoost =
        typeof place.lat === 'number' && typeof place.lng === 'number'
          ? Math.max(0.3, 1 - haversineDistance(hubLocation, { lat: place.lat, lng: place.lng }) / 6)
          : 0.55;
      const budget = place.estimated_cost ?? defaultEstimatedCost(place.type, avgBudget);
      const budgetBoost = budget <= avgBudget ? 1 : Math.max(0.45, 1 - (budget - avgBudget) / Math.max(avgBudget, 1));

      const normalized: Place = {
        ...place,
        source: 'typesense' as const,
        estimated_cost: place.estimated_cost ?? defaultEstimatedCost(place.type, avgBudget),
        relevance_score: Math.min(1, Math.max(place.relevance_score, distanceBoost * 0.6 + budgetBoost * 0.4)),
      };
      const confidence = computePlaceConfidence(normalized);

      return {
        ...normalized,
        confidence_score: confidence,
      };
    })
    .filter((place) => (place.confidence_score || 0) >= PLACE_CONFIDENCE_THRESHOLD)
    .filter((place) => !osmKeys.has(normalizeText(place.name)));

  return dedupePlaces([...osmPlaces, ...enrichedTypesense]);
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

    const response = await withTimeout(
      client.search(query, {
        maxResults: 16,
        searchDepth: 'basic',
      }),
      TAVILY_TIMEOUT_MS
    );

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

function computeVibeAlignment(
  place: Place,
  mood: Mood,
): number {
  const text = normalizeText(`${place.name} ${place.description}`);
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
  return Math.min(1, moodHits / 2) * 0.55 + moodTypeBoost[mood][place.type] * 0.45;
}

function computeHangoutScore(
  place: Place,
  mood: Mood,
  perPersonCap: number,
  hubLocation: { lat: number; lng: number }
): number {
  const budget = place.estimated_cost ?? defaultEstimatedCost(place.type, perPersonCap);
  const budgetFit = budget <= perPersonCap
    ? 1
    : Math.max(0.2, 1 - (budget - perPersonCap) / Math.max(perPersonCap, 1));

  const distanceKm =
    typeof place.lat === 'number' && typeof place.lng === 'number'
      ? haversineDistance(hubLocation, { lat: place.lat, lng: place.lng })
      : MAX_PLACE_DISTANCE_KM;
  const geoDecay = Math.exp(-distanceKm / 2.1);
  const distanceScore = Math.max(0.05, Math.min(1, geoDecay));
  const moodScore = computeVibeAlignment(place, mood);
  const ratingScore = place.inferred_rating ? Math.min(1, Math.max(0, (place.inferred_rating - 3) / 2)) : 0.5;
  const popularityScore = normalizePopularity(place.popularity);
  const confidenceScore = Math.max(0, Math.min(1, place.confidence_score ?? 0.5));

  return (
    distanceScore * 0.45 +
    moodScore * 0.25 +
    (ratingScore * 0.55 + popularityScore * 0.45) * 0.15 +
    confidenceScore * 0.1 +
    budgetFit * 0.05
  );
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
    nwr["amenity"~"cafe|restaurant|fast_food|bar|cinema"]["name"](around:3200,${hubLocation.lat},${hubLocation.lng});
    nwr["leisure"~"park|garden"]["name"](around:3200,${hubLocation.lat},${hubLocation.lng});
    nwr["tourism"="attraction"]["name"](around:3200,${hubLocation.lat},${hubLocation.lng});
    nwr["shop"="mall"]["name"](around:3200,${hubLocation.lat},${hubLocation.lng});
  );out center 160;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
  ];

  let elements: OsmElement[] = [];
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'User-Agent': 'hangout-place-pipeline/1.0',
        },
        body: query,
        signal: controller.signal,
      });

      if (!response.ok) continue;
      const data = await response.json();
      elements = (data.elements || []) as OsmElement[];
      break;
    } catch {
      // Try next mirror endpoint.
    } finally {
      clearTimeout(timer);
    }
  }

  if (!elements.length) return [];

  const places = elements
    .map((element): Place | null => {
      const tags = element.tags || {};
      const name = (tags.name || '').trim();
      const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat;
      const lng = typeof element.lon === 'number' ? element.lon : element.center?.lon;

      if (!name || typeof lat !== 'number' || typeof lng !== 'number') return null;
      if (!isSpecificVenueName(name)) return null;
      if (hasBlockedOsmContext(tags, name)) return null;

      const osmType = resolveOsmType(tags);
      if (!osmType || !VALID_OSM_TYPES.has(osmType)) return null;

      const type = mapOsmTypeToPlaceType(osmType);
      const distanceKm = haversineDistance(hubLocation, { lat, lng });
      if (distanceKm > MAX_PLACE_DISTANCE_KM) return null;

      const relevance = Math.max(0.2, 1 - distanceKm / 5);
      const detail = tags.cuisine || tags.leisure || tags.tourism || tags.amenity || 'venue';
      const rawTags = [
        tags.amenity,
        tags.leisure,
        tags.tourism,
        tags.shop,
        tags.cuisine,
      ]
        .flatMap((value) => (value ? String(value).split(';') : []))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8);

      const place: Place = {
        name,
        type,
        lat,
        lng,
        popularity: inferOsmPopularity(tags),
        area: hubName,
        tags: rawTags,
        description: detail + ' near ' + hubName,
        estimated_cost: defaultEstimatedCost(type, avgBudget),
        source: 'osm_fallback',
        relevance_score: Math.round(relevance * 100) / 100,
      };

      place.confidence_score = computePlaceConfidence(place);
      if ((place.confidence_score || 0) < PLACE_CONFIDENCE_THRESHOLD) return null;

      return place;
    })
    .filter((place): place is Place => place !== null);

  return dedupePlaces(places);
}

/**
 * Data pipeline (OSM + Typesense with Tavily enrichment):
 * 1) Fetch real nearby places from OSM around hub centroid.
 * 2) Blend in nearby Typesense candidates side-by-side (without replacing OSM).
 * 3) Optionally enrich existing places with Tavily hints (never add new places).
 * 4) Rank by budget, mood, and proximity with type variety constraints.
 */
export async function searchPlaces(
  hubName: string,
  hubLocation: { lat: number; lng: number },
  mood: Mood,
  avgBudget: number
): Promise<Place[]> {
  const slug = hubName.toLowerCase().replace(/\s+/g, '_');
  const cacheKey = `places_pipeline:v6:${slug}:${mood}:${Math.round(avgBudget / 50) * 50}`;

  const cached = await cacheGet<Place[]>(cacheKey);
  if (cached) return cached;

  const inflight = inflightSearches.get(cacheKey);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const [osmPlaces, typesensePlaces] = await Promise.all([
        fetchStructuredOsmPlaces(hubName, hubLocation, avgBudget),
        searchTypesensePlaces(hubName, mood, avgBudget),
      ]);

      if (osmPlaces.length === 0) {
        console.warn(`[PlacePipeline] OSM returned no places for hub ${hubName}`);
        return [];
      }

      const sourcedPlaces = blendOsmAndTypesense(osmPlaces, typesensePlaces, hubLocation, avgBudget, hubName);
      const enrichedPlaces = await enrichPlacesWithTavilyHints(sourcedPlaces, hubName, mood);
      const strictPlaces = enrichedPlaces
        .map((place) => ({
          ...place,
          confidence_score: computePlaceConfidence(place),
        }))
        .filter((place) => isSpecificVenueName(place.name))
        .filter((place) => passesGeoAndLocality(place, hubName, hubLocation))
        .filter((place) => (place.confidence_score || 0) >= PLACE_CONFIDENCE_THRESHOLD);

      const ranked = [...(strictPlaces.length > 0 ? strictPlaces : enrichedPlaces)]
        .map((place) => {
          const distanceKm =
            typeof place.lat === 'number' && typeof place.lng === 'number'
              ? haversineDistance(hubLocation, { lat: place.lat, lng: place.lng })
              : MAX_PLACE_DISTANCE_KM;
          const vibeAlignment = computeVibeAlignment(place, mood);
          const hangoutScore = computeHangoutScore(place, mood, avgBudget, hubLocation);

          return {
            place: {
              ...place,
              hangout_score: Math.round(hangoutScore * 100) / 100,
            },
            distanceKm,
            vibeAlignment,
            hangoutScore,
          };
        })
        .sort((a, b) => {
          const distanceDelta = a.distanceKm - b.distanceKm;
          if (Math.abs(distanceDelta) > 0.15) return distanceDelta;

          if (b.hangoutScore !== a.hangoutScore) {
            return b.hangoutScore - a.hangoutScore;
          }

          return b.vibeAlignment - a.vibeAlignment;
        })
        .map((entry) => entry.place);

      const balanced = selectBalancedTopPlaces(ranked);
      const finalPlaces = dedupePlaces(balanced);

      await cacheSet(cacheKey, finalPlaces, 60 * 60); // 1 hour TTL
      return finalPlaces;
    } catch (err) {
      console.error('[PlacePipeline] searchPlaces failed:', err);
      return [];
    }
  })();

  inflightSearches.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflightSearches.delete(cacheKey);
  }
}
