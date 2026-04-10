import type { Mood, Place } from '@/types';
import { inferCostRange, midpointCostRange } from './cost-model';

interface TypesenseHit {
  document?: Record<string, unknown>;
  text_match?: number;
}

interface TypesenseSearchResponse {
  hits?: TypesenseHit[];
}

interface TypesenseConfig {
  baseUrl: string;
  apiKey: string;
  collection: string;
  queryBy: string;
}

const TYPESENSE_TIMEOUT_MS = 10000;
const BLOCKED_NAME_KEYWORDS = [
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
  'best places',
  'things to do',
  'near me',
];

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasStrongName(name: string): boolean {
  const lowered = normalizeText(name);
  const compact = name.trim();
  if (compact.length < 4) return false;
  if (!compact.includes(' ') && compact.length < 6) return false;
  if (/^unnamed|^plot\s*\d+|^shop\s*\d+|^building\s*\d+/i.test(lowered)) return false;
  return !BLOCKED_NAME_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

function getTypesenseBaseUrl(): string | null {
  const hostRaw = process.env.TYPESENSE_HOST?.trim();
  if (!hostRaw) return null;

  if (hostRaw.startsWith('http://') || hostRaw.startsWith('https://')) {
    return hostRaw.replace(/\/$/, '');
  }

  const protocol = process.env.TYPESENSE_PROTOCOL?.trim() || 'https';
  const port = process.env.TYPESENSE_PORT?.trim();
  const hostWithPort = port ? `${hostRaw}:${port}` : hostRaw;
  return `${protocol}://${hostWithPort}`.replace(/\/$/, '');
}

function getTypesenseConfig(): TypesenseConfig | null {
  const baseUrl = getTypesenseBaseUrl();
  const apiKey = process.env.TYPESENSE_API_KEY?.trim();
  const collection = process.env.TYPESENSE_COLLECTION?.trim() || 'venues';
  const queryBy = process.env.TYPESENSE_QUERY_BY?.trim() || 'name,description,tags,area,mood';

  if (!baseUrl || !apiKey) return null;

  return {
    baseUrl,
    apiKey,
    collection,
    queryBy,
  };
}

function moodTerms(mood: Mood): string {
  const map: Record<Mood, string> = {
    fun: 'social lively games music cafe restaurant',
    chill: 'calm cozy scenic board games coffee brunch',
    romantic: 'date romantic dessert fine dining aesthetic',
    adventure: 'ticketed bowling escape room trampoline arcade',
  };
  return map[mood];
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function extractLatLng(raw: Record<string, unknown>): { lat?: number; lng?: number } {
  const lat = toNumber(raw.lat) ?? toNumber(raw.latitude);
  const lng = toNumber(raw.lng) ?? toNumber(raw.lon) ?? toNumber(raw.longitude);
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { lat, lng };
  }

  const location = raw.location;
  if (Array.isArray(location) && location.length >= 2) {
    const locLat = toNumber(location[0]);
    const locLng = toNumber(location[1]);
    if (typeof locLat === 'number' && typeof locLng === 'number') {
      return { lat: locLat, lng: locLng };
    }
  }

  if (typeof location === 'string') {
    const match = location.match(/^\s*(-?[0-9]+(?:\.[0-9]+)?)\s*,\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/);
    if (match) {
      const locLat = Number(match[1]);
      const locLng = Number(match[2]);
      if (Number.isFinite(locLat) && Number.isFinite(locLng)) {
        return { lat: locLat, lng: locLng };
      }
    }
  }

  return {};
}

function inferType(raw: Record<string, unknown>): Place['type'] {
  const text = `${String(raw.type || '')} ${String(raw.category || '')} ${String(raw.tags || '')}`.toLowerCase();
  if (/\bcafe|coffee|bakery|dessert\b/.test(text)) return 'cafe';
  if (/\brestaurant|dining|food\b/.test(text)) return 'restaurant';
  if (/\boutdoor|park|promenade|beach|walk\b/.test(text)) return 'outdoor';
  return 'activity';
}

function isWeakShoppingOnlyActivity(place: Pick<Place, 'name' | 'description' | 'tags' | 'type'>): boolean {
  if (place.type !== 'activity') return false;

  const text = normalizeText(`${place.name} ${place.description || ''} ${(place.tags || []).join(' ')}`);
  const shoppingSignals = /\b(mall|shopping centre|shopping center|shopping complex|plaza|market)\b/.test(text);
  if (!shoppingSignals) return false;

  const engagementSignals =
    /\b(arcade|bowling|trampoline|escape room|gaming|cinema|movie|theatre|theater|pvr|inox|food court|board game|event|comedy|concert|show|timezone|smaaash)\b/.test(
      text
    );

  return !engagementSignals;
}

function hasStrongActivitySignals(place: Pick<Place, 'name' | 'description' | 'tags' | 'type'>): boolean {
  if (place.type !== 'activity') return true;
  if (isWeakShoppingOnlyActivity(place)) return false;

  const text = normalizeText(`${place.name} ${place.description || ''} ${(place.tags || []).join(' ')}`);
  const strongSignals =
    /\b(arcade|bowling|escape room|trampoline|gaming|kart|paintball|workshop|sports|climbing|skating|cinema|movie|theatre|theater|pvr|inox|museum|fort|board game|comedy|gig|concert|event|ticketed)\b/.test(
      text
    );
  if (strongSignals) return true;

  const weakPassiveSignals =
    /\b(gallery|viewpoint|memorial|monument|statue|landmark|complex|building|ground|garden|park|mall|shopping centre|shopping center|plaza|market)\b/.test(
      text
    );
  const engagementSignals =
    /\b(show|session|entry|slot|activity|experience|game|ride|timings|hours|open|food court|timezone|smaaash)\b/.test(text);

  if (weakPassiveSignals && !engagementSignals) return false;
  return place.name.trim().split(/\s+/).length >= 2;
}

function parseCostNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return undefined;

  const raw = value.trim();
  if (!raw) return undefined;

  const rangeMatch = raw.match(/([0-9]{2,5})\s*(?:-|to)\s*([0-9]{2,5})/i);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
      return Math.round((min + max) / 2);
    }
  }

  const numeric = raw.match(/([0-9]{2,5})/);
  if (!numeric) return undefined;
  const valueNum = Number(numeric[1]);
  if (!Number.isFinite(valueNum) || valueNum <= 0) return undefined;
  return valueNum;
}

