import type { Mood, Place } from '@/types';
import { cacheGet, cacheSet } from './redis';
import { haversineDistance } from './transit';
import { searchTypesensePlaces } from './typesense';
import { getCuratedVenues } from './venue-catalog';
import { forwardGeocode } from './geocoding';
import { inferCostRange, midpointCostRange } from './cost-model';

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
  'park',
  'garden',
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
const STRICT_PLACE_CONFIDENCE_THRESHOLD = 0.62;
const SOFT_PLACE_CONFIDENCE_THRESHOLD = 0.5;
const STRICT_HANGOUT_THRESHOLD = 0.56;
const SOFT_HANGOUT_THRESHOLD = 0.45;
const OSM_STRICT_CONFIDENCE_THRESHOLD = 0.58;
const OSM_STRICT_HANGOUT_THRESHOLD = 0.5;
const OVERPASS_TIMEOUT_MS = 12000;
const TAVILY_TIMEOUT_MS = 8000;
const OSM_PRIMARY_RADIUS_METERS = 2200;
const OSM_SECONDARY_RADIUS_METERS = 3000;
const OSM_PRIMARY_LIMIT = 120;
const OSM_SECONDARY_LIMIT = 160;
const MUMBAI_AVG_SPEED_KMH = 18; // Average Mumbai traffic speed
const MAX_TRAVEL_TIME_MINS = 25; // Default max travel time
const ACTIVITY_MAX_TRAVEL_TIME_MINS = 35; // Allow longer travel for good activities
const MAX_ITINERARY_TRAVEL_MINS = 55; // Total travel budget across stops

// ── Strong activity keywords (real hangout experiences) ──────
const STRONG_ACTIVITY_KEYWORDS = [
  'bowling', 'arcade', 'gaming', 'trampoline', 'escape', 'vr',
  'go kart', 'go-kart', 'gokart', 'laser tag', 'laser-tag',
  'board game', 'paintball', 'rock climbing', 'bouldering',
  'ice skating', 'roller skating', 'water park', 'snow world',
  'smaaash', 'timezone', 'fun city', 'bounce', 'mystery rooms',
  'breakout', 'lock n escape', 'game palacio', 'pvr', 'inox',
  'cinema', 'movie', 'theatre', 'theater', 'museum', 'zoo',
  'aquarium', 'comedy', 'concert', 'live music',
];

// ── Activity suitability by group size ──────────────────────
const ACTIVITY_SUITABILITY: Record<string, { min: number; max: number; score: number }> = {
  bowling: { min: 2, max: 8, score: 0.5 },
  arcade: { min: 2, max: 6, score: 0.5 },
  escape_room: { min: 3, max: 6, score: 0.6 },
  trampoline: { min: 2, max: 6, score: 0.5 },
  gaming: { min: 2, max: 6, score: 0.45 },
  go_kart: { min: 2, max: 8, score: 0.5 },
  cinema: { min: 2, max: 10, score: 0.4 },
  cafe_social: { min: 2, max: 10, score: 0.3 },
  museum: { min: 2, max: 8, score: 0.35 },
  comedy: { min: 3, max: 12, score: 0.45 },
  generic: { min: 1, max: 4, score: 0.1 },
};

// ── Weak activity blocklist (non-hangout venues) ──────────────
const WEAK_ACTIVITY_BLOCKLIST =
  /\b(sports association|sports club|gymkhana|gymnasium|swimming pool|wrestling|akhada|stadium|athletic|sports complex|recreation ground|sports ground|playground|talim|vyayamshala|cricket ground|football ground|tennis court|badminton court)\b/i;

const BORING_PLACE_PENALTIES =
  /\b(udyan|nagar|colony|chawl|society|bhavan|bhawan|sabhagruha|mandal|samaj|sangha|sanstha)\b/i;

const HANGOUT_CHAIN_BOOSTS = [
  'starbucks', 'blue tokai', 'third wave', 'social', 'chaayos', 'tim hortons',
  'costa coffee', 'ccd', 'theobroma', 'candies', 'birdsong', 'kala ghoda',
  'mcdonalds', 'mcdonald', 'burger king', 'subway', 'dominos', 'pizza hut',
  'wow momo', 'keventers', 'falooda nation', 'bachelorr', 'naturals ice cream',
  'baskin robbins', 'icecream works', 'smaaash', 'timezone', 'fun city',
  'pvr', 'inox', 'cinepolis', 'mystery rooms', 'breakout', 'bounce',
  'lock n escape', 'game palacio', 'bowling',
];

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

