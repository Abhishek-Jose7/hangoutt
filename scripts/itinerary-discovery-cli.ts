import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import type { HubCandidate, ItineraryProfile, Mood, Place } from '@/types';
import { forwardGeocode } from '@/lib/geocoding';
import { haversineDistance } from '@/lib/transit';
import { searchTypesensePlaces } from '@/lib/typesense';
import { scorePlaceBreakdown } from '@/lib/scoring';
import { inferCostRange, midpointCostRange } from '@/lib/cost-model';
import { finalValidatePlacesBeforeEngine, validateGroundedPlaces } from '@/lib/place-validation';
import { generateGroundedItineraryForHub } from '@/lib/itinerary-engine';
import { reviewDeterministicItineraryWithGroq } from '@/lib/ai/generate-itinerary';

// ── Types ──────────────────────────────────────────────────────────────────
type TavilyResult = { title: string; content: string; url: string; score: number };
type OsmElement = {
  tags?: Record<string, string | undefined>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
};
type CliOptions = {
  location?: string;
  mood?: Mood;
  budget?: number;
  start?: string;
  profile?: ItineraryProfile;
  groupSize?: number;
  trace: boolean;
};
type ParsedArgs = { options: CliOptions; showHelp: boolean };

// ── Constants ──────────────────────────────────────────────────────────────
const VALID_MOODS: Mood[] = ['fun', 'chill', 'romantic', 'adventure'];
const VALID_PROFILES: ItineraryProfile[] = [
  'chill_walk', 'activity_food', 'premium_dining', 'budget_bites',
];
const PROFILE_ALIASES: Record<string, ItineraryProfile> = {
  chill: 'chill_walk', chill_activity: 'chill_walk', 'chill activity': 'chill_walk', walk: 'chill_walk',
  activity: 'activity_food', foodie: 'activity_food', premium: 'premium_dining', budget: 'budget_bites',
};
const HUB_COORD_FALLBACK: Record<string, { lat: number; lng: number; label: string }> = {
  bandra: { lat: 19.0606, lng: 72.8347, label: 'Bandra' },
  kurla: { lat: 19.0728, lng: 72.8826, label: 'Kurla' },
  andheri: { lat: 19.1197, lng: 72.8464, label: 'Andheri' },
  dadar: { lat: 19.0187, lng: 72.8422, label: 'Dadar' },
  juhu: { lat: 19.1075, lng: 72.8263, label: 'Juhu' },
  powai: { lat: 19.1176, lng: 72.9060, label: 'Powai' },
  borivali: { lat: 19.2291, lng: 72.8574, label: 'Borivali' },
  nerul: { lat: 19.0330, lng: 73.0297, label: 'Nerul, Navi Mumbai' },
};

const MAX_CANDIDATE_DISTANCE_KM = 3.2;
const OVERPASS_TIMEOUT_MS = 13000;
const MUMBAI_AVG_SPEED_KMH = 18;
const MAX_TRAVEL_TIME_MINS = 25;
const ACTIVITY_MAX_TRAVEL_MINS = 35;

const STRONG_ACTIVITY_KEYWORDS = [
  'bowling', 'arcade', 'gaming', 'trampoline', 'escape', 'vr',
  'go kart', 'go-kart', 'gokart', 'laser tag', 'laser-tag',
  'board game', 'paintball', 'rock climbing', 'bouldering',
  'smaaash', 'timezone', 'fun city', 'bounce', 'mystery rooms',
  'breakout', 'lock n escape', 'game palacio', 'pvr', 'inox',
  'cinema', 'movie', 'theatre', 'theater', 'museum', 'zoo',
  'comedy', 'concert', 'live music', 'snow world', 'water park',
  'crossword', 'landmark', 'book cafe', 'quiz night',
];

const WEAK_ACTIVITY_BLOCKLIST =
  /\b(sports association|sports club|gymkhana|gymnasium|swimming pool|wrestling|akhada|stadium|athletic|sports complex|recreation ground|sports ground|playground|talim|cricket ground|football ground|tennis court|badminton court)\b/;

// ── FIX 1: strip cross-area suffixes before geocoding ─────────────────────
const MUMBAI_AREA_SUFFIX_RE =
  /\s+(Bandra(\s*(West|East))?|Andheri(\s*(West|East))?|Juhu|Kurla|Dadar|Powai|Borivali|Worli|Lower\s*Parel|Colaba|Malad|Goregaon|Kandivali|Mulund|Thane|Vile\s*Parle(\s*(West|East))?|Santacruz(\s*(West|East))?|Khar(\s*(West|East))?|Versova|Lokhandwala)(\s*,.*)?$/i;

const ACTIVITY_SUITABILITY: Record<string, { min: number; max: number; score: number }> = {
  bowling: { min: 2, max: 8, score: 0.50 },
  arcade: { min: 2, max: 6, score: 0.50 },
  escape_room: { min: 3, max: 6, score: 0.60 },
  trampoline: { min: 2, max: 6, score: 0.50 },
  gaming: { min: 2, max: 6, score: 0.45 },
  go_kart: { min: 2, max: 8, score: 0.50 },
  cinema: { min: 2, max: 10, score: 0.40 },
  cafe_social: { min: 2, max: 10, score: 0.30 },
  museum: { min: 2, max: 8, score: 0.35 },
  comedy: { min: 3, max: 12, score: 0.45 },
  generic: { min: 1, max: 4, score: 0.10 },
};

