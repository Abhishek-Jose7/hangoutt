import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import type { HubCandidate, ItineraryProfile, Mood, Place } from '@/types';
import { forwardGeocode } from '@/lib/geocoding';
import { searchPlaces } from '@/lib/tavily';
import { generateGroundedItineraryForHub } from '@/lib/itinerary-engine';
import { reviewDeterministicItineraryWithGroq } from '@/lib/ai/generate-itinerary';
import {
  finalValidatePlacesBeforeEngine,
  validateGroundedPlaces,
} from '@/lib/place-validation';

const VALID_MOODS: Mood[] = ['fun', 'chill', 'romantic', 'adventure'];
const VALID_PROFILES: ItineraryProfile[] = [
  'chill_walk',
  'activity_food',
  'premium_dining',
  'budget_bites',
];

const PROFILE_ALIASES: Record<string, ItineraryProfile> = {
  chill: 'chill_walk',
  chill_activity: 'chill_walk',
  'chill activity': 'chill_walk',
  walk: 'chill_walk',
  activity: 'activity_food',
  foodie: 'activity_food',
  premium: 'premium_dining',
  budget: 'budget_bites',
};

const HUB_COORD_FALLBACK: Record<string, { lat: number; lng: number; label: string }> = {
  bandra: { lat: 19.0606, lng: 72.8347, label: 'Bandra' },
  kurla: { lat: 19.0728, lng: 72.8826, label: 'Kurla' },
  andheri: { lat: 19.1197, lng: 72.8464, label: 'Andheri' },
  dadar: { lat: 19.0187, lng: 72.8422, label: 'Dadar' },
  juhu: { lat: 19.1075, lng: 72.8263, label: 'Juhu' },
  powai: { lat: 19.1176, lng: 72.906, label: 'Powai' },
  'lower parel': { lat: 18.9989, lng: 72.8288, label: 'Lower Parel' },
  colaba: { lat: 18.9067, lng: 72.8147, label: 'Colaba' },
  churchgate: { lat: 18.9351, lng: 72.8273, label: 'Churchgate' },
  csmt: { lat: 18.9401, lng: 72.8356, label: 'CSMT' },
  nerul: { lat: 19.033, lng: 73.0297, label: 'Nerul, Navi Mumbai' },
};

type CliOptions = {
  location?: string;
  lat?: number;
  lng?: number;
  mood?: Mood;
  budget?: number;
  start?: string;
  profile?: ItineraryProfile;
  groupSize?: number;
  trace: boolean;
  strict: boolean;
};

type ParsedArgs = {
  options: CliOptions;
  showHelp: boolean;
};

type TraceStats = {
  failedByProvider: Record<string, number>;
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function haversineDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * R * Math.asin(Math.sqrt(h));
}

function parseStartTime(value: string): string {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return '17:30';
  return `${match[1]}:${match[2]}`;
}

function resolveProfileInput(value: string | undefined): ItineraryProfile | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (VALID_PROFILES.includes(normalized as ItineraryProfile)) {
    return normalized as ItineraryProfile;
  }
  return PROFILE_ALIASES[normalized];
}

function providerFromUrl(url: string): string {
  const lowered = url.toLowerCase();
  if (lowered.includes('overpass')) return 'osm-overpass';
  if (lowered.includes('typesense')) return 'typesense';
  if (lowered.includes('tavily')) return 'tavily';
  if (lowered.includes('groq')) return 'groq';
  if (lowered.includes('nominatim')) return 'nominatim';
  if (lowered.includes('upstash')) return 'upstash';
  return 'external';
}