function estimateCostFromDoc(doc: Record<string, unknown>, fallbackDescription: string): number | undefined {
  const perPerson =
    parseCostNumber(doc.estimated_cost) ??
    parseCostNumber(doc.price_per_person) ??
    parseCostNumber(doc.avg_cost) ??
    parseCostNumber(doc.cost) ??
    parseCostNumber(doc.price);

  if (typeof perPerson === 'number') return perPerson;

  const forTwo =
    parseCostNumber(doc.cost_for_two) ??
    parseCostNumber(doc.price_for_two) ??
    parseCostNumber(doc.avg_price_for_two);
  if (typeof forTwo === 'number') return Math.round(forTwo / 2);

  const text = `${fallbackDescription} ${toStringValue(doc.summary) || ''}`;
  const forTwoMatch = text.match(/(?:cost\s*for\s*2|cost\s*for\s*two|for\s*2|for\s*two)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([0-9]{2,5})/i);
  if (forTwoMatch) {
    const amount = Number(forTwoMatch[1]);
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount / 2);
  }

  const perPersonMatch = text.match(/(?:₹|rs\.?|inr)\s*([0-9]{2,5})\s*(?:per\s*person|pp)/i);
  if (perPersonMatch) {
    const amount = Number(perPersonMatch[1]);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }

  return undefined;
}

function mapHitToPlace(hit: TypesenseHit, avgBudget: number): Place | null {
  const doc = hit.document;
  if (!doc) return null;

  const name = toStringValue(doc.name) || toStringValue(doc.title);
  if (!name) return null;
  if (!hasStrongName(name)) return null;

  const type = inferType(doc);
  const coords = extractLatLng(doc);
  const description =
    toStringValue(doc.description) ||
    toStringValue(doc.summary) ||
    `${type} venue`;

  const estimatedCost = estimateCostFromDoc(doc, description);

  const inferredRating =
    toNumber(doc.rating) ??
    toNumber(doc.google_rating) ??
    toNumber(doc.aggregate_rating);

  const popularity =
    toNumber(doc.popularity) ??
    toNumber(doc.popularity_score) ??
    toNumber(doc.visits);

  const area =
    toStringValue(doc.area) ||
    toStringValue(doc.locality) ||
    toStringValue(doc.neighborhood) ||
    toStringValue(doc.region);
  const tagsRaw = doc.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : typeof tagsRaw === 'string'
    ? tagsRaw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;

  const normalizedName = normalizeText(name);
  const nameQuality = normalizedName.length >= 8 && normalizedName.includes(' ') ? 1 : 0;
  const hasRating = typeof inferredRating === 'number' && inferredRating > 0 ? 1 : 0;
  const hasTags = tags && tags.length > 0 ? 1 : 0;
  const typeValidity = ['cafe', 'restaurant', 'activity', 'outdoor'].includes(type) ? 1 : 0;
  const confidence = (nameQuality + hasRating + hasTags + typeValidity) / 4;

  const fallbackCost =
    type === 'cafe' ? Math.round(Math.max(220, avgBudget * 0.28))
    : type === 'restaurant' ? Math.round(Math.max(350, avgBudget * 0.42))
    : type === 'outdoor' ? Math.round(Math.max(80, avgBudget * 0.12))
    : Math.round(Math.max(120, avgBudget * 0.35));

  const costRange = inferCostRange({
    name,
    type,
    description,
    tags,
    estimatedCost: estimatedCost ?? fallbackCost,
  });

  const place: Place = {
    name,
    type,
    description,
    lat: coords.lat,
    lng: coords.lng,
    estimated_cost: midpointCostRange(costRange),
    cost_range: costRange,
    inferred_rating: inferredRating,
    popularity,
    area,
    tags,
    confidence_score: confidence,
    source: 'typesense',
    relevance_score: Math.min(1, Math.max(0.35, (hit.text_match ?? 10000) / 100000)),
    url: toStringValue(doc.url),
  };

  if (!hasStrongActivitySignals(place)) return null;

  return place;
}