// ── Performance: concurrency limiter for batch geocoding ──────────────────
function createConcurrencyLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active < max) {
      active++;
      try { return await fn(); }
      finally { active--; queue.shift()?.(); }
    }
    return new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        active++;
        try { resolve(await fn()); }
        catch (e) { reject(e); }
        finally { active--; queue.shift()?.(); }
      });
    });
  };
}

// ── Pure helpers ───────────────────────────────────────────────────────────
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenizeName(name: string): string[] {
  return normalizeText(name).split(' ').filter(t => t.length >= 2);
}
function capitalizeWord(v: string): string {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}
function parseStartTime(v: string): string {
  const m = v.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? `${m[1]}:${m[2]}` : '17:30';
}
function resolveProfileInput(v: string | undefined): ItineraryProfile | undefined {
  if (!v) return undefined;
  const n = v.trim().toLowerCase();
  if (VALID_PROFILES.includes(n as ItineraryProfile)) return n as ItineraryProfile;
  return PROFILE_ALIASES[n];
}
function isWeakName(name: string): boolean {
  const t = normalizeText(name);
  if (!t || t.length < 4) return true;
  if (name.trim().split(/\s+/).length > 5) return true;
  if (['location', 'area', 'near', 'menu', 'review', 'rating', 'contact', 'phone'].some(k => t.includes(k))) return true;
  const blocked = ['best places', 'top places', 'things to do', 'places to visit', 'near me',
    'guide', 'list', 'mumbai', 'india', 'justdial', 'tripadvisor', 'zomato', 'bookmyshow',
    'maharashtra', 'karaoke nights'];
  if (blocked.some(b => t.includes(b))) return true;
  if (/^(unnamed|plot\s*\d+|shop\s*\d+|building\s*\d+)/.test(t)) return true;
  if (tokenizeName(name).length < 2 && name.trim().length < 8) return true;
  return false;
}

// FIX 1 integrated: always strip area suffixes from raw seed names
function sanitizeCandidateName(rawName: string, areaLabel: string): string {
  let s = rawName
    .replace(/^[\-\*\d\)\(\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*\|.*$/, '')
    .replace(/\s*[-:].*$/, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim();

  // Strip cross-area suffixes like "Bandra West", "Andheri East" from venue names
  s = s.replace(MUMBAI_AREA_SUFFIX_RE, '').trim();

  const removals = [
    /^best\s+/i, /^top\s+/i, /^popular\s+/i, /^famous\s+/i, /^must\s*try\s+/i,
    /\bin\s+mumbai\b/gi, /\bnear\s+mumbai\b/gi, /\bmumbai\b/gi,
    /\bcafe\b/gi, /\brestaurant\b/gi, /\bhangout\s+spots?\b/gi, /\bplaces?\b/gi,
  ];
  for (const p of removals) s = s.replace(p, ' ').replace(/\s+/g, ' ').trim();

  const areaTokens = tokenizeName(areaLabel);
  if (areaTokens.length > 0) {
    const escaped = areaTokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    s = s.replace(new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
  }

  return s.split(' ').map(p => capitalizeWord(p.toLowerCase())).join(' ').trim();
}

function inferActivityTypeLocal(name: string): string {
  const n = normalizeText(name);
  if (n.includes('bowling')) return 'bowling';
  if (n.includes('arcade') || n.includes('smaaash') || n.includes('timezone') || n.includes('fun city')) return 'arcade';
  if (n.includes('escape') || n.includes('mystery room') || n.includes('breakout') || n.includes('lock n escape')) return 'escape_room';
  if (n.includes('trampoline') || n.includes('bounce')) return 'trampoline';
  if (n.includes('go kart') || n.includes('go-kart') || n.includes('gokart') || n.includes('kart')) return 'go_kart';
  if (n.includes('cinema') || n.includes('pvr') || n.includes('inox') || n.includes('movie') || n.includes('theatre') || n.includes('theater')) return 'cinema';
  if (n.includes('museum') || n.includes('gallery') || n.includes('fort')) return 'museum';
  if (n.includes('comedy') || n.includes('concert') || n.includes('live music')) return 'comedy';
  if (n.includes('cafe') || n.includes('coffee') || n.includes('starbucks') || n.includes('chaayos')) return 'cafe_social';
  if (n.includes('board game') || n.includes('crossword') || n.includes('landmark') || n.includes('gaming')) return 'gaming';
  if (n.includes('laser') || n.includes('paintball') || n.includes('vr') || n.includes('virtual reality')) return 'gaming';
  return 'generic';
}

function computeGroupSuitabilityLocal(place: Place, groupSize: number): number {
  if (place.type !== 'activity') return 0.5;
  const rule = ACTIVITY_SUITABILITY[inferActivityTypeLocal(place.name)] ?? ACTIVITY_SUITABILITY.generic;
  if (groupSize >= rule.min && groupSize <= rule.max) return rule.score;
  const d = groupSize < rule.min ? rule.min - groupSize : groupSize - rule.max;
  return Math.max(0, rule.score - 0.2 * d);
}

function isAreaLikeName(name: string, areaLabel: string): boolean {
  const areaTokens = new Set(tokenizeName(areaLabel));
  const nameTokens = tokenizeName(name);
  if (nameTokens.length === 0) return true;
  const dirs = new Set(['east', 'west', 'north', 'south', 'central']);
  if (nameTokens.every(t => areaTokens.has(t) || dirs.has(t))) return true;
  const nn = normalizeText(name);
  const na = normalizeText(areaLabel);
  if (nn === na) return true;
  if (nn.startsWith(`${na} `) && nameTokens.length <= 3) return true;
  return false;
}

function inferPlaceType(text: string): Place['type'] {
  const n = normalizeText(text);
  if (/\b(cafe|coffee|bakery|dessert|ice cream|gelato|patisserie)\b/.test(n)) return 'cafe';
  if (/\b(restaurant|dining|eatery|food|bistro|kitchen)\b/.test(n)) return 'restaurant';
  if (/\b(park|garden|promenade|beach|seaface|walk|trail|outdoor|udyan)\b/.test(n)) return 'outdoor';
  return 'activity';
}

function defaultEstimatedCost(type: Place['type'], avgBudget: number): number {
  if (type === 'cafe') return Math.round(Math.max(180, avgBudget * 0.25));
  if (type === 'restaurant') return Math.round(Math.max(260, avgBudget * 0.38));
  if (type === 'activity') return Math.round(Math.max(160, avgBudget * 0.32));
  return Math.round(Math.max(60, avgBudget * 0.1));
}

function extractApproxCost(text: string): number | undefined {
  const t = text.replace(/,/g, ' ');
  const range = t.match(/(?:₹|rs\.?|inr)\s*([0-9]{2,5})\s*(?:-|to)\s*(?:₹|rs\.?|inr)?\s*([0-9]{2,5})\s*(?:per\s*person|pp)?/i);
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])];
    if (lo > 0 && hi >= lo) return Math.round((lo + hi) / 2);
  }
  const forTwo = t.match(/(?:cost\s*for\s*2|cost\s*for\s*two|for\s*2|for\s*two)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([0-9]{2,5})/i);
  if (forTwo) { const a = Number(forTwo[1]); if (a > 0) return Math.round(a / 2); }
  const pp = t.match(/(?:₹|rs\.?|inr)\s*([0-9]{2,5})\s*(?:per\s*person|pp)/i);
  if (pp) { const a = Number(pp[1]); if (a > 0) return a; }
  return undefined;
}