function installFetchTracer(enabled: boolean): { restore: () => void; stats: TraceStats } {
  const stats: TraceStats = {
    failedByProvider: {},
  };

  if (!enabled || typeof globalThis.fetch !== 'function') {
    return {
      restore: () => {},
      stats,
    };
  }

  const original = globalThis.fetch.bind(globalThis);
  let sequence = 0;

  const tracedFetch: typeof fetch = async (resource, init) => {
    const id = ++sequence;
    const url =
      typeof resource === 'string'
        ? resource
        : resource instanceof URL
        ? resource.toString()
        : resource.url;

    const method =
      init?.method || (resource instanceof Request ? resource.method : 'GET');

    const provider = providerFromUrl(url);
    const startedAt = Date.now();

    console.log(`\n[HTTP ${id}] -> ${method.toUpperCase()} ${url}`);
    console.log(`[HTTP ${id}] provider=${provider}`);

    if (typeof init?.body === 'string' && init.body.trim()) {
      const bodyPreview = init.body.replace(/\s+/g, ' ').slice(0, 420);
      console.log(`[HTTP ${id}] body=${bodyPreview}`);
    }

    try {
      const response = await original(resource, init);
      const elapsed = Date.now() - startedAt;
      console.log(
        `[HTTP ${id}] <- ${response.status} ${response.statusText} (${elapsed}ms)`
      );

      if (!response.ok) {
        stats.failedByProvider[provider] = (stats.failedByProvider[provider] || 0) + 1;
        try {
          const text = await response.clone().text();
          const preview = text.replace(/\s+/g, ' ').slice(0, 420);
          console.log(`[HTTP ${id}] error-preview=${preview}`);
        } catch {
          console.log(`[HTTP ${id}] error-preview=<unavailable>`);
        }
      }

      return response;
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      stats.failedByProvider[provider] = (stats.failedByProvider[provider] || 0) + 1;
      console.log(`[HTTP ${id}] !! failed (${elapsed}ms): ${message}`);
      throw error;
    }
  };

  globalThis.fetch = tracedFetch;

  return {
    restore: () => {
      globalThis.fetch = original;
    },
    stats,
  };
}

function envState(name: string): string {
  const value = process.env[name];
  return value && value.trim() ? 'set' : 'missing';
}

function printEnvDiagnostics(): void {
  console.log('\n=== Provider Env Diagnostics ===');
  console.log(`TAVILY_API_KEY: ${envState('TAVILY_API_KEY')}`);
  console.log(`TYPESENSE_HOST: ${envState('TYPESENSE_HOST')}`);
  console.log(`TYPESENSE_API_KEY: ${envState('TYPESENSE_API_KEY')}`);
  console.log(`TYPESENSE_COLLECTION: ${process.env.TYPESENSE_COLLECTION || 'venues (default)'}`);
  console.log(`GROQ_API_KEYS: ${envState('GROQ_API_KEYS')}`);
  console.log(`GROQ_API_KEY_GENERATOR: ${envState('GROQ_API_KEY_GENERATOR')}`);
  console.log(`GROQ_API_KEY_RETRY: ${envState('GROQ_API_KEY_RETRY')}`);
  console.log(`GROQ_API_KEY_OVERSEER: ${envState('GROQ_API_KEY_OVERSEER')}`);
  console.log('================================\n');
}