function dedupePlaces(places: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];

  for (const place of places) {
    const key = `${normalizeText(place.name)}:${Math.round((place.lat ?? 0) * 1000)}:${Math.round((place.lng ?? 0) * 1000)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }

  return out;
}

async function searchCollection(params: {
  baseUrl: string;
  apiKey: string;
  collection: string;
  q: string;
  queryBy: string;
  filterBy?: string;
  perPage: number;
  avgBudget: number;
}): Promise<Place[]> {
  const searchParams = new URLSearchParams({
    q: params.q,
    query_by: params.queryBy,
    per_page: String(params.perPage),
  });

  if (params.filterBy) searchParams.set('filter_by', params.filterBy);

  const url = `${params.baseUrl}/collections/${encodeURIComponent(params.collection)}/documents/search?${searchParams.toString()}`;

  // Retry wrapper for Typesense network stability
  const attemptFetch = async (): Promise<Place[]> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TYPESENSE_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'X-TYPESENSE-API-KEY': params.apiKey,
        },
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      throw new Error('fetch failed');
    }
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[Typesense] HTTP ${res.status} for query: ${params.q.slice(0, 80)}`);
      return [];
    }

    const data = (await res.json()) as TypesenseSearchResponse;
    const hitCount = data.hits?.length ?? 0;
    console.log(`[Typesense] ${hitCount} hits for: ${params.q.slice(0, 60)}${params.filterBy ? ` (filter: ${params.filterBy})` : ''}`);

    return (data.hits || [])
      .map((hit) => mapHitToPlace(hit, params.avgBudget))
      .filter((p): p is Place => Boolean(p));
  };

  // Retry up to 2 times with exponential backoff
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      return await attemptFetch();
    } catch (err) {
      if (attempt === 2) {
        console.warn(`[Typesense] All retries exhausted for: ${params.q.slice(0, 60)}`);
        return [];
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return [];
}

export async function searchTypesensePlaces(
  hubName: string,
  mood: Mood,
  avgBudget: number
): Promise<Place[]> {
  const config = getTypesenseConfig();
  if (!config) return [];

  try {
    const moodQuery = moodTerms(mood);
    const activityQuery = `${hubName} mumbai ${moodQuery} activities events`;
    const eateryQuery = `${hubName} mumbai ${moodQuery} cafes restaurants`;
    // Brand anchor query for activities — much better discovery
    const brandQuery = `${hubName} mumbai bowling arcade Timezone Smaaash escape room trampoline gaming cinema`;

    const budgetUpper = Math.max(150, Math.round(avgBudget * 1.25));

    const [activities, eateries, branded] = await Promise.all([
      searchCollection({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        collection: config.collection,
        q: activityQuery,
        queryBy: config.queryBy,
        filterBy: 'type:=[activity,outdoor]',
        perPage: 8,
        avgBudget,
      }),
      searchCollection({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        collection: config.collection,
        q: eateryQuery,
        queryBy: config.queryBy,
        filterBy: `type:=[cafe,restaurant] && estimated_cost:<=${budgetUpper}`,
        perPage: 10,
        avgBudget,
      }),
      // Brand query without filters — catches activities that may not have type=activity
      searchCollection({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        collection: config.collection,
        q: brandQuery,
        queryBy: config.queryBy,
        perPage: 6,
        avgBudget,
      }),
    ]);

    const strict = dedupePlaces([...activities, ...eateries, ...branded]);
    if (strict.length >= 10) return strict;

    // Relaxed fallback: remove filters entirely to avoid "zero results + timeout" pattern
    const relaxedQuery = `${hubName} mumbai ${moodQuery} cafes restaurants activities parks`;
    const relaxed = await searchCollection({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      collection: config.collection,
      q: relaxedQuery,
      queryBy: config.queryBy,
      // NO filterBy — this is the fallback
      perPage: 14,
      avgBudget,
    });

    return dedupePlaces([...strict, ...relaxed]);
  } catch {
    console.warn('[Typesense] search unavailable, continuing with fallback providers');
    return [];
  }
}