function withCostModel(place: Place, avgBudget: number, hintCost?: number): Place {
  const observed =
    (typeof hintCost === 'number' && hintCost > 0) ? hintCost :
      (typeof place.estimated_cost === 'number' && place.estimated_cost > 0) ? place.estimated_cost :
        defaultEstimatedCost(place.type, avgBudget);
  const range = inferCostRange({
    name: place.name, type: place.type, description: place.description,
    tags: place.tags, estimatedCost: observed,
  });
  return { ...place, cost_range: range, estimated_cost: midpointCostRange(range) };
}

function sourcePriority(source: Place['source']): number {
  if (source === 'typesense') return 3;
  if (source === 'osm_fallback') return 2;
  return 1;
}

function nameSimilarity(a: string, b: string): number {
  const ta = new Set(tokenizeName(a));
  const tb = new Set(tokenizeName(b));
  if (!ta.size || !tb.size) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(new Set([...ta, ...tb]).size, 1);
}

function dedupeBySimilarity(places: Place[]): Place[] {
  const sorted = [...places].sort((a, b) =>
    ((b.confidence_score || 0.5) + sourcePriority(b.source) * 0.1) -
    ((a.confidence_score || 0.5) + sourcePriority(a.source) * 0.1)
  );
  const out: Place[] = [];
  for (const place of sorted) {
    const dup = out.find(p =>
      normalizeText(p.name) === normalizeText(place.name) ||
      nameSimilarity(p.name, place.name) >= 0.82
    );
    if (!dup) { out.push(place); continue; }
    if ((place.confidence_score || 0) > (dup.confidence_score || 0)) {
      dup.confidence_score = place.confidence_score;
      dup.inferred_rating = dup.inferred_rating ?? place.inferred_rating;
      dup.popularity = dup.popularity ?? place.popularity;
      dup.url = dup.url || place.url;
      dup.description = dup.description.length >= place.description.length ? dup.description : place.description;
      dup.estimated_cost = dup.estimated_cost ?? place.estimated_cost;
      dup.cost_range = dup.cost_range ?? place.cost_range;
      if (typeof dup.lat !== 'number') dup.lat = place.lat;
      if (typeof dup.lng !== 'number') dup.lng = place.lng;
      dup.relevance_score = Math.max(dup.relevance_score, place.relevance_score);
      dup.source = sourcePriority(place.source) > sourcePriority(dup.source) ? place.source : dup.source;
    }
  }
  return out;
}

// ── Fetch tracer ───────────────────────────────────────────────────────────
function providerFromUrl(url: string): string {
  const l = url.toLowerCase();
  if (l.includes('overpass')) return 'osm-overpass';
  if (l.includes('typesense')) return 'typesense';
  if (l.includes('tavily')) return 'tavily';
  if (l.includes('groq')) return 'groq';
  if (l.includes('nominatim')) return 'nominatim';
  return 'external';
}