function sourceBreakdown(places: Place[]): Record<string, number> {
  return places.reduce<Record<string, number>>((acc, place) => {
    const label =
      place.source === 'osm_fallback'
        ? 'osm'
        : place.source === 'typesense'
        ? 'typesense'
        : 'tavily';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

function isBlockedForMoodByName(placeName: string, mood: Mood): boolean {
  const text = normalizeText(placeName);
  const padded = ` ${text} `;
  const alwaysBlocked = [
    'wine shop',
    'liquor',
    'permit room',
    'beer shop',
    'alcohol shop',
    'wine and more',
  ];

  if (alwaysBlocked.some((token) => text.includes(token))) {
    return true;
  }

  if (padded.includes(' wine ') || padded.includes(' wines ')) {
    return true;
  }

  const nonHangoutLandmarks = [
    ' shrine ',
    ' oratory ',
    ' bungalow ',
    ' memorial ',
    ' cemetery ',
    ' dargah ',
    ' fort gate ',
  ];
  if (nonHangoutLandmarks.some((token) => padded.includes(token))) {
    return true;
  }

  if (padded.includes(' house ') && !padded.includes(' coffee house ')) {
    return true;
  }

  if (/\b(cinema|theatre|theater|movie|pvr|inox|imax)\b/i.test(text)) {
    return true;
  }

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
    if (chillBlocked.some((token) => padded.includes(token))) {
      return true;
    }
  }

  // Block generic non-hangout places regardless of mood
  const nonHangoutGeneric = [
    ' sports association ',
    ' sports club ',
    ' gymkhana ',
    ' recreation ground ',
    ' sports ground ',
  ];
  if (nonHangoutGeneric.some((token) => padded.includes(token))) {
    return true;
  }

  return false;
}

function printGenerationDiagnostics(places: Place[], mood: Mood): void {
  const byType = places.reduce<Record<string, number>>((acc, place) => {
    acc[place.type] = (acc[place.type] || 0) + 1;
    return acc;
  }, {});

  const blocked = places.filter((place) => isBlockedForMoodByName(place.name, mood));
  const moodSafe = places.filter((place) => !isBlockedForMoodByName(place.name, mood));
  const moodSafeByType = moodSafe.reduce<Record<string, number>>((acc, place) => {
    acc[place.type] = (acc[place.type] || 0) + 1;
    return acc;
  }, {});

  console.log('\n=== Stage 3 Diagnostics ===');
  console.log(`Input type counts: ${JSON.stringify(byType)}`);
  console.log(`Mood-safe type counts (${mood}): ${JSON.stringify(moodSafeByType)}`);
  if (blocked.length > 0) {
    console.log('Blocked-by-name candidates:');
    blocked.slice(0, 12).forEach((place, index) => {
      console.log(`${index + 1}. ${place.name} (${place.type})`);
    });
  }
  console.log('===========================\n');
}

function printPlacesPreview(places: Place[], hub: { lat: number; lng: number }): void {
  const MUMBAI_AVG_SPEED = 18;
  console.log('\n=== Candidate Places (Top 20) ===');
  places.slice(0, 20).forEach((place, idx) => {
    const distance =
      typeof place.lat === 'number' && typeof place.lng === 'number'
        ? haversineDistance(hub, { lat: place.lat, lng: place.lng }).toFixed(2)
        : 'n/a';
    const travelMins = typeof place.lat === 'number' && typeof place.lng === 'number'
      ? Math.round((haversineDistance(hub, { lat: place.lat, lng: place.lng }) / MUMBAI_AVG_SPEED) * 60)
      : 'n/a';

    console.log(
      [
        `${idx + 1}. ${place.name}`,
        `type=${place.type}`,
        `source=${place.source}`,
        `dist_km=${distance}`,
        `travel_min=${travelMins}`,
        `cost=${place.estimated_cost ?? 'n/a'}`,
        `confidence=${place.confidence_score ?? 'n/a'}`,
        `hangout=${place.hangout_score ?? 'n/a'}`,
        place.activity_type ? `act_type=${place.activity_type}` : '',
        typeof place.group_suitability === 'number' ? `grp_fit=${place.group_suitability.toFixed(2)}` : '',
      ].filter(Boolean).join(' | ')
    );
  });
  console.log('=================================\n');
}

function printHelp(): void {
  console.log('\nHangout Itinerary Debug CLI\n');
  console.log('This runner follows the same website generation path:');
  console.log('searchPlaces (OSM + Typesense + Tavily) -> validation -> grounded engine -> Groq reviewer');
  console.log('');
  console.log('Quick run:');
  console.log('  bun run itinerary Bandra -m chill -b 900 -t 18:00 -p chill_walk --trace');
  console.log('');
  console.log('Flags:');
  console.log('  -l, --location, --hub   Hub/location name');
  console.log('  -m, --mood              fun | chill | romantic | adventure');
  console.log('  -b, --budget            Budget per person (INR)');
  console.log('  -t, --start             Meetup start HH:MM');
  console.log('  -p, --profile           chill_walk | activity_food | premium_dining | budget_bites');
  console.log('      --lat               Manual latitude override');
  console.log('      --lng               Manual longitude override');
  console.log('      --trace             Verbose per-request API logs (default)');
  console.log('      --no-trace          Disable network request tracing');
  console.log('      --strict            Fail if fallback-style output detected (default)');
  console.log('      --no-strict         Allow degraded output');
  console.log('  -g, --group-size        Number of people in the group (default 3)');
  console.log('  -h, --help              Show this help\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: CliOptions = {
    trace: true,
    strict: true,
  };
  let showHelp = false;

  const readValue = (index: number): string | null => {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) return null;
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];

    if (key === '--help' || key === '-h') {
      showHelp = true;
      continue;
    }

    if (key === '--trace') {
      options.trace = true;
      continue;
    }

    if (key === '--no-trace') {
      options.trace = false;
      continue;
    }

    if (key === '--strict') {
      options.strict = true;
      continue;
    }

    if (key === '--no-strict') {
      options.strict = false;
      continue;
    }

    if (!key.startsWith('-')) {
      if (!options.location) {
        options.location = key.trim();
      }
      continue;
    }

    const next = readValue(i);
    if (!next) continue;

    switch (key) {
      case '--location':
      case '--hub':
      case '-l':
        options.location = next.trim();
        i += 1;
        break;
      case '--mood':
      case '-m':
        if (VALID_MOODS.includes(next as Mood)) {
          options.mood = next as Mood;
        }
        i += 1;
        break;
      case '--lat': {
        const value = Number(next);
        if (Number.isFinite(value) && value >= -90 && value <= 90) {
          options.lat = value;
        }
        i += 1;
        break;
      }
      case '--lng': {
        const value = Number(next);
        if (Number.isFinite(value) && value >= -180 && value <= 180) {
          options.lng = value;
        }
        i += 1;
        break;
      }
      case '--budget':
      case '-b': {
        const value = Number(next);
        if (Number.isFinite(value) && value > 0) {
          options.budget = Math.round(value);
        }
        i += 1;
        break;
      }
      case '--start':
      case '-t':
        options.start = next;
        i += 1;
        break;
      case '--profile':
      case '-p':
        {
          const resolved = resolveProfileInput(next);
          if (resolved) {
            options.profile = resolved;
          }
        }
        i += 1;
        break;
      case '--group-size':
      case '-g': {
        const value = Number(next);
        if (Number.isFinite(value) && value >= 1 && value <= 20) {
          options.groupSize = Math.round(value);
        }
        i += 1;
        break;
      }
      default:
        break;
    }
  }

  return { options, showHelp };
}

