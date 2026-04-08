import 'server-only';

import type { Mood, Place } from '@/types';

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

const TYPESENSE_TIMEOUT_MS = 2200;

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

function inferType(raw: Record<string, unknown>): Place['type'] {
  const text = `${String(raw.type || '')} ${String(raw.category || '')} ${String(raw.tags || '')}`.toLowerCase();
  if (/\bcafe|coffee|bakery|dessert\b/.test(text)) return 'cafe';
  if (/\brestaurant|dining|food\b/.test(text)) return 'restaurant';
  if (/\boutdoor|park|promenade|beach|walk\b/.test(text)) return 'outdoor';
  return 'activity';
}

function mapHitToPlace(hit: TypesenseHit): Place | null {
  const doc = hit.document;
  if (!doc) return null;

  const name = toStringValue(doc.name) || toStringValue(doc.title);
  if (!name) return null;

  const type = inferType(doc);
  const description =
    toStringValue(doc.description) ||
    toStringValue(doc.summary) ||
    `${type} venue`;

  const estimatedCost =
    toNumber(doc.estimated_cost) ??
    toNumber(doc.price_per_person) ??
    toNumber(doc.avg_cost);

  const inferredRating =
    toNumber(doc.rating) ??
    toNumber(doc.google_rating) ??
    toNumber(doc.aggregate_rating);

  return {
    name,
    type,
    description,
    lat: toNumber(doc.lat),
    lng: toNumber(doc.lng),
    estimated_cost: estimatedCost,
    inferred_rating: inferredRating,
    source: 'typesense',
    relevance_score: Math.min(1, Math.max(0.35, (hit.text_match ?? 10000) / 100000)),
    url: toStringValue(doc.url),
  };
}

async function searchCollection(params: {
  baseUrl: string;
  apiKey: string;
  collection: string;
  q: string;
  queryBy: string;
  filterBy?: string;
  perPage: number;
}): Promise<Place[]> {
  const searchParams = new URLSearchParams({
    q: params.q,
    query_by: params.queryBy,
    per_page: String(params.perPage),
  });

  if (params.filterBy) searchParams.set('filter_by', params.filterBy);

  const url = `${params.baseUrl}/collections/${encodeURIComponent(params.collection)}/documents/search?${searchParams.toString()}`;

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
    return [];
  }
  clearTimeout(timeout);

  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as TypesenseSearchResponse;
  return (data.hits || [])
    .map(mapHitToPlace)
    .filter((p): p is Place => Boolean(p));
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

    const budgetUpper = Math.max(150, Math.round(avgBudget * 1.25));

    const [activities, eateries] = await Promise.all([
      searchCollection({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        collection: config.collection,
        q: activityQuery,
        queryBy: config.queryBy,
        filterBy: 'type:=[activity,outdoor]',
        perPage: 8,
      }),
      searchCollection({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        collection: config.collection,
        q: eateryQuery,
        queryBy: config.queryBy,
        filterBy: `type:=[cafe,restaurant] && estimated_cost:<=${budgetUpper}`,
        perPage: 10,
      }),
    ]);

    return [...activities, ...eateries];
  } catch {
    console.warn('[Typesense] search unavailable, continuing with fallback providers');
    return [];
  }
}