function installFetchTracer(enabled: boolean): { restore: () => void } {
  if (!enabled || typeof globalThis.fetch !== 'function') return { restore: () => { } };
  const original = globalThis.fetch.bind(globalThis);
  let seq = 0;
  const traced: typeof fetch = async (resource, init) => {
    const id = ++seq;
    const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.toString() : (resource as Request).url;
    const method = init?.method ?? (resource instanceof Request ? resource.method : 'GET');
    const start = Date.now();
    console.log(`[HTTP ${id}] -> ${method.toUpperCase()} ${url}`);
    console.log(`[HTTP ${id}] provider=${providerFromUrl(url)}`);
    if (typeof init?.body === 'string' && init.body.trim())
      console.log(`[HTTP ${id}] body=${init.body.replace(/\s+/g, ' ').slice(0, 320)}`);
    try {
      const res = await original(resource, init);
      console.log(`[HTTP ${id}] <- ${res.status} ${res.statusText} (${Date.now() - start}ms)`);
      return res;
    } catch (err) {
      console.log(`[HTTP ${id}] !! failed (${Date.now() - start}ms): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  };
  globalThis.fetch = traced;
  return { restore: () => { globalThis.fetch = original; } };
}

function envState(n: string): string { const v = process.env[n]; return v?.trim() ? 'set' : 'missing'; }
function printEnvDiagnostics(): void {
  console.log('\n=== Provider Env Diagnostics ===');
  ['TAVILY_API_KEY', 'TYPESENSE_HOST', 'TYPESENSE_API_KEY'].forEach(k => console.log(`${k}: ${envState(k)}`));
  console.log(`TYPESENSE_COLLECTION: ${process.env.TYPESENSE_COLLECTION || 'venues (default)'}`);
  ['GROQ_API_KEYS', 'GROQ_API_KEY_GENERATOR', 'GROQ_API_KEY_RETRY', 'GROQ_API_KEY_OVERSEER'].forEach(k => console.log(`${k}: ${envState(k)}`));
  console.log('================================\n');
}

// ── CLI parsing ────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): ParsedArgs {
  const options: CliOptions = { trace: true };
  let showHelp = false;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help' || key === '-h') { showHelp = true; continue; }
    if (key === '--trace') { options.trace = true; continue; }
    if (key === '--no-trace') { options.trace = false; continue; }
    if (!key.startsWith('-')) { if (!options.location) options.location = key.trim(); continue; }
    const val = argv[i + 1];
    if (!val || val.startsWith('-')) continue;
    switch (key) {
      case '--location': case '--hub': case '-l': options.location = val.trim(); i++; break;
      case '--mood': case '-m': if (VALID_MOODS.includes(val as Mood)) options.mood = val as Mood; i++; break;
      case '--budget': case '-b': { const n = Number(val); if (Number.isFinite(n) && n > 0) options.budget = Math.round(n); i++; break; }
      case '--start': case '-t': options.start = val; i++; break;
      case '--profile': case '-p': { const p = resolveProfileInput(val); if (p) options.profile = p; i++; break; }
      case '--group-size': case '-g': { const n = Number(val); if (n >= 1 && n <= 20) options.groupSize = Math.round(n); i++; break; }
    }
  }
  return { options, showHelp };
}

function printHelp(): void {
  console.log('\nUsage: bun scripts/itinerary-discovery-cli.ts <location> -m fun -b 1000 -t 12:00 -p activity_food -g 4\n');
  console.log('  -l, --location    Hub/location name');
  console.log('  -m, --mood        fun | chill | romantic | adventure');
  console.log('  -b, --budget      Budget per person in INR');
  console.log('  -t, --start       Meetup start HH:MM');
  console.log('  -p, --profile     chill_walk | activity_food | premium_dining | budget_bites');
  console.log('  -g, --group-size  Number of people (default 3)');
  console.log('      --no-trace    Disable verbose provider logs\n');
}

async function promptForMissing(
  options: CliOptions
): Promise<Required<Omit<CliOptions, 'location'>> & { location: string }> {
  const rl = createInterface({ input, output });
  try {
    const location = options.location ?? (await rl.question('Location / hub area (example: Bandra West): ')).trim();
    const moodRaw = options.mood ?? ((await rl.question('Mood [fun/chill/romantic/adventure] (default fun): ')).trim().toLowerCase() as Mood);
    const mood: Mood = VALID_MOODS.includes(moodRaw) ? moodRaw : 'fun';
    const budgetRaw = options.budget ?? Number((await rl.question('Budget per person in INR (default 1200): ')).trim() || '1200');
    const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.round(budgetRaw) : 1200;
    const startInput = options.start ?? (await rl.question('Meetup start HH:MM (default 17:30): ')).trim();
    const startRaw = startInput || '17:30';
    const profileInput = options.profile ?? resolveProfileInput((await rl.question('Profile [chill_walk/activity_food/premium_dining/budget_bites] (default activity_food): ')).trim());
    const profileRaw = profileInput ?? 'activity_food';
    return { location, mood, budget, start: parseStartTime(startRaw), profile: profileRaw, groupSize: options.groupSize ?? 3, trace: options.trace };
  } finally { rl.close(); }
}

// ── Hub resolution ─────────────────────────────────────────────────────────
async function resolveHubLocation(locationInput: string): Promise<{ lat: number; lng: number; displayName: string }> {
  for (const query of [
    `${locationInput}, Mumbai, India`,
    `${locationInput}, Navi Mumbai, India`,
    `${locationInput}, Maharashtra, India`,
    `${locationInput}, India`,
  ]) {
    const hit = await forwardGeocode(query);
    if (hit) return { lat: hit.lat, lng: hit.lng, displayName: hit.display_name };
  }
  const n = normalizeText(locationInput);
  const alias = Object.keys(HUB_COORD_FALLBACK).find(k => n.includes(normalizeText(k)) || normalizeText(k).includes(n));
  if (!alias) throw new Error(`Unable to resolve hub for ${locationInput}`);
  const fb = HUB_COORD_FALLBACK[alias];
  return { lat: fb.lat, lng: fb.lng, displayName: `${fb.label} (fallback)` };
}

// ── FIX 1 + PERF: batch geocoding with concurrency cap ────────────────────
async function geocodeSeedsBatch(
  seeds: Array<{ name: string; context: string; url?: string }>,
  areaLabel: string,
  concurrency = 6,
): Promise<Array<{ seed: (typeof seeds)[0]; geocoded: Awaited<ReturnType<typeof forwardGeocode>> }>> {
  const limit = createConcurrencyLimiter(concurrency);
  const cache = new Map<string, Awaited<ReturnType<typeof forwardGeocode>>>();

  return Promise.all(seeds.map(seed =>
    limit(async () => {
      // Strip cross-area suffix from name before building geocode queries
      const cleanName = seed.name.replace(MUMBAI_AREA_SUFFIX_RE, '').trim();
      const queries = [
        `${cleanName}, ${areaLabel}, Mumbai, India`,
        `${cleanName}, Mumbai, India`,
        ...(cleanName !== seed.name ? [`${seed.name}, ${areaLabel}, Mumbai, India`] : []),
      ];
      const seen = new Set<string>();
      for (const q of queries) {
        const key = normalizeText(q);
        if (seen.has(key)) continue;
        seen.add(key);
        if (cache.has(key)) { const hit = cache.get(key)!; if (hit) return { seed, geocoded: hit }; continue; }
        const hit = await forwardGeocode(q);
        cache.set(key, hit);
        if (hit) return { seed, geocoded: hit };
      }
      return { seed, geocoded: null };
    })
  ));
}

// ── Tavily: parallel general + activity queries ────────────────────────────
function extractCandidateNamesFromText(text: string): string[] {
  return (text.match(/([A-Z][a-zA-Z0-9&'.-]+(?:\s+[A-Z][a-zA-Z0-9&'.-]+){0,5})/g) || [])
    .map(m => m.trim()).filter(m => m.length >= 4 && m.length <= 60);
}

function extractConcretePlaceSeeds(
  results: TavilyResult[],
  areaLabel: string,
): Array<{ name: string; context: string; url?: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; context: string; url?: string }> = [];
  for (const result of results) {
    const all = [
      result.title.split(/[|:\-]/)[0].trim(),
      ...extractCandidateNamesFromText(result.content),
      ...result.content.split(/[\n,;•]/).map(e => e.trim()).filter(e => e.length >= 4 && e.length <= 72),
    ];
    for (const rawName of all) {
      const name = sanitizeCandidateName(rawName.trim(), areaLabel);
      const key = normalizeText(name);
      if (!key || seen.has(key) || isWeakName(name) || isAreaLikeName(name, areaLabel)) continue;
      seen.add(key);
      out.push({ name, context: `${result.title} ${result.content}`, url: result.url });
      if (out.length >= 28) return out;
    }
  }
  return out;
}

async function discoverTavilyPlaces(params: {
  areaLabel: string;
  hubLocation: { lat: number; lng: number };
  mood: Mood;
  avgBudget: number;
  groupSize: number;
}): Promise<Place[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });

    // FIX 2: always run a dedicated activity query regardless of mood
    const moodFocus: Record<Mood, string> = {
      fun: 'fun cafes, social hangout spots, and quirky places',
      chill: 'chill cafes, dessert places, and calm outdoor spots',
      romantic: 'date-friendly cafes, dessert spots, and scenic places',
      adventure: 'interactive activities and energetic hangout spots',
    };
    const generalQuery = `Popular ${moodFocus[params.mood]} in ${params.areaLabel} Mumbai for young people. Specific venue names with INR pricing.`;
    // Activity query runs for ALL moods — this is the key fix
    const activityQuery = `Bowling alleys, escape rooms, arcades, Timezone, Smaaash, gaming zones, cinemas, trampoline parks near ${params.areaLabel} Mumbai. Specific venue names with address and INR pricing.`;

    // Run both queries in parallel
    const [generalRes, activityRes] = await Promise.allSettled([
      client.search(generalQuery, { maxResults: 8, searchDepth: 'basic' }),
      client.search(activityQuery, { maxResults: 6, searchDepth: 'basic' }),
    ]);

    const allResults: TavilyResult[] = [
      ...(generalRes.status === 'fulfilled' ? (generalRes.value.results || []) : []),
      ...(activityRes.status === 'fulfilled' ? (activityRes.value.results || []) : []),
    ] as TavilyResult[];

    if (!allResults.length) return [];
    const seeds = extractConcretePlaceSeeds(allResults, params.areaLabel);
    console.log(`[Stage 2] Extracted ${seeds.length} seeds from ${allResults.length} Tavily results`);

    // PERF FIX: batch geocode all seeds in parallel (was sequential before)
    const geocodeResults = await geocodeSeedsBatch(seeds, params.areaLabel, 6);
    const geocodedCount = geocodeResults.filter(r => r.geocoded).length;
    console.log(`[Stage 2] Geocoded ${geocodedCount}/${seeds.length} seeds`);

    const discovered: Place[] = [];
    const seen = new Set<string>();

    for (const { seed, geocoded } of geocodeResults) {
      if (!geocoded) continue;
      const distKm = haversineDistance(params.hubLocation, { lat: geocoded.lat, lng: geocoded.lng });
      const travelMin = (distKm / MUMBAI_AVG_SPEED_KMH) * 60;
      const type = inferPlaceType(`${seed.name} ${seed.context}`);
      if (travelMin > (type === 'activity' ? ACTIVITY_MAX_TRAVEL_MINS : MAX_TRAVEL_TIME_MINS)) continue;
      const sameZone = Math.abs(params.hubLocation.lat - geocoded.lat) < 0.05 && Math.abs(params.hubLocation.lng - geocoded.lng) < 0.05;
      if (type === 'activity') {
        if (travelMin > 40) continue;
      } else {
        if (travelMin > 20) continue;
      }

      const approxCost = extractApproxCost(seed.context);
      const confidence = Math.max(0.52, Math.min(0.72, 0.66 - distKm * 0.035));
      const base: Place = {
        name: seed.name, type, lat: geocoded.lat, lng: geocoded.lng,
        description: seed.context.split(/\.|\n/)[0]?.slice(0, 160) || `${type} near ${params.areaLabel}`,
        popularity: 58, area: params.areaLabel, source: 'tavily',
        confidence_score: confidence,
        relevance_score: Math.max(0.38, 1 - distKm / 5),
        url: seed.url,
      };
      const place = withCostModel(base, params.avgBudget, approxCost);

      if (place.type === 'activity') {
        place.activity_type = inferActivityTypeLocal(place.name);
        place.group_suitability = computeGroupSuitabilityLocal(place, params.groupSize);
        if (place.group_suitability < 0.15) continue;
        if (WEAK_ACTIVITY_BLOCKLIST.test(normalizeText(`${place.name} ${place.description}`))) continue;
      }

      const key = normalizeText(place.name);
      if (!key || seen.has(key) || isWeakName(place.name)) continue;
      seen.add(key);
      discovered.push(place);
    }

    console.log(`[Stage 2] Tavily accepted ${discovered.length} places`);
    return dedupeBySimilarity(discovered).slice(0, 12);
  } catch { return []; }
}

// ── FIX 2: OSM with expanded activity tags ─────────────────────────────────
function resolveOsmType(tags: Record<string, string | undefined>): Place['type'] | null {
  const amenity = (tags.amenity || '').toLowerCase();
  const leisure = (tags.leisure || '').toLowerCase();
  const tourism = (tags.tourism || '').toLowerCase();
  const shop = (tags.shop || '').toLowerCase();

  if (amenity === 'cafe') return 'cafe';
  if (amenity === 'restaurant' || amenity === 'fast_food') return 'restaurant';
  // Expanded: cinema, theatre, bowling, arcade, escape games, game shops
  if (amenity === 'cinema' || amenity === 'theatre') return 'activity';
  if (leisure === 'park' || leisure === 'garden') return 'outdoor';
  if (leisure === 'bowling_alley' || leisure === 'escape_game' ||
    leisure === 'amusement_arcade' || leisure === 'miniature_golf') return 'activity';
  if (tourism === 'museum' || tourism === 'attraction' || tourism === 'gallery' || tourism === 'viewpoint') return 'activity';
  if (shop === 'games' || shop === 'video_games') return 'activity';
  return null;
}

async function fetchStructuredOsmPlaces(params: {
  hubName: string;
  hubLocation: { lat: number; lng: number };
  avgBudget: number;
}): Promise<Place[]> {
  const { lat, lng } = params.hubLocation;

  // FIX 2: added cinema, theatre, bowling_alley, escape_game, amusement_arcade, shop=games
  const buildQuery = (r: number, t: number) =>
    `[out:json][timeout:${t}];(\n` +
    `nwr["amenity"~"cafe|restaurant|fast_food|cinema|theatre"]["name"](around:${r},${lat},${lng});\n` +
    `nwr["leisure"~"park|garden|bowling_alley|escape_game|amusement_arcade|miniature_golf"]["name"](around:${r},${lat},${lng});\n` +
    `nwr["tourism"~"attraction|museum|gallery|viewpoint"]["name"](around:${r},${lat},${lng});\n` +
    `nwr["shop"~"games|video_games"]["name"](around:${r},${lat},${lng});\n` +
    `);out center 160;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
  ];

  const fetchEndpoint = async (url: string, query: string): Promise<OsmElement[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'User-Agent': 'hangout-discovery-cli/1.0' },
        body: query, signal: ctrl.signal,
      });
      if (!res.ok) return [];
      const payload = await res.json();
      return (payload.elements || []) as OsmElement[];
    } catch { return []; }
    finally { clearTimeout(timer); }
  };

  const settled = await Promise.allSettled(endpoints.map(ep => fetchEndpoint(ep, buildQuery(2400, 13))));
  const batches = settled
    .filter((r): r is PromiseFulfilledResult<OsmElement[]> => r.status === 'fulfilled' && r.value.length > 0)
    .map(r => r.value)
    .sort((a, b) => b.length - a.length);

  if (!batches.length) return [];
  const elements = batches[0];

  const out: Place[] = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const name = (tags.name || '').trim();
    const lat2 = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lng2 = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (!name || typeof lat2 !== 'number' || typeof lng2 !== 'number') continue;
    if (isWeakName(name)) continue;
    const type = resolveOsmType(tags);
    if (!type) continue;
    const distKm = haversineDistance(params.hubLocation, { lat: lat2, lng: lng2 });
    if (distKm > MAX_CANDIDATE_DISTANCE_KM) continue;

    const base: Place = {
      name, type, lat: lat2, lng: lng2,
      description: `${tags.cuisine || tags.leisure || tags.tourism || tags.amenity || 'venue'} near ${params.hubName}`,
      area: tags['addr:suburb'] || tags['addr:district'] || params.hubName,
      popularity: 55, source: 'osm_fallback',
      confidence_score: Math.max(0.56, Math.min(0.74, 0.7 - distKm * 0.04)),
      relevance_score: Math.max(0.35, 1 - distKm / 4),
      tags: [tags.amenity, tags.leisure, tags.tourism, tags.cuisine, tags.shop].filter((v): v is string => Boolean(v)),
      url: `https://www.openstreetmap.org/?mlat=${lat2}&mlon=${lng2}`,
    };
    out.push(withCostModel(base, params.avgBudget));
  }
  return dedupeBySimilarity(out).slice(0, 24);
}