async function promptForMissing(options: CliOptions): Promise<Required<CliOptions>> {
  const rl = createInterface({ input, output });

  try {
    const location =
      options.location ||
      (await rl.question('Location / hub area (example: Bandra West): ')).trim();

    const moodInput = (
      options.mood ||
      (await rl.question('Mood [fun/chill/romantic/adventure] (default fun): '))
        .trim()
        .toLowerCase() ||
      'fun'
    ) as Mood;

    const mood: Mood = VALID_MOODS.includes(moodInput) ? moodInput : 'fun';

    const budgetRaw =
      options.budget ||
      Number(
        (await rl.question('Budget per person in INR (default 1200): ')).trim() || '1200'
      );

    const budget =
      Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.round(budgetRaw) : 1200;

    const startRaw =
      options.start ||
      (await rl.question('Meetup start HH:MM (default 17:30): ')).trim() ||
      '17:30';

    const profileInput = (
      options.profile ||
      (await rl.question(
        'Profile [chill_walk/activity_food/premium_dining/budget_bites] (default activity_food): '
      ))
        .trim() ||
      'activity_food'
    );

    const profile = resolveProfileInput(profileInput) || 'activity_food';

    return {
      location,
      lat: options.lat ?? 0,
      lng: options.lng ?? 0,
      mood,
      budget,
      start: parseStartTime(startRaw),
      profile,
      groupSize: options.groupSize ?? 3,
      trace: options.trace,
      strict: options.strict,
    };
  } finally {
    rl.close();
  }
}