/** Retry wrapper for flaky network calls (Tavily, etc.) */
async function withRetry<T>(fn: () => Promise<T>, retries: number = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

// ── FIX: Pre-geocode name validation filter ──────────────────────
const VALID_VENUE_NAME_RE = /^[A-Za-z0-9&'.\-\s]{4,}$/;
const BAD_SEED_PATTERNS = [
  'best', 'top', 'places', 'things', 'near me',
  'mumbai', 'india', 'guide', 'list', 'location',
  'area', 'menu', 'review', 'rating', 'maharashtra',
];

// ── FIX: Strip cross-area suffixes before geocoding ─────────────
const MUMBAI_AREA_SUFFIX_RE =
  /\s+(Bandra(\s*(West|East))?|Andheri(\s*(West|East))?|Juhu|Kurla|Dadar|Powai|Borivali|Worli|Lower\s*Parel|Colaba|Malad|Goregaon|Kandivali|Mulund|Thane|Vile\s*Parle(\s*(West|East))?|Santacruz(\s*(West|East))?|Khar(\s*(West|East))?|Versova|Lokhandwala)(\s*,.*)?$/i;

/** Checks if a seed name passes pre-geocode quality filter */
function passesPreGeocodeFilter(name: string): boolean {
  if (!VALID_VENUE_NAME_RE.test(name)) return false;
  if (name.split(' ').length > 4) return false;
  const lowered = name.toLowerCase();
  if (BAD_SEED_PATTERNS.some((p) => lowered.includes(p))) return false;
  return true;
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

  // Reject names with too many words (listicle titles)
  if (name.trim().split(/\s+/).length > 5) return true;

  // Reject names containing vague keywords
  if (['location', 'area', 'near', 'menu', 'review', 'rating', 'contact', 'phone'].some((k) => lowered.includes(k))) {
    return true;
  }

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
  if (/^(garden|park|ground|playground|building|complex|mall|restaurant|cafe)$/.test(lowered)) {
    return true;
  }
  const tokens = tokenQuality(name).map((token) => normalizeText(token));
  if (
    tokens.length <= 2 &&
    tokens.length > 0 &&
    tokens.every((token) => ['garden', 'park', 'ground', 'building', 'complex'].includes(token))
  ) {
    return true;
  }
  if (BLOCKED_KEYWORDS.some((keyword) => lowered.includes(keyword))) return true;
  if (!hasBalancedAlpha(name)) return true;
  if (tokens.length < 2 && name.trim().length < 8) return true;

  // Reject state/city/district-level names returned by Tavily
  if (/^(maharashtra|mumbai|india|thane|navi mumbai|pune|delhi|bangalore|chennai)$/i.test(lowered)) {
    return true;
  }

  return false;
}

/** Checks if a name is a weak/vague Tavily result (listicle title, area name, etc.) */
function isWeakTavilyName(name: string): boolean {
  const lowered = normalizeText(name);
  if (!lowered || lowered.length < 4) return true;
  if (looksLikeGarbagePoi(name)) return true;

  const weakPatterns = [
    /^\d+\s+(best|top|popular|famous)/,
    /\bbest\s+(places|things|spots|restaurants|cafes|activities)\b/,
    /\btop\s+\d+/,
    /\bthings to do\b/,
    /\bplaces to visit\b/,
    /\bnear me\b/,
    /\bguide to\b/,
    /\blist of\b/,
    /\bkaraoke nights?$/,
    /\blocation$/,
    /\baddress$/,
    /\bdirections?$/,
  ];
  return weakPatterns.some((pattern) => pattern.test(lowered));
}

/** Checks if a name is just the area/hub name itself */
function isAreaLikeName(name: string, areaLabel: string): boolean {
  const n = normalizeText(name);
  const a = normalizeText(areaLabel);
  if (!n || !a) return false;
  if (n === a) return true;
  // Exact area or city
  if (/^(mumbai|thane|navi mumbai|pune)$/.test(n)) return true;
  // "Bandra" or "Bandra West" alone is area-like
  if (n === a || `${n} west` === a || `${n} east` === a || n === `${a} west` || n === `${a} east`) return true;
  return false;
}

// ── Travel-time utilities ──────────────────────────────────────

/** Estimate travel time in minutes given distance in km (Mumbai traffic) */
function estimateTravelTimeMins(distanceKm: number): number {
  return (distanceKm / MUMBAI_AVG_SPEED_KMH) * 60;
}

/** Check if two places are in the same Mumbai zone (prevents city jumping) */
function isSameZone(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): boolean {
  return Math.abs(p1.lat - p2.lat) < 0.05 && Math.abs(p1.lng - p2.lng) < 0.05;
}

/** Check if a place passes travel-time constraint (activities get more leeway) */
function passesTravelTimeConstraint(
  distanceKm: number,
  placeType: string,
  hangoutScore: number
): boolean {
  const travelMins = estimateTravelTimeMins(distanceKm);

  // High-value activities are worth traveling for
  if (placeType === 'activity' && hangoutScore > 0.5) {
    return travelMins <= ACTIVITY_MAX_TRAVEL_TIME_MINS;
  }

  return travelMins <= MAX_TRAVEL_TIME_MINS;
}

// ── Activity type inference & group suitability ─────────────────

function inferActivityType(name: string): string {
  const n = normalizeText(name);
  if (n.includes('bowling')) return 'bowling';
  if (n.includes('arcade') || n.includes('gaming') || n.includes('smaaash') || n.includes('timezone') || n.includes('fun city')) return 'arcade';
  if (n.includes('escape') || n.includes('mystery room') || n.includes('breakout') || n.includes('lock n escape')) return 'escape_room';
  if (n.includes('trampoline') || n.includes('bounce')) return 'trampoline';
  if (n.includes('go kart') || n.includes('go-kart') || n.includes('gokart') || n.includes('kart')) return 'go_kart';
  if (n.includes('cinema') || n.includes('pvr') || n.includes('inox') || n.includes('movie') || n.includes('theatre') || n.includes('theater')) return 'cinema';
  if (n.includes('museum') || n.includes('gallery') || n.includes('fort')) return 'museum';
  if (n.includes('comedy') || n.includes('concert') || n.includes('live music')) return 'comedy';
  if (n.includes('cafe') || n.includes('coffee') || n.includes('starbucks') || n.includes('chaayos')) return 'cafe_social';
  if (n.includes('board game')) return 'gaming';
  if (n.includes('laser') || n.includes('paintball') || n.includes('vr') || n.includes('virtual reality')) return 'gaming';
  return 'generic';
}

function computeGroupSuitability(place: Place, groupSize: number): number {
  if (place.type !== 'activity') return 0.5; // Non-activities are always neutral

  const actType = inferActivityType(place.name);
  const rule = ACTIVITY_SUITABILITY[actType] || ACTIVITY_SUITABILITY.generic;

  if (groupSize >= rule.min && groupSize <= rule.max) {
    return rule.score;
  }

  // Penalize mismatch
  const distance = groupSize < rule.min
    ? rule.min - groupSize
    : groupSize - rule.max;

  return Math.max(0, rule.score - 0.2 * distance);
}

/** Check if a place is a strong experiential activity (not just a generic one) */
function isStrongExperientialActivity(place: Place): boolean {
  if (place.type !== 'activity') return false;
  const text = normalizeText(`${place.name} ${place.description || ''}`);
  return STRONG_ACTIVITY_KEYWORDS.some((kw) => text.includes(kw));
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

  if (amenity === 'cafe') return 'cafe';
  if (amenity === 'restaurant') return 'restaurant';
  if (amenity === 'fast_food') return 'fast_food';
  if (leisure === 'park') return 'park';
  if (leisure === 'garden') return 'garden';
  if (tourism === 'attraction') return 'tourist_attraction';

  return null;
}

function mapOsmTypeToPlaceType(osmType: string): Place['type'] {
  if (osmType === 'cafe') return 'cafe';
  if (osmType === 'restaurant' || osmType === 'fast_food') return 'restaurant';
  if (osmType === 'park' || osmType === 'garden') return 'outdoor';
  return 'activity';
}

function hasSelectiveOutdoorSignals(
  name: string,
  tags: Record<string, string | undefined>
): boolean {
  const text = normalizeText(
    `${name} ${tags.leisure || ''} ${tags.tourism || ''} ${tags.website || ''} ${tags.operator || ''}`
  );
  if (looksLikeGarbagePoi(name)) return false;
  if (/\b(promenade|seaface|beach|lake|viewpoint|fort|museum|garden|park|trail)\b/.test(text)) {
    return tokenQuality(name).length >= 2;
  }

  return Boolean(
    tags.website ||
      tags['contact:website'] ||
      tags.wikidata ||
      tags.wikipedia ||
      tags.operator ||
      tags.opening_hours
  );
}

function hasActionableShowtime(text: string): boolean {
  return /\b([01]?\d|2[0-3]):[0-5]\d\b|\b(1[0-2]|[1-9])\s?(am|pm)\b/i.test(text);
}

function isMovieLikeName(name: string): boolean {
  const text = normalizeText(name);
  return /\b(cinema|theatre|theater|movie|pvr|inox|imax)\b/i.test(text);
}

function blockedForMoodByName(name: string, mood: Mood): boolean {
  const text = normalizeText(name);
  const padded = ` ${text} `;

  const alwaysBlocked = [
    'wine shop',
    'liquor',
    'permit room',
    'beer shop',
    'alcohol shop',
    'wine and more',
  ];

  if (alwaysBlocked.some((token) => text.includes(token))) return true;
  if (padded.includes(' wine ') || padded.includes(' wines ')) return true;

  const nonHangoutLandmarks = [
    ' shrine ',
    ' oratory ',
    ' bungalow ',
    ' memorial ',
    ' cemetery ',
    ' dargah ',
    ' fort gate ',
  ];
  if (nonHangoutLandmarks.some((token) => padded.includes(token))) return true;

  if (padded.includes(' house ') && !padded.includes(' coffee house ')) return true;

  if (mood === 'chill') {
    const chillBlocked = [
      ' bar ',
      ' pub ',
      ' nightclub',
      ' night club',
      ' lounge',
      ' taproom',
      ' brewery',
    ];
    if (chillBlocked.some((token) => padded.includes(token))) return true;
  }

  return false;
}

function inferTavilyType(text: string): Place['type'] {
  const normalized = normalizeText(text);
  if (/\b(cafe|coffee|bakery|dessert)\b/.test(normalized)) return 'cafe';
  if (/\b(restaurant|dining|eatery|food)\b/.test(normalized)) return 'restaurant';
  if (/\b(park|garden|promenade|beach|walk|outdoor)\b/.test(normalized)) return 'outdoor';
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
  if (engagementSignals) return false;

  const destinationMallSignals =
    /\b(oberoi sky city|inorbit|infiniti|phoenix|jio world|r city|raghuleela)\b/.test(text);

  return !destinationMallSignals;
}

function looksCinemaWithoutShowtime(place: Place): boolean {
  if (!isMovieLikeName(place.name)) return false;
  const text = `${place.name} ${place.description}`;
  return !hasActionableShowtime(text);
}

function hasStrongActivitySignals(place: Pick<Place, 'name' | 'description' | 'tags' | 'type'>): boolean {
  if (place.type !== 'activity') return true;
  if (isWeakShoppingOnlyActivity(place)) return false;

  const text = normalizeText(`${place.name} ${place.description || ''} ${(place.tags || []).join(' ')}`);

  // Hard-reject non-hangout activities (sports associations, gymkhanas, generic grounds)
  if (WEAK_ACTIVITY_BLOCKLIST.test(text)) return false;

  const strongSignals =
    /\b(arcade|bowling|escape room|trampoline|gaming|kart|paintball|workshop|climbing|skating|cinema|movie|theatre|theater|pvr|inox|museum|fort|board game|comedy|gig|concert|event|ticketed|zoo|aquarium|go.?kart|laser.?tag|vr|virtual reality|paintball|rock climbing|bouldering|ice skating|roller skating|water park)\b/.test(
      text
    );
  if (strongSignals) return true;

  const weakPassiveSignals =
    /\b(gallery|viewpoint|memorial|monument|statue|landmark|complex|building|ground|garden|park|mall|shopping centre|shopping center|plaza|market|sports|association|club|gymkhana)\b/.test(
      text
    );
  const engagementSignals =
    /\b(show|session|entry|slot|activity|experience|game|ride|timings|hours|open|food court|timezone|smaaash)\b/.test(text);

  if (weakPassiveSignals && !engagementSignals) return false;
  return tokenQuality(place.name).length >= 2;
}

/**
 * Extract concrete place-name seeds from Tavily search results.
 * This parses names from titles and content, filtering vague listicle phrases.
 */
function extractConcretePlaceSeeds(
  results: TavilyResult[],
  areaLabel: string
): Array<{ name: string; context: string; url: string }> {
  const seeds: Array<{ name: string; context: string; url: string }> = [];
  const seen = new Set<string>();

  for (const result of results) {
    // Extract all candidate names from title and content
    const allCandidates = [
      result.title.split(/[|:\-]/)[0].trim(),
      ...result.content.match(/([A-Z][a-zA-Z0-9&'.\-]+(?:\s+[A-Z][a-zA-Z0-9&'.\-]+){0,5})/g) || [],
      ...result.content.split(/[\n,;•]/).map((e) => e.trim()).filter((e) => e.length >= 4 && e.length <= 72),
    ];

    for (const rawName of allCandidates) {
      // Strip area suffix before evaluating
      let cleaned = rawName.replace(MUMBAI_AREA_SUFFIX_RE, '').trim();
      // Strip title prefix junk
      cleaned = cleaned
        .replace(/^[\-\*\d\)\(\s]+/, '')
        .replace(/\s*\|.*$/, '')
        .replace(/\s*[-:].*$/, '')
        .replace(/\s*\(.*\)\s*$/, '')
        .trim();

      if (cleaned.length < 4 || cleaned.length > 60) continue;

      // FIX 1: Pre-geocode filter — reject BEFORE geocoding
      if (!passesPreGeocodeFilter(cleaned)) continue;

      const key = normalizeText(cleaned);
      if (!key || seen.has(key)) continue;
      if (isWeakTavilyName(cleaned)) continue;
      if (isAreaLikeName(cleaned, areaLabel)) continue;

      seen.add(key);
      seeds.push({ name: cleaned, context: `${result.title} ${result.content}`, url: result.url });
      if (seeds.length >= 28) return seeds;
    }
  }

  return seeds;
}

/**
 * Look up currently screening movies at a theatre via Tavily.
 * Returns enriched description with movie names and prices if found.
 */
async function lookupTheatreShowtimes(
  theatreName: string,
  areaLabel: string
): Promise<{ movies: string; prices: string } | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });
    const query = `movies currently screening at ${theatreName} ${areaLabel} Mumbai today with ticket prices`;

    const response = await withTimeout(
      client.search(query, {
        maxResults: 3,
        searchDepth: 'basic',
      }),
      TAVILY_TIMEOUT_MS
    );

    const results = (response.results || []) as TavilyResult[];
    if (!results.length) return null;

    const allText = results.map((r) => `${r.title} ${r.content}`).join(' ');

    // Try to extract movie names (capitalized phrases near screening/showing keywords)
    const moviePatterns = allText.match(
      /(?:showing|screening|playing|now showing)[:\s]+([A-Z][A-Za-z\s:,&'\-]{3,80})/gi
    );
    const movieNames = moviePatterns
      ? moviePatterns
          .map((m) => m.replace(/^(?:showing|screening|playing|now showing)[:\s]+/i, '').trim())
          .filter((m) => m.length > 2)
          .slice(0, 5)
          .join(', ')
      : '';

    // Try to extract prices
    const priceMatch = allText.match(/(?:₹|rs\.?|inr)\s*\d{2,4}/gi);
    const prices = priceMatch ? priceMatch.slice(0, 3).join(' / ') : '';

    if (!movieNames && !prices) return null;
    return { movies: movieNames || 'current screenings available', prices: prices || 'varies' };
  } catch {
    return null;
  }
}