// ── FIX 3: ranking with activity guarantee ─────────────────────────────────
function rankAndBalanceCandidates(params: {
  places: Place[];
  hubLocation: { lat: number; lng: number };
  mood: Mood;
  perPersonCap: number;
}): Place[] {
  const scored = params.places.map(place => {
    const breakdown = scorePlaceBreakdown(place, params.perPersonCap, params.hubLocation.lat, params.hubLocation.lng, params.mood);
    const distKm = (typeof place.lat === 'number' && typeof place.lng === 'number')
      ? haversineDistance(params.hubLocation, { lat: place.lat, lng: place.lng })
      : MAX_CANDIDATE_DISTANCE_KM;
    const travelMin = (distKm / MUMBAI_AVG_SPEED_KMH) * 60;
    const confidence = Math.max(0.35, Math.min(1, place.confidence_score ?? (place.source === 'tavily' ? 0.58 : 0.66)));
    const text = normalizeText(`${place.name} ${place.description}`);
    const actBonus = place.type === 'activity' && STRONG_ACTIVITY_KEYWORDS.some(kw => text.includes(kw)) ? 0.10 : 0;
    const groupFactor = typeof place.group_suitability === 'number' ? (place.group_suitability - 0.3) * 0.15 : 0;
    const finalScore =
      breakdown.total_score * 0.56 +
      confidence * 0.26 +
      Math.max(0.2, 1 - distKm / 4) * 0.08 +
      (place.source === 'tavily' ? 0.10 : 0) +
      actBonus + groupFactor -
      Math.min(0.25, travelMin * 0.01);
    return {
      place: { ...place, hangout_score: Math.max(0.35, Math.min(0.95, finalScore / 3.7)), confidence_score: confidence },
      finalScore,
    };
  }).sort((a, b) => b.finalScore - a.finalScore);

  const byType: Record<Place['type'], typeof scored[0]['place'][]> = { cafe: [], restaurant: [], activity: [], outdoor: [] };
  for (const { place } of scored) byType[place.type].push(place);

  // FIX 3: activity guarantee — ensure activities get top slots when available
  const actCount = byType.activity.length;
  const quotas: Record<Place['type'], number> = actCount > 0
    ? { activity: Math.min(actCount, 6), outdoor: 3, cafe: 4, restaurant: 4 }
    : { activity: 0, outdoor: 6, cafe: 6, restaurant: 6 };

  const selected: Place[] = [];
  for (const type of ['activity', 'outdoor', 'cafe', 'restaurant'] as Place['type'][]) {
    selected.push(...byType[type].slice(0, quotas[type]));
  }
  for (const { place } of scored) {
    if (selected.length >= 18) break;
    if (!selected.some(p => nameSimilarity(p.name, place.name) >= 0.9)) selected.push(place);
  }
  return dedupeBySimilarity(selected).slice(0, 18);
}