async function resolveLocation(inputData: Required<CliOptions>): Promise<{
  lat: number;
  lng: number;
  displayName: string;
  resolver: 'manual' | 'geocode' | 'fallback-map';
}> {
  if (
    Number.isFinite(inputData.lat) &&
    Number.isFinite(inputData.lng) &&
    inputData.lat !== 0 &&
    inputData.lng !== 0
  ) {
    return {
      lat: inputData.lat,
      lng: inputData.lng,
      displayName: `${inputData.location} (manual coordinates)`,
      resolver: 'manual',
    };
  }

  const geocodeQueries = [
    `${inputData.location}, Mumbai, India`,
    `${inputData.location}, Navi Mumbai, India`,
    `${inputData.location}, Maharashtra, India`,
    `${inputData.location}, India`,
  ];

  const seenQueries = new Set<string>();
  for (const query of geocodeQueries) {
    const normalizedQuery = normalizeText(query);
    if (seenQueries.has(normalizedQuery)) continue;
    seenQueries.add(normalizedQuery);

    const geocoded = await forwardGeocode(query);
    if (!geocoded) continue;

    return {
      lat: geocoded.lat,
      lng: geocoded.lng,
      displayName: geocoded.display_name,
      resolver: 'geocode',
    };
  }

  const normalized = normalizeText(inputData.location);
  const alias = Object.keys(HUB_COORD_FALLBACK).find((key) =>
    normalized.includes(normalizeText(key)) ||
    normalizeText(key).includes(normalized)
  );

  if (alias) {
    const hit = HUB_COORD_FALLBACK[alias];
    return {
      lat: hit.lat,
      lng: hit.lng,
      displayName: `${hit.label} (fallback map)`,
      resolver: 'fallback-map',
    };
  }

  throw new Error(
    `Could not resolve location: ${inputData.location}. Try adding city context (e.g. "Navi Mumbai") or use --lat and --lng.`
  );
}

function printItinerary(result: {
  location: string;
  geocodedName: string;
  resolvedBy: 'manual' | 'geocode' | 'fallback-map';
  mood: Mood;
  budget: number;
  profile: ItineraryProfile;
  sourceCounts: Record<string, number>;
  placesCount: number;
  preValidatedCount: number;
  verifiedCount: number;
  model: string | null;
  plan: ReturnType<typeof generateGroundedItineraryForHub>['plan'];
}): void {
  console.log('\n=== Hangout Itinerary (Website Path) ===');
  console.log(`Area: ${result.location}`);
  console.log(`Resolved: ${result.geocodedName} [${result.resolvedBy}]`);
  console.log(`Mood: ${result.mood} | Budget/person: INR ${result.budget}`);
  console.log(`Profile: ${result.profile}`);
  console.log(`Sources: ${JSON.stringify(result.sourceCounts)}`);
  console.log(
    `Counts: fetched=${result.placesCount}, preValidated=${result.preValidatedCount}, verified=${result.verifiedCount}`
  );
  console.log(`Model: ${result.model || 'none'}`);
  console.log(`Title: ${result.plan.short_title || 'Grounded itinerary'}`);
  console.log(`Summary: ${result.plan.day_summary}`);
  console.log(
    `Total cost/person: INR ${result.plan.total_cost_per_person} (+ buffer INR ${result.plan.contingency_buffer})`
  );

  console.log('\nStops:');
  for (const stop of result.plan.stops) {
    console.log(
      `${stop.stop_number}. ${stop.start_time} | ${stop.place_name} | ${stop.place_type} | INR ${stop.estimated_cost_per_person} | ${stop.duration_mins} min`
    );
    if (stop.map_url) {
      console.log(`   map: ${stop.map_url}`);
    }
  }

  if (result.plan.flow_summary) {
    console.log(`\nFlow: ${result.plan.flow_summary}`);
  }
  if (result.plan.why_this_option) {
    console.log(`Why: ${result.plan.why_this_option}`);
  }

  console.log('========================================\n');
}