/**
 * Two-pass adaptive Tavily discovery with dynamic relaxation.
 * Pass 1: strict filters (tight travel time, name quality gates).
 * Pass 2 (only if needed): relaxed travel time, weaker name filtering, broader query.
 * Group-size-aware: queries change based on how many people.
 */
async function discoverTavilyFallbackPlaces(
  hubName: string,
  hubLocation: { lat: number; lng: number },
  mood: Mood,
  avgBudget: number,
  groupSize: number = 3
): Promise<Place[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });
    const areaLabel = hubName;

    // FIX 2: Always run a dedicated activity query with REAL BRAND ANCHORS
    const moodFocus: Record<Mood, string> = {
      fun: 'fun cafes, social hangout spots, and quirky places',
      chill: 'chill cafes, dessert places, and calm outdoor spots',
      romantic: 'date-friendly cafes, dessert spots, and scenic places',
      adventure: 'interactive activities and energetic hangout spots',
    };

    // Group-size-aware general query
    const activityFocus = groupSize >= 5
      ? 'group activities like bowling, arcade, escape room, trampoline'
      : groupSize >= 3
      ? 'activities, cafes, and hangout spots'
      : 'cafes and chill places';

    const generalQuery = `Popular ${moodFocus[mood]} in ${areaLabel} Mumbai for young people. Specific venue names with INR pricing.`;

    // Activity query uses BRAND ANCHORS — Tavily performs MUCH better with real-world names
    const activityQuery = `Bowling alleys, escape rooms, arcades, Timezone, Smaaash, Game Palacio, Mystery Rooms, cinema, trampoline parks near ${areaLabel} Mumbai. Specific venue names with address and INR pricing.`;

    // FIX 4: Wrap Tavily calls with retry for network stability
    const [generalRes, activityRes] = await Promise.allSettled([
      withRetry(() => withTimeout(
        client.search(generalQuery, { maxResults: 8, searchDepth: 'basic' }),
        TAVILY_TIMEOUT_MS
      )),
      withRetry(() => withTimeout(
        client.search(activityQuery, { maxResults: 6, searchDepth: 'basic' }),
        TAVILY_TIMEOUT_MS
      )),
    ]);

    const allResults: TavilyResult[] = [
      ...(generalRes.status === 'fulfilled' ? (generalRes.value.results || []) : []),
      ...(activityRes.status === 'fulfilled' ? (activityRes.value.results || []) : []),
    ] as TavilyResult[];

    if (!allResults.length) return [];

    const seeds = extractConcretePlaceSeeds(allResults, areaLabel);
    console.log(`[Tavily] Extracted ${seeds.length} seeds from ${allResults.length} results for ${areaLabel}`);

    const discovered: Place[] = [];
    const globalSeen = new Set<string>();

    for (const seed of seeds) {
      const key = normalizeText(seed.name);
      if (!key || globalSeen.has(key)) continue;
      if (discovered.length >= 10) break;

      if (!isSpecificVenueName(seed.name)) continue;
      if (blockedForMoodByName(seed.name, mood)) continue;

      // Strip area suffix before geocoding for better results
      const cleanName = seed.name.replace(MUMBAI_AREA_SUFFIX_RE, '').trim();
      const geocodeQueries = [
        `${cleanName}, ${areaLabel}, Mumbai, India`,
        `${cleanName}, Mumbai, India`,
        ...(cleanName !== seed.name ? [`${seed.name}, ${areaLabel}, Mumbai, India`] : []),
      ];

      let geo: Awaited<ReturnType<typeof forwardGeocode>> = null;
      const seenGeo = new Set<string>();
      for (const q of geocodeQueries) {
        const geoKey = normalizeText(q);
        if (seenGeo.has(geoKey)) continue;
        seenGeo.add(geoKey);
        geo = await forwardGeocode(q);
        if (geo) break;
      }
      if (!geo) continue;

      const distanceKm = haversineDistance(hubLocation, { lat: geo.lat, lng: geo.lng });
      const travelMins = estimateTravelTimeMins(distanceKm);
      const type = inferTavilyType(seed.context);

      // Travel-time based filtering
      if (type === 'activity') {
        if (travelMins > ACTIVITY_MAX_TRAVEL_TIME_MINS) continue;
      } else {
        if (travelMins > MAX_TRAVEL_TIME_MINS) continue;
      }

      // Zone check
      if (!isSameZone(hubLocation, { lat: geo.lat, lng: geo.lng }) && travelMins > 15) continue;

      let place: Place = withCostRange({
        name: seed.name,
        type,
        lat: geo.lat,
        lng: geo.lng,
        popularity: 60,
        area: areaLabel,
        description: extractSnippet(seed.context, `${type} near ${areaLabel}`),
        source: 'tavily',
        relevance_score: Math.max(0.5, 1 - distanceKm / 6),
        url: seed.url,
      }, avgBudget);

      if (!hasStrongActivitySignals(place)) continue;

      // Annotate with activity type and group suitability
      if (place.type === 'activity') {
        place.activity_type = inferActivityType(place.name);
        place.group_suitability = computeGroupSuitability(place, groupSize);
        if (place.group_suitability < 0.15) continue;
      }

      // If it's a cinema/theatre, look up actual showtimes
      if (isMovieLikeName(place.name)) {
        const showtimes = await lookupTheatreShowtimes(place.name, areaLabel);
        if (showtimes) {
          place = {
            ...place,
            description: `Now showing: ${showtimes.movies}. Tickets: ${showtimes.prices}. ${place.description}`,
          };
        } else {
          continue; // No showtime info → skip cinema
        }
      }

      place.confidence_score = computePlaceConfidence(place);
      if ((place.confidence_score || 0) < 0.4) continue;

      globalSeen.add(key);
      discovered.push(place);
    }

    console.log(`[Tavily] Accepted ${discovered.length} places for ${areaLabel}`);
    return dedupePlaces(discovered);
  } catch {
    return [];
  }
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