function sourceBreakdown(places: Place[]): Record<string, number> {
  return places.reduce<Record<string, number>>((acc, p) => {
    const k = p.source === 'osm_fallback' ? 'osm' : p.source;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

function printPlacesPreview(places: Place[], hubLocation: { lat: number; lng: number }): void {
  console.log('\n=== Candidate Places ===');
  places.slice(0, 20).forEach((p, i) => {
    const d = (typeof p.lat === 'number' && typeof p.lng === 'number')
      ? haversineDistance(hubLocation, { lat: p.lat, lng: p.lng }).toFixed(2) : 'n/a';
    const tm = typeof d === 'string' && d !== 'n/a'
      ? Math.round((Number(d) / MUMBAI_AVG_SPEED_KMH) * 60) : 'n/a';
    console.log(`${i + 1}. ${p.name} | type=${p.type} | source=${p.source} | dist_km=${d} | travel_min=${tm} | cost=${p.estimated_cost ?? 'n/a'} | hangout=${p.hangout_score?.toFixed(3) ?? 'n/a'}`);
  });
  console.log('=======================\n');
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.showHelp) { printHelp(); return; }
  const inputData = await promptForMissing(parsed.options);
  const tracer = installFetchTracer(inputData.trace);

  try {
    printEnvDiagnostics();
    const t0 = Date.now();

    // Stage 1: resolve hub
    console.log('[Stage 1] Resolving hub...');
    const hubGeo = await resolveHubLocation(inputData.location);
    console.log(`[Stage 1] Hub: ${hubGeo.displayName} (${hubGeo.lat.toFixed(6)}, ${hubGeo.lng.toFixed(6)}) — ${Date.now() - t0}ms`);

    // PERF: Stages 2+3 run fully in parallel — was sequential before
    console.log('[Stage 2+3] Tavily + OSM + Typesense in parallel...');
    const t1 = Date.now();
    const [tavilyPlaces, osmPlaces, typesensePlaces] = await Promise.all([
      discoverTavilyPlaces({
        areaLabel: inputData.location,
        hubLocation: { lat: hubGeo.lat, lng: hubGeo.lng },
        mood: inputData.mood,
        avgBudget: inputData.budget,
        groupSize: inputData.groupSize,
      }),
      fetchStructuredOsmPlaces({
        hubName: inputData.location,
        hubLocation: { lat: hubGeo.lat, lng: hubGeo.lng },
        avgBudget: inputData.budget,
      }),
      searchTypesensePlaces(inputData.location, inputData.mood, inputData.budget),
    ]);
    console.log(`[Stage 2+3] Done in ${Date.now() - t1}ms — Tavily=${tavilyPlaces.length}, OSM=${osmPlaces.length}, Typesense=${typesensePlaces.length}`);

    // Stage 4: merge + rank
    console.log('[Stage 4] Merging and ranking...');
    const merged = dedupeBySimilarity([...osmPlaces, ...typesensePlaces, ...tavilyPlaces]);
    const ranked = rankAndBalanceCandidates({
      places: merged,
      hubLocation: { lat: hubGeo.lat, lng: hubGeo.lng },
      mood: inputData.mood,
      perPersonCap: inputData.budget,
    });

    const typeBreakdown = ranked.reduce<Record<string, number>>((a, p) => { a[p.type] = (a[p.type] || 0) + 1; return a; }, {});
    const actCount = typeBreakdown.activity || 0;
    const foodCount = (typeBreakdown.restaurant || 0) + (typeBreakdown.cafe || 0);
    console.log(`[Stage 4] Type breakdown: ${JSON.stringify(typeBreakdown)}`);
    if (actCount === 0) {
      console.log('[Stage 4] ⚠️  No activities found — itinerary will be food/outdoor only');
    } else {
      const actNames = ranked.filter(p => p.type === 'activity').slice(0, 3).map(p => `${p.name} (${p.activity_type ?? 'activity'})`).join(', ');
      console.log(`[Stage 4] ✅ ${actCount} activit${actCount === 1 ? 'y' : 'ies'} | ${foodCount} food — ${actNames}`);
    }

    printPlacesPreview(ranked, { lat: hubGeo.lat, lng: hubGeo.lng });

    const preValidated = finalValidatePlacesBeforeEngine(ranked);
    const verifiedPlaces = validateGroundedPlaces(preValidated, { lat: hubGeo.lat, lng: hubGeo.lng });
    console.log(`[Stage 4] merged=${merged.length}, ranked=${ranked.length}, verified=${verifiedPlaces.length}`);
    if (verifiedPlaces.length < 2) throw new Error(`Insufficient verified places (${verifiedPlaces.length})`);

    // Stage 5: deterministic itinerary
    console.log('[Stage 5] Generating itinerary...');
    const hub: HubCandidate = {
      name: inputData.location, lat: hubGeo.lat, lng: hubGeo.lng,
      station: inputData.location, strategy: 'geometric',
      travelTimes: [0], maxTravelTime: 0, avgTravelTime: 0, fairnessScore: 1,
    };

    let generated: ReturnType<typeof generateGroundedItineraryForHub> | undefined;
    let selectedProfile = inputData.profile;
    const profileOrder = Array.from(new Set<ItineraryProfile>([inputData.profile, 'activity_food', 'budget_bites', 'premium_dining', 'chill_walk']));
    for (const profile of profileOrder) {
      try {
        generated = generateGroundedItineraryForHub({
          hub, places: verifiedPlaces, mood: inputData.mood, perPersonCap: inputData.budget,
          profile, meetupStartTime: inputData.start, groupSize: inputData.groupSize,
        });
        selectedProfile = profile;
        if (profile !== inputData.profile) console.log(`[Stage 5] Fallback profile: ${profile}`);
        break;
      } catch { /* try next */ }
    }
    if (!generated) throw new Error('All profiles failed');

    // Stage 6: Groq review
    console.log('[Stage 6] Groq review...');
    const reviewed = await reviewDeterministicItineraryWithGroq({
      plan: generated.plan, candidates: verifiedPlaces, hub,
      mood: inputData.mood, profile: selectedProfile, perPersonCap: inputData.budget,
    });

    const totalMs = Date.now() - t0;
    console.log(`\n[Done] Total pipeline: ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);

    console.log('\n=== Hangout Itinerary ===');
    console.log(`Area: ${inputData.location}  |  Resolved: ${hubGeo.displayName}`);
    console.log(`Mood: ${inputData.mood}  |  Budget/person: ₹${inputData.budget}  |  Profile: ${selectedProfile}`);
    console.log(`Sources: ${JSON.stringify(sourceBreakdown(ranked))}  |  Model: ${reviewed.model || 'none'}`);
    console.log(`Title: ${reviewed.plan.short_title || 'Grounded itinerary'}`);
    console.log(`Summary: ${reviewed.plan.day_summary}`);
    console.log(`Total cost/person: ₹${reviewed.plan.total_cost_per_person} (+ ₹${reviewed.plan.contingency_buffer} buffer)\n`);
    console.log('Stops:');
    for (const stop of reviewed.plan.stops) {
      console.log(`  ${stop.stop_number}. ${stop.start_time}  ${stop.place_name}  [${stop.place_type}]  ₹${stop.estimated_cost_per_person}  ${stop.duration_mins}min`);
      if (stop.map_url) console.log(`     ${stop.map_url}`);
    }
    if (reviewed.plan.flow_summary) console.log(`\nFlow: ${reviewed.plan.flow_summary}`);
    if (reviewed.plan.why_this_option) console.log(`Why:  ${reviewed.plan.why_this_option}`);
    console.log('=========================\n');
  } finally {
    tracer.restore();
  }
}

main().catch(err => {
  console.error(`\n[itinerary-discovery-cli] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});