function collectPlanQualityIssues(
  plan: ReturnType<typeof generateGroundedItineraryForHub>['plan'],
  mood: Mood
): string[] {
  const issues: string[] = [];
  let foodStops = 0;
  let heavyMealStops = 0;

  for (let i = 0; i < plan.stops.length; i++) {
    const stop = plan.stops[i];
    const isFoodStop = stop.place_type === 'restaurant' || stop.place_type === 'cafe' || stop.category_label === 'dessert';
    const isHeavyMeal = stop.place_type === 'restaurant' || stop.category_label === 'restaurant';

    if (isBlockedForMoodByName(stop.place_name, mood)) {
      issues.push(`Stop ${i + 1} mood/name mismatch: ${stop.place_name}`);
    }

    if (i > 0 && stop.place_type === plan.stops[i - 1].place_type) {
      issues.push(
        `Consecutive duplicate place types at stops ${i} and ${i + 1} (${stop.place_type})`
      );
    }

    if (
      i > 0 &&
      isFoodStop &&
      (plan.stops[i - 1].place_type === 'restaurant' ||
        plan.stops[i - 1].place_type === 'cafe' ||
        plan.stops[i - 1].category_label === 'dessert')
    ) {
      issues.push(`Back-to-back food-heavy stops at ${i} and ${i + 1}`);
    }

    if (stop.walk_from_previous_mins > 35) {
      issues.push(`Excessive transfer at stop ${i + 1} (${stop.walk_from_previous_mins} mins)`);
    }

    if (isFoodStop) foodStops += 1;
    if (isHeavyMeal) heavyMealStops += 1;
  }

  if (foodStops > 1) {
    issues.push(`Too many food stops (${foodStops}); expected at most 1`);
  }

  if (heavyMealStops > 1) {
    issues.push(`Too many heavy meal stops (${heavyMealStops}); expected at most 1`);
  }

  const geoStops = plan.stops.filter(
    (stop): stop is typeof stop & { lat: number; lng: number } =>
      typeof stop.lat === 'number' &&
      Number.isFinite(stop.lat) &&
      typeof stop.lng === 'number' &&
      Number.isFinite(stop.lng)
  );

  if (geoStops.length >= 3) {
    const anchor = { lat: geoStops[0].lat, lng: geoStops[0].lng };
    const farthest = geoStops.reduce((max, stop) => {
      const dist = haversineDistance(anchor, { lat: stop.lat, lng: stop.lng });
      return Math.max(max, dist);
    }, 0);

    if (farthest > 3.4) {
      issues.push(`Stops are too spread out (${farthest.toFixed(1)}km) for one local-area hangout`);
    }
  }

  // Check for zone jumping (lat/lng delta > 0.05)
  if (geoStops.length >= 2) {
    for (let i = 1; i < geoStops.length; i++) {
      const prev = geoStops[i - 1];
      const curr = geoStops[i];
      const latDelta = Math.abs(prev.lat - curr.lat);
      const lngDelta = Math.abs(prev.lng - curr.lng);
      if (latDelta > 0.05 || lngDelta > 0.05) {
        const stepDist = haversineDistance(
          { lat: prev.lat, lng: prev.lng },
          { lat: curr.lat, lng: curr.lng }
        );
        issues.push(
          `Zone jump between stops ${i} and ${i + 1}: ${stepDist.toFixed(1)}km apart (different Mumbai zone)`
        );
      }
    }
  }

  // Check total travel time
  if (geoStops.length >= 2) {
    const MUMBAI_SPEED = 18;
    let totalTravelMins = 0;
    for (let i = 1; i < geoStops.length; i++) {
      const dist = haversineDistance(
        { lat: geoStops[i - 1].lat, lng: geoStops[i - 1].lng },
        { lat: geoStops[i].lat, lng: geoStops[i].lng }
      );
      totalTravelMins += (dist / MUMBAI_SPEED) * 60;
    }
    if (totalTravelMins > 55) {
      issues.push(`Excessive total travel time: ${Math.round(totalTravelMins)} mins (max 55)`);
    }
  }

  // Check for strong experiential activity
  const strongKw = [
    'bowling', 'arcade', 'gaming', 'trampoline', 'escape', 'vr',
    'go kart', 'smaaash', 'timezone', 'bounce', 'pvr', 'inox',
    'cinema', 'museum', 'comedy', 'concert', 'snow world',
  ];
  const hasStrongActivity = plan.stops.some((stop) => {
    const text = normalizeText(`${stop.place_name}`);
    return strongKw.some((kw) => text.includes(kw));
  });
  if (!hasStrongActivity) {
    issues.push('No strong experiential activity (bowling, arcade, escape room, etc.) in itinerary');
  }

  return issues;
}