function sourceReliability(place: Place): number {
  if (place.source === 'typesense') return 0.95;
  if (place.source === 'tavily') return 0.82;
  return 0.72;
}

function computeNameQualityScore(name: string): number {
  if (!isSpecificVenueName(name)) return 0;

  const tokens = tokenQuality(name);
  const normalized = normalizeText(name);
  let score = 0.55;
  if (tokens.length >= 2) score += 0.2;
  if (tokens.length >= 3) score += 0.08;
  if (name.trim().length >= 10) score += 0.07;
  if (/(mall|cafe|coffee|arcade|promenade|gymkhana|club)/.test(normalized)) score += 0.05;
  if (/^(garden|ground|building|complex)$/.test(normalized)) score -= 0.35;

  return Math.max(0, Math.min(1, score));
}

function computeMetadataScore(place: Place): number {
  const hasTags = Array.isArray(place.tags) && place.tags.length > 0 ? 1 : 0;
  const hasRating = typeof place.inferred_rating === 'number' && place.inferred_rating > 0 ? 1 : 0;
  const hasPopularity = typeof place.popularity === 'number' && Number.isFinite(place.popularity) ? 1 : 0;
  const hasArea = Boolean(place.area && place.area.trim().length >= 2) ? 1 : 0;
  const hasUrl = Boolean(place.url && place.url.trim().length > 0) ? 1 : 0;

  return (hasTags + hasRating + hasPopularity + hasArea + hasUrl) / 5;
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
  const nameQuality = computeNameQualityScore(place.name);
  const metadata = computeMetadataScore(place);
  const reliability = sourceReliability(place);
  const typeValidity = ['cafe', 'restaurant', 'activity', 'outdoor'].includes(place.type) ? 1 : 0;

  return Math.max(
    0,
    Math.min(
      1,
      nameQuality * 0.36 +
        metadata * 0.28 +
        reliability * 0.24 +
        typeValidity * 0.12
    )
  );
}

function passesGeoAndLocality(place: Place, hubName: string, hubLocation: { lat: number; lng: number }): boolean {
  if (typeof place.lat !== 'number' || typeof place.lng !== 'number') return false;
  const distanceKm = haversineDistance(hubLocation, { lat: place.lat, lng: place.lng });
  if (distanceKm > MAX_PLACE_DISTANCE_KM) return false;

  const areaMatch = localityMatches(place.area, hubName);
  const localityMatch = nameHintsLocality(place.name, hubName);
  if (areaMatch || localityMatch) return true;

  // Keep very-nearby places even when area metadata is sparse.
  return distanceKm <= 2.2;
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

function withCostRange(place: Place, fallbackBudget: number): Place {
  const observedCost =
    typeof place.estimated_cost === 'number' && Number.isFinite(place.estimated_cost) && place.estimated_cost > 0
      ? place.estimated_cost
      : defaultEstimatedCost(place.type, fallbackBudget);

  const costRange = inferCostRange({
    name: place.name,
    type: place.type,
    description: place.description,
    tags: place.tags,
    estimatedCost: observedCost,
  });

  return {
    ...place,
    cost_range: costRange,
    estimated_cost: midpointCostRange(costRange),
  };
}

function computeSocialAffinity(place: Place): number {
  const text = normalizeText(`${place.name} ${place.description} ${(place.tags || []).join(' ')}`);
  const popularityScore = normalizePopularity(place.popularity);

  let baseByType = 0.56;
  if (place.type === 'cafe') baseByType = 0.9;
  if (place.type === 'restaurant') baseByType = 0.72;
  if (place.type === 'activity') baseByType = 0.78;
  if (place.type === 'outdoor') baseByType = 0.5;
  if (isWeakShoppingOnlyActivity(place)) baseByType = 0.4;

  let bonus = 0;

  // ── Strong engagement signals ──
  if (/\b(arcade|bowling|board game|escape room|trampoline|gaming|go.?kart|laser.?tag|vr|comedy|concert|live music)\b/.test(text)) {
    bonus += 0.18;
  }
  if (/\b(promenade|seaface|beach|viewpoint)\b/.test(text)) {
    bonus += 0.12;
  }
  if (/\b(cafe|coffee|food court)\b/.test(text)) {
    bonus += 0.1;
  }
  if (/\b(mall|shopping)\b/.test(text) && !isWeakShoppingOnlyActivity(place)) {
    bonus += 0.05;
  }

  // ── Boost known hangout chains ──
  if (HANGOUT_CHAIN_BOOSTS.some((chain) => text.includes(chain))) {
    bonus += 0.2;
  }

  // ── Penalize boring/generic places ──
  if (BORING_PLACE_PENALTIES.test(text)) {
    bonus -= 0.15;
  }
  if (/\b(garden|ground|building|complex)\b/.test(text) && tokenQuality(place.name).length <= 2) {
    bonus -= 0.18;
  }

  // Hard penalty for non-hangout activities (sports associations, gymkhanas, etc.)
  if (place.type === 'activity' && WEAK_ACTIVITY_BLOCKLIST.test(text)) {
    bonus -= 0.35;
  }

  return Math.max(0, Math.min(1, baseByType * 0.68 + popularityScore * 0.18 + bonus + 0.02));
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
  mood: Mood,
  hubName: string
): Place[] {
  if (typesensePlaces.length === 0) return osmPlaces;

  const osmKeys = new Set(osmPlaces.map((place) => normalizeText(place.name)));
  const enrichedTypesense = typesensePlaces
    .filter((place) => isSpecificVenueName(place.name))
    .filter((place) => hasStrongActivitySignals(place))
    .filter((place) => passesGeoAndLocality(place, hubName, hubLocation))
    .map((place) => {
      const pricedPlace = withCostRange(place, avgBudget);
      const distanceBoost =
        typeof pricedPlace.lat === 'number' && typeof pricedPlace.lng === 'number'
          ? Math.max(0.3, 1 - haversineDistance(hubLocation, { lat: pricedPlace.lat, lng: pricedPlace.lng }) / 6)
          : 0.55;
      const budget = pricedPlace.estimated_cost ?? defaultEstimatedCost(pricedPlace.type, avgBudget);
      const budgetBoost = budget <= avgBudget ? 1 : Math.max(0.45, 1 - (budget - avgBudget) / Math.max(avgBudget, 1));

      const normalized: Place = {
        ...pricedPlace,
        source: 'typesense' as const,
        relevance_score: Math.min(1, Math.max(pricedPlace.relevance_score, distanceBoost * 0.6 + budgetBoost * 0.4)),
      };
      const confidence = computePlaceConfidence(normalized);

      return {
        ...normalized,
        confidence_score: confidence,
        hangout_score: computeHangoutScore(
          {
            ...normalized,
            confidence_score: confidence,
          },
          mood,
          avgBudget,
          hubLocation
        ),
      };
    })
    .filter((place) => (place.confidence_score || 0) >= SOFT_PLACE_CONFIDENCE_THRESHOLD)
    .filter((place) => (place.hangout_score || 0) >= SOFT_HANGOUT_THRESHOLD)
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
  const normalized = text.replace(/,/g, ' ');

  const perPersonRangeMatch = normalized.match(
    /(?:₹|rs\.?|inr)\s*([0-9]{2,5})\s*(?:-|to)\s*(?:₹|rs\.?|inr)?\s*([0-9]{2,5})\s*(?:per\s*person|pp)?/i
  );
  if (perPersonRangeMatch) {
    const min = Number(perPersonRangeMatch[1]);
    const max = Number(perPersonRangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
      return Math.min(Math.max(Math.round((min + max) / 2), 80), 3000);
    }
  }

  const costForTwoMatch = normalized.match(
    /(?:cost\s*for\s*2|cost\s*for\s*two|for\s*2|for\s*two)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([0-9]{2,5})/i
  );
  if (costForTwoMatch) {
    const forTwo = Number(costForTwoMatch[1]);
    if (Number.isFinite(forTwo) && forTwo > 0) {
      return Math.min(Math.max(Math.round(forTwo / 2), 80), 3000);
    }
  }

  const explicitPerPersonMatch = normalized.match(
    /(?:₹|rs\.?|inr)\s*([0-9]{2,5})\s*(?:per\s*person|pp)/i
  );
  if (explicitPerPersonMatch) {
    const value = Number(explicitPerPersonMatch[1]);
    if (Number.isFinite(value) && value > 0) return Math.min(Math.max(value, 80), 3000);
  }

  const rupeeMatch = normalized.match(/(?:₹|rs\.?|inr)\s*([0-9]{2,5})/i);
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
  mood: Mood,
  avgBudget: number
): Promise<Place[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || places.length === 0) return places;

  try {
    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });
    const shortlist = places.slice(0, 14);
    const query = `For each exact venue in ${hubName}, Mumbai (${shortlist
      .map((p) => `"${p.name}"`)
      .join(', ')}), return short factual vibe hints and price signals in INR (preferably cost for two and per-person range) for ${mood} mood.`;

    const response = await withTimeout(
      client.search(query, {
        maxResults: 16,
        searchDepth: 'basic',
      }),
      TAVILY_TIMEOUT_MS
    );

    const results = (response.results || []) as TavilyResult[];
    if (!results.length) return places.map((place) => withCostRange(place, avgBudget));

    return places.map((place) => {
      const best = pickBestResultForPlace(place.name, results);
      if (!best) return withCostRange(place, avgBudget);

      const text = `${best.title} ${best.content}`;
      return withCostRange({
        ...place,
        description: extractSnippet(text, place.description),
        inferred_rating: place.inferred_rating ?? extractRatingValue(text),
        estimated_cost: place.estimated_cost ?? extractCostEstimate(text),
      }, avgBudget);
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
  const budget =
    place.cost_range
      ? midpointCostRange(place.cost_range)
      : place.estimated_cost ?? defaultEstimatedCost(place.type, perPersonCap);
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
  const socialAffinity = computeSocialAffinity(place);
  const ratingScore = place.inferred_rating ? Math.min(1, Math.max(0, (place.inferred_rating - 3) / 2)) : 0.5;
  const popularityScore = normalizePopularity(place.popularity);
  const confidenceScore = Math.max(0, Math.min(1, place.confidence_score ?? 0.5));

  // Travel-time penalty: -0.01 per minute of travel
  const travelMins = estimateTravelTimeMins(distanceKm);
  const travelPenalty = Math.min(0.25, travelMins * 0.01);

  // Tavily source boost: tavily-discovered places get a relevance bump
  const sourceBoost = place.source === 'tavily' ? 0.1 : 0;

  // Strong experiential activity bonus
  const experientialBonus = isStrongExperientialActivity(place) ? 0.08 : 0;

  // Group suitability factor (if annotated)
  const groupFactor = typeof place.group_suitability === 'number'
    ? (place.group_suitability - 0.3) * 0.15
    : 0;

  let score =
    socialAffinity * 0.34 +
    confidenceScore * 0.24 +
    moodScore * 0.14 +
    (ratingScore * 0.5 + popularityScore * 0.5) * 0.11 +
    budgetFit * 0.07 +
    distanceScore * 0.03 +
    sourceBoost +
    experientialBonus +
    groupFactor -
    travelPenalty;

  return Math.max(0, Math.min(1, score));
}

function selectBalancedTopPlaces(places: Place[]): Place[] {
  // Activity-first balancing to prevent food-heavy pools
  const quotas: Record<Place['type'], number> = {
    activity: 8,
    restaurant: 3,
    cafe: 3,
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
  const buildQuery = (opts: {
    radiusMeters: number;
    timeoutSeconds: number;
    limit: number;
    includeTourism: boolean;
  }) => {
    const selectors = [
      `nwr["amenity"~"cafe|restaurant|fast_food"]["name"](around:${opts.radiusMeters},${hubLocation.lat},${hubLocation.lng});`,
      `nwr["leisure"~"park|garden"]["name"](around:${opts.radiusMeters},${hubLocation.lat},${hubLocation.lng});`,
    ];

    if (opts.includeTourism) {
      selectors.push(
        `nwr["tourism"~"attraction|museum|gallery|viewpoint"]["name"](around:${opts.radiusMeters},${hubLocation.lat},${hubLocation.lng});`
      );
    }

    return `[out:json][timeout:${opts.timeoutSeconds}];(\n${selectors.join('\n')}\n);out center ${opts.limit};`;
  };

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
  ];

  const fetchFromEndpoint = async (endpoint: string, query: string): Promise<OsmElement[]> => {
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

      if (!response.ok) {
        throw new Error(`${endpoint} returned ${response.status}`);
      }

      const data = await response.json();
      if (typeof data?.remark === 'string' && data.remark.toLowerCase().includes('timed out')) {
        throw new Error(`${endpoint} timed out upstream`);
      }
      return (data.elements || []) as OsmElement[];
    } finally {
      clearTimeout(timer);
    }
  };

  const fetchBestBatch = async (query: string): Promise<OsmElement[]> => {
    const settled = await Promise.allSettled(
      endpoints.map((endpoint) => fetchFromEndpoint(endpoint, query))
    );
    const successful = settled
      .filter((result): result is PromiseFulfilledResult<OsmElement[]> => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter((batch) => Array.isArray(batch));

    if (successful.length === 0) return [];
    successful.sort((a, b) => b.length - a.length);
    return successful[0] || [];
  };

  const primary = await fetchBestBatch(
    buildQuery({
      radiusMeters: OSM_PRIMARY_RADIUS_METERS,
      timeoutSeconds: 18,
      limit: OSM_PRIMARY_LIMIT,
      includeTourism: false,
    })
  );

  const elements: OsmElement[] = [...primary];
  if (elements.length < 24) {
    const secondary = await fetchBestBatch(
      buildQuery({
        radiusMeters: OSM_SECONDARY_RADIUS_METERS,
        timeoutSeconds: 22,
        limit: OSM_SECONDARY_LIMIT,
        includeTourism: true,
      })
    );
    if (secondary.length > 0) {
      const seen = new Set(elements.map((element) => `${element.tags?.name || ''}:${element.lat || element.center?.lat}:${element.lon || element.center?.lon}`));
      for (const element of secondary) {
        const key = `${element.tags?.name || ''}:${element.lat || element.center?.lat}:${element.lon || element.center?.lon}`;
        if (seen.has(key)) continue;
        seen.add(key);
        elements.push(element);
      }
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
      if ((osmType === 'park' || osmType === 'garden') && !hasSelectiveOutdoorSignals(name, tags)) {
        return null;
      }

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

      const place: Place = withCostRange({
        name,
        type,
        lat,
        lng,
        popularity: inferOsmPopularity(tags),
        area: tags['addr:suburb'] || tags['addr:district'] || hubName,
        tags: rawTags,
        description: detail + ' near ' + hubName,
        source: 'osm_fallback',
        relevance_score: Math.round(relevance * 100) / 100,
      }, avgBudget);

      if (!hasStrongActivitySignals(place)) return null;

      place.confidence_score = computePlaceConfidence(place);
      place.hangout_score = computeHangoutScore(place, 'chill', avgBudget, hubLocation);
      if ((place.confidence_score || 0) < OSM_STRICT_CONFIDENCE_THRESHOLD) return null;
      if ((place.hangout_score || 0) < OSM_STRICT_HANGOUT_THRESHOLD) return null;

      return place;
    })
    .filter((place): place is Place => place !== null);

  return dedupePlaces(places);
}

/**
 * Data pipeline (OSM + Typesense + Tavily discovery):
 * 1) Fetch real nearby places from OSM around hub centroid.
 * 2) Blend in nearby Typesense candidates side-by-side (without replacing OSM).
 * 3) Always run Tavily discovery in parallel for additional diversity.
 * 4) Enrich existing places with Tavily hints for pricing/vibe data.
 * 5) Rank by hangout quality, budget, mood, and proximity with type variety constraints.
 * 6) Ensure at least one strong experiential activity (bowling, arcade, escape room, etc.)
 */
export async function searchPlaces(
  hubName: string,
  hubLocation: { lat: number; lng: number },
  mood: Mood,
  avgBudget: number,
  groupSize: number = 3
): Promise<Place[]> {
  const slug = hubName.toLowerCase().replace(/\s+/g, '_');
  const cacheKey = `places_pipeline:v12:${slug}:${mood}:${Math.round(avgBudget / 50) * 50}:g${groupSize}`;

  const cached = await cacheGet<Place[]>(cacheKey);
  if (cached) return cached;

  const inflight = inflightSearches.get(cacheKey);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      // Run all three sources in parallel (Tavily always, not just as fallback)
      const [osmPlaces, typesensePlaces, tavilyFallbackPlaces] = await Promise.all([
        fetchStructuredOsmPlaces(hubName, hubLocation, avgBudget),
        searchTypesensePlaces(hubName, mood, avgBudget),
        discoverTavilyFallbackPlaces(hubName, hubLocation, mood, avgBudget, groupSize),
      ]);

      const curatedPlaces = getCuratedVenues(hubName, hubLocation, mood, avgBudget, 12)
        .map((place) => {
          const priced = withCostRange(place, avgBudget);
          return {
            ...priced,
            confidence_score: priced.confidence_score ?? computePlaceConfidence(priced),
            area: priced.area || hubName,
            relevance_score: Math.max(0.45, priced.relevance_score),
          };
        })
        .filter((place) => hasStrongActivitySignals(place));

      // Logging
      const sourceLog = {
        osm: osmPlaces.length,
        typesense: typesensePlaces.length,
        tavily: tavilyFallbackPlaces.length,
        curated: curatedPlaces.length,
      };
      console.log(`[PlacePipeline] ${hubName} sources:`, JSON.stringify(sourceLog));

      if (osmPlaces.length === 0) {
        console.warn(`[PlacePipeline] OSM returned no places for hub ${hubName}`);
      }

      let sourcedPlaces = blendOsmAndTypesense(osmPlaces, typesensePlaces, hubLocation, avgBudget, mood, hubName);
      if (tavilyFallbackPlaces.length > 0) {
        sourcedPlaces = dedupePlaces([...sourcedPlaces, ...tavilyFallbackPlaces]);
      }

      const hasActiveOrOutdoor = sourcedPlaces.some(
        (place) => place.type === 'activity' || place.type === 'outdoor'
      );
      if ((sourcedPlaces.length < 10 || !hasActiveOrOutdoor) && curatedPlaces.length > 0) {
        sourcedPlaces = dedupePlaces([...sourcedPlaces, ...curatedPlaces]);
      }

      const enrichedPlaces = await enrichPlacesWithTavilyHints(sourcedPlaces, hubName, mood, avgBudget);
      const geoValidated = enrichedPlaces
        .map((place): Place | null => {
          const priced = withCostRange(place, avgBudget);
          if (!hasStrongActivitySignals(priced)) return null;

          const confidence = computePlaceConfidence(priced);
          const normalized: Place = {
            ...priced,
            confidence_score: confidence,
          };

          const scored: Place = {
            ...normalized,
            hangout_score: computeHangoutScore(normalized, mood, avgBudget, hubLocation),
          };

          // Annotate activities with type and group suitability
          if (scored.type === 'activity') {
            scored.activity_type = inferActivityType(scored.name);
            scored.group_suitability = computeGroupSuitability(scored, groupSize);
          }

          return scored;
        })
        .filter((place): place is Place => place !== null)
        .filter((place) => isSpecificVenueName(place.name))
        .filter((place) => !blockedForMoodByName(place.name, mood))
        .filter((place) => !looksCinemaWithoutShowtime(place))
        .filter((place) => (place.confidence_score || 0) >= SOFT_PLACE_CONFIDENCE_THRESHOLD)
        .filter((place) => (place.hangout_score || 0) >= SOFT_HANGOUT_THRESHOLD)
        .filter((place) => {
          if (typeof place.lat !== 'number' || typeof place.lng !== 'number') return false;
          const distKm = haversineDistance(hubLocation, { lat: place.lat, lng: place.lng });
          // Travel-time-based filtering with activity exception
          return passesTravelTimeConstraint(distKm, place.type, place.hangout_score || 0);
        })
        // Hard reject activities with bad group fit
        .filter((place) => {
          if (place.type === 'activity' && typeof place.group_suitability === 'number') {
            return place.group_suitability >= 0.15;
          }
          return true;
        });

      const strictPlaces = geoValidated
        .filter((place) => passesGeoAndLocality(place, hubName, hubLocation))
        .filter((place) => (place.confidence_score || 0) >= STRICT_PLACE_CONFIDENCE_THRESHOLD)
        .filter((place) => (place.hangout_score || 0) >= STRICT_HANGOUT_THRESHOLD);

      const softPlaces = geoValidated
        .filter((place) => {
          if ((place.confidence_score || 0) < SOFT_PLACE_CONFIDENCE_THRESHOLD) return false;
          if ((place.hangout_score || 0) < SOFT_HANGOUT_THRESHOLD) return false;
          if (passesGeoAndLocality(place, hubName, hubLocation)) return true;
          if (typeof place.lat !== 'number' || typeof place.lng !== 'number') return false;
          return haversineDistance(hubLocation, { lat: place.lat, lng: place.lng }) <= 2.6;
        });

      const candidatePool = strictPlaces.length >= 8
        ? strictPlaces
        : softPlaces.length > 0
        ? softPlaces
        : geoValidated;

      const ranked = [...candidatePool]
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
              confidence_score: place.confidence_score ?? computePlaceConfidence(place),
            },
            distanceKm,
            vibeAlignment,
            hangoutScore,
            confidence: place.confidence_score ?? computePlaceConfidence(place),
            qualityScore:
              hangoutScore * 0.56 +
              (place.confidence_score ?? computePlaceConfidence(place)) * 0.34 +
              vibeAlignment * 0.1,
          };
        })
        .sort((a, b) => {
          if (b.qualityScore !== a.qualityScore) {
            return b.qualityScore - a.qualityScore;
          }

          const confidenceDelta = b.confidence - a.confidence;
          if (Math.abs(confidenceDelta) > 0.01) return confidenceDelta;

          return a.distanceKm - b.distanceKm;
        })
        .map((entry) => entry.place);

      const balanced = selectBalancedTopPlaces(ranked);
      let finalPlaces = dedupePlaces(balanced);

      // CRITICAL: Ensure at least one strong experiential activity (bowling, arcade, escape room, etc.)
      const hasStrongActivity = finalPlaces.some((place) => isStrongExperientialActivity(place));
      if (!hasStrongActivity) {
        // Search all pools for a strong activity
        const allActivitySources = dedupePlaces([
          ...geoValidated,
          ...curatedPlaces,
          ...tavilyFallbackPlaces,
        ])
          .filter((place) => isStrongExperientialActivity(place))
          .filter((place) => !blockedForMoodByName(place.name, mood))
          .filter((place) => typeof place.lat === 'number' && typeof place.lng === 'number')
          .filter((place) => {
            const distKm = haversineDistance(hubLocation, { lat: place.lat as number, lng: place.lng as number });
            return passesTravelTimeConstraint(distKm, 'activity', place.hangout_score || 0.6);
          })
          .sort((a, b) => (b.hangout_score || 0) - (a.hangout_score || 0))
          .slice(0, 2);

        if (allActivitySources.length > 0) {
          // Replace the lowest-scored non-activity place with the best strong activity
          const worstNonActivity = [...finalPlaces]
            .filter((p) => p.type !== 'activity')
            .sort((a, b) => (a.hangout_score || 0) - (b.hangout_score || 0))[0];
          if (worstNonActivity) {
            finalPlaces = finalPlaces.filter((p) => normalizeText(p.name) !== normalizeText(worstNonActivity.name));
          }
          finalPlaces = dedupePlaces([...allActivitySources.slice(0, 1), ...finalPlaces]);
        }
      }

      // Ensure activity/outdoor presence as before
      const hasFinalActiveOrOutdoor = finalPlaces.some(
        (place) => place.type === 'activity' || place.type === 'outdoor'
      );
      if (!hasFinalActiveOrOutdoor) {
        const localActivityBackfill = dedupePlaces([
          ...geoValidated,
          ...curatedPlaces,
          ...tavilyFallbackPlaces,
        ])
          .filter((place) => place.type === 'activity' || place.type === 'outdoor')
          .filter((place) => !blockedForMoodByName(place.name, mood))
          .filter((place) => typeof place.lat === 'number' && typeof place.lng === 'number')
          .filter(
            (place) =>
              haversineDistance(hubLocation, {
                lat: place.lat as number,
                lng: place.lng as number,
              }) <= 2.8
          )
          .slice(0, 4);

        if (localActivityBackfill.length > 0) {
          finalPlaces = dedupePlaces([...localActivityBackfill, ...finalPlaces]);
        }
      }

      if (finalPlaces.length === 0 && curatedPlaces.length > 0) {
        finalPlaces = curatedPlaces
          .filter((place) => typeof place.lat === 'number' && typeof place.lng === 'number')
          .filter((place) => haversineDistance(hubLocation, { lat: place.lat as number, lng: place.lng as number }) <= MAX_PLACE_DISTANCE_KM)
          .slice(0, 10);
      }

      finalPlaces = finalPlaces
        .map((place) => withCostRange(place, avgBudget))
        .filter((place) => hasStrongActivitySignals(place));

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