function buildProfileFallbackOrder(primary: ItineraryProfile): ItineraryProfile[] {
  return Array.from(new Set<ItineraryProfile>([
    primary,
    'activity_food',
    'budget_bites',
    'premium_dining',
    'chill_walk',
  ]));
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.showHelp) {
    printHelp();
    return;
  }

  const inputData = await promptForMissing(parsed.options);
  if (!inputData.location) {
    throw new Error('Location is required.');
  }

  const tracer = installFetchTracer(inputData.trace);

  try {
    printEnvDiagnostics();

    console.log('[Stage 1] Resolving location...');
    const geo = await resolveLocation(inputData);
    console.log(
      `[Stage 1] Hub resolved: ${geo.displayName} (${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)})`
    );

    console.log('[Stage 2] Running place pipeline (OSM + Typesense + Tavily)...');
    const groupSize = inputData.groupSize;
    console.log(`[Stage 2] Group size: ${groupSize}`);
    const allPlaces = await searchPlaces(
      inputData.location,
      { lat: geo.lat, lng: geo.lng },
      inputData.mood,
      inputData.budget,
      groupSize
    );

    // Log activity diversity
    const strongActivityKeywords = [
      'bowling', 'arcade', 'gaming', 'trampoline', 'escape', 'vr',
      'go kart', 'smaaash', 'timezone', 'fun city', 'bounce', 'pvr', 'inox',
      'cinema', 'museum', 'comedy', 'concert', 'snow world',
    ];
    const strongActivities = allPlaces.filter((p) => {
      const text = normalizeText(`${p.name} ${p.description}`);
      return strongActivityKeywords.some((kw) => text.includes(kw));
    });
    const typeBreakdown = allPlaces.reduce<Record<string, number>>((acc, p) => {
      acc[p.type] = (acc[p.type] || 0) + 1;
      return acc;
    }, {});

    console.log(`[Stage 2] Pipeline returned ${allPlaces.length} places.`);
    console.log(`[Stage 2] Type breakdown: ${JSON.stringify(typeBreakdown)}`);
    console.log(`[Stage 2] Strong experiential activities found: ${strongActivities.length}`);
    if (strongActivities.length > 0) {
      console.log(`[Stage 2] Strong activities: ${strongActivities.map((p) => p.name).join(', ')}`);
    }
    printPlacesPreview(allPlaces, { lat: geo.lat, lng: geo.lng });

    const preValidated = finalValidatePlacesBeforeEngine(allPlaces);
    const verifiedPlaces = validateGroundedPlaces(preValidated, {
      lat: geo.lat,
      lng: geo.lng,
    });

    console.log(
      `[Stage 2] Validation counts: fetched=${allPlaces.length}, preValidated=${preValidated.length}, verified=${verifiedPlaces.length}`
    );
    printGenerationDiagnostics(verifiedPlaces, inputData.mood);

    if (verifiedPlaces.length < 3) {
      throw new Error(
        `Insufficient verified places (${verifiedPlaces.length}) after website-equivalent validation.`
      );
    }

    const hub: HubCandidate = {
      name: inputData.location,
      lat: geo.lat,
      lng: geo.lng,
      station: inputData.location,
      strategy: 'geometric',
      travelTimes: [0],
      maxTravelTime: 0,
      avgTravelTime: 0,
      fairnessScore: 1,
    };

    console.log('[Stage 3] Generating grounded itinerary (same engine as website)...');
    const profileFallbackOrder = buildProfileFallbackOrder(inputData.profile);

    let generated: ReturnType<typeof generateGroundedItineraryForHub> | undefined;
    let selectedProfile: ItineraryProfile = inputData.profile;
    let lastGenerationError: unknown;

    for (const profile of profileFallbackOrder) {
      try {
        generated = generateGroundedItineraryForHub({
          hub,
          places: verifiedPlaces,
          mood: inputData.mood,
          perPersonCap: inputData.budget,
          profile,
          meetupStartTime: inputData.start,
          groupSize,
        });
        selectedProfile = profile;
        if (profile !== inputData.profile) {
          console.log(`[Stage 3] Primary profile failed; fallback profile used: ${profile}`);
        }
        break;
      } catch (error) {
        lastGenerationError = error;
      }
    }

    if (!generated) {
      const reason = lastGenerationError instanceof Error ? lastGenerationError.message : String(lastGenerationError);
      console.log(`[Stage 3] Generation failed: ${reason}`);
      throw new Error(reason || 'Unable to generate grounded itinerary');
    }

    console.log('[Stage 4] Running Groq reviewer (same reviewer path as website)...');
    const reviewed = await reviewDeterministicItineraryWithGroq({
      plan: generated.plan,
      candidates: verifiedPlaces,
      hub,
      mood: inputData.mood,
      profile: selectedProfile,
      perPersonCap: inputData.budget,
    });

    if (inputData.strict) {
      const summary = reviewed.plan.day_summary.toLowerCase();
      const title = (reviewed.plan.short_title || '').toLowerCase();
      const groqFailures = tracer.stats.failedByProvider.groq || 0;
      if (groqFailures > 0) {
        throw new Error(
          `Groq API request failures detected (${groqFailures}). Strict mode stops before degraded reviewer output.`
        );
      }
      if (!reviewed.model) {
        throw new Error(
          'Groq reviewer is unavailable (no model returned). Strict mode blocks degraded/fallback-like output.'
        );
      }
      if (summary.includes('fallback') || title.includes('fallback')) {
        throw new Error(
          'Fallback-style itinerary text detected in strict mode. Inspect provider logs above.'
        );
      }

      const planIssues = collectPlanQualityIssues(reviewed.plan, inputData.mood);
      if (planIssues.length > 0) {
        throw new Error(
          `Strict quality gate failed: ${planIssues.join(' | ')}`
        );
      }
    }

    printItinerary({
      location: inputData.location,
      geocodedName: geo.displayName,
      resolvedBy: geo.resolver,
      mood: inputData.mood,
      budget: inputData.budget,
      profile: selectedProfile,
      sourceCounts: sourceBreakdown(allPlaces),
      placesCount: allPlaces.length,
      preValidatedCount: preValidated.length,
      verifiedCount: verifiedPlaces.length,
      model: reviewed.model,
      plan: reviewed.plan,
    });
  } finally {
    tracer.restore();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[itinerary-cli] ${message}`);
  process.exit(1);
});
