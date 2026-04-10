#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nextEnvPkg from '@next/env';

const { loadEnvConfig } = nextEnvPkg;

loadEnvConfig(process.cwd());
loadLooseEnvFile(path.join(process.cwd(), '.env.local'));

const DEFAULT_AREAS = ['Bandra West', 'Borivali'];
const DEFAULT_CITY = 'Mumbai';
const DEFAULT_COUNTRY = 'India';
const DEFAULT_INTERVAL_HOURS = 4;
const DEFAULT_RADIUS_METERS = 3200;
const DEFAULT_MAX_RESULTS_PER_QUERY = 10;
const DEFAULT_MAX_CANDIDATES_PER_AREA = 70;
const DEFAULT_MAX_UPSERTS_PER_AREA = 120;
const DEFAULT_DECAY_AFTER_DAYS = 12;
const DEFAULT_STALE_AFTER_DAYS = 30;
const DEFAULT_STATE_FILE = path.join(process.cwd(), '.cache', 'tavily-typesense-live-state.json');

const REQUIRED_SCHEMA = {
  id: 'string',
  name: 'string',
  description: 'string',
  tags: 'string[]',
  area: 'string',
  mood: 'string[]',
  type: 'string',
  estimated_cost: 'int32',
  lat: 'float',
  lng: 'float',
  rating: 'float',
  popularity: 'int32',
  url: 'string',
};

const BASE_COST_BY_TYPE = {
  cafe: 260,
  restaurant: 520,
  activity: 380,
  outdoor: 90,
};

const NAME_BLOCKLIST = [
  'best places',
  'top places',
  'things to do',
  'places to visit',
  'near me',
  'guide',
  'list',
  'tripadvisor',
  'justdial',
  'zomato',
  'bookmyshow',
  'quora',
  'reddit',
  'wikipedia',
  'map',
  'maps',
  'best cafes',
  'best restaurants',
  'top cafes',
  'top restaurants',
  'popular cafes',
  'popular restaurants',
  'cafes in',
  'restaurants in',
];

const NON_VENUE_BLOCKLIST = [
  'bank',
  'atm',
  'school',
  'hospital',
  'clinic',
  'pharmacy',
  'station',
  'railway',
  'metro',
  'bus depot',
  'office',
  'warehouse',
  'residency',
  'apartment',
  'building',
  'society',
  'landmark',
];

const TYPE_HINTS = {
  cafe: /\b(cafe|coffee|bakery|dessert|ice cream|gelato|tea room|chai)\b/i,
  restaurant: /\b(restaurant|dining|eatery|kitchen|food court|bistro|barbeque|bbq|thali|mess)\b/i,
  outdoor: /\b(park|garden|promenade|beach|seaface|lake|trail|walk|udyan)\b/i,
  activity: /\b(arcade|bowling|escape room|gaming|trampoline|kart|paintball|climbing|workshop|museum|theatre|theater|cinema|concert|event|sports)\b/i,
};

const SOCIAL_ACTIVITY_HINTS = /\b(arcade|bowling|gaming|workshop|event|concert|cinema|theatre|theater|sports|board game|karaoke|escape room|trampoline|laser tag)\b/i;

const VENUE_NAME_HINTS = /\b(cafe|coffee|restaurant|kitchen|bistro|bar|pub|club|lounge|arcade|bowling|park|garden|udyan|mall|cinema|theatre|theater|studio|room|house|bakery|dessert|eatery|grill)\b/i;

function loadLooseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = line.match(/^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2] ?? '';

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key] && value) {
      process.env[key] = value;
    }
  }
}

function parsePossiblyQuotedEnv(name) {
  const direct = process.env[name];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const target = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (normalized === target) return value.trim();
  }

  return undefined;
}

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(input) {
  return normalizeText(input)
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function slug(input) {
  return normalizeText(input)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeFilterValue(value) {
  return String(value || '').replace(/`/g, '');
}

function tokenSet(name) {
  return new Set(
    normalizeText(name)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function bigrams(str) {
  const text = normalizeText(str).replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i < text.length - 1; i += 1) {
    out.add(text.slice(i, i + 2));
  }
  return out;
}

function similarityScore(a, b) {
  const aNorm = normalizeText(a);
  const bNorm = normalizeText(b);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;

  const ta = tokenSet(aNorm);
  const tb = tokenSet(bNorm);
  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) overlap += 1;
  }
  const tokenUnion = new Set([...ta, ...tb]).size || 1;
  const tokenJaccard = overlap / tokenUnion;

  const ba = bigrams(aNorm);
  const bb = bigrams(bNorm);
  let bigramOverlap = 0;
  for (const token of ba) {
    if (bb.has(token)) bigramOverlap += 1;
  }
  const bigramUnion = new Set([...ba, ...bb]).size || 1;
  const bigramJaccard = bigramOverlap / bigramUnion;

  return Math.max(tokenJaccard, bigramJaccard * 0.92);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function haversineDistanceKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * r * Math.asin(Math.sqrt(q));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableVenueId(name, area) {
  const seed = `${normalizeText(name)}:${normalizeText(area)}`;
  return `tavily_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 18)}`;
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeArea(input, city) {
  const cleaned = titleCase(input || city);
  return cleaned || city;
}

function parseAreas(raw) {
  return String(raw || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((area) => normalizeArea(area, DEFAULT_CITY));
}

function printHelpAndExit(code) {
  console.log(`\nLive Tavily -> Typesense Sync Worker\n\nUsage:\n  npm run typesense:live-worker -- [options]\n\nOptions:\n  --areas <csv>               Active localities CSV (default: env LIVE_SYNC_AREAS or "Bandra West,Borivali")\n  --city <name>               City name (default: Mumbai)\n  --country <name>            Country name (default: India)\n  --interval-hours <n>        Scheduler interval in hours (default: 4)\n  --radius <meters>           Max allowed distance from area centroid (default: 3200)\n  --max-results <n>           Tavily results per query (default: 10)\n  --max-candidates <n>        Max geocode candidates per area/run (default: 70)\n  --max-upserts <n>           Max upserts per area/run (default: 120)\n  --state-file <path>         Worker state file path\n  --decay-days <n>            Start popularity decay if unseen for N days (default: 12)\n  --stale-days <n>            Mark stale if unseen for N days (default: 30)\n  --collection <name>         Typesense collection (default: env TYPESENSE_COLLECTION or venues)\n  --once                      Run one ingestion cycle and exit\n  --dry-run                   Build and print candidate docs without upsert\n  --skip-schema-check         Skip schema validation\n  --trace                     Print verbose debug details\n  --help                      Show help\n\nCron example (every 4h):\n  0 */4 * * * cd /path/to/hangout && npm run typesense:live-sync -- --areas "Bandra West,Borivali,Andheri West"\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const envAreas = parseAreas(parsePossiblyQuotedEnv('LIVE_SYNC_AREAS') || '');

  const options = {
    areas: envAreas.length ? envAreas : DEFAULT_AREAS,
    city: DEFAULT_CITY,
    country: DEFAULT_COUNTRY,
    intervalHours: DEFAULT_INTERVAL_HOURS,
    radiusMeters: DEFAULT_RADIUS_METERS,
    maxResultsPerQuery: DEFAULT_MAX_RESULTS_PER_QUERY,
    maxCandidatesPerArea: DEFAULT_MAX_CANDIDATES_PER_AREA,
    maxUpsertsPerArea: DEFAULT_MAX_UPSERTS_PER_AREA,
    stateFile: DEFAULT_STATE_FILE,
    decayDays: DEFAULT_DECAY_AFTER_DAYS,
    staleDays: DEFAULT_STALE_AFTER_DAYS,
    collection: parsePossiblyQuotedEnv('TYPESENSE_COLLECTION') || 'venues',
    once: false,
    dryRun: false,
    skipSchemaCheck: false,
    trace: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      printHelpAndExit(0);
    }

    if (arg === '--areas' && next) {
      options.areas = parseAreas(next);
      i += 1;
      continue;
    }

    if (arg === '--city' && next) {
      options.city = titleCase(next);
      i += 1;
      continue;
    }

    if (arg === '--country' && next) {
      options.country = titleCase(next);
      i += 1;
      continue;
    }

    if (arg === '--interval-hours' && next) {
      options.intervalHours = Math.max(1, Number(next) || options.intervalHours);
      i += 1;
      continue;
    }

    if (arg === '--radius' && next) {
      options.radiusMeters = Math.max(900, Number(next) || options.radiusMeters);
      i += 1;
      continue;
    }

    if (arg === '--max-results' && next) {
      options.maxResultsPerQuery = Math.max(3, Math.min(15, Number(next) || options.maxResultsPerQuery));
      i += 1;
      continue;
    }

    if (arg === '--max-candidates' && next) {
      options.maxCandidatesPerArea = Math.max(15, Math.min(160, Number(next) || options.maxCandidatesPerArea));
      i += 1;
      continue;
    }

    if (arg === '--max-upserts' && next) {
      options.maxUpsertsPerArea = Math.max(20, Math.min(300, Number(next) || options.maxUpsertsPerArea));
      i += 1;
      continue;
    }

    if (arg === '--state-file' && next) {
      options.stateFile = path.isAbsolute(next) ? next : path.join(process.cwd(), next);
      i += 1;
      continue;
    }

    if (arg === '--decay-days' && next) {
      options.decayDays = Math.max(3, Number(next) || options.decayDays);
      i += 1;
      continue;
    }

    if (arg === '--stale-days' && next) {
      options.staleDays = Math.max(options.decayDays, Number(next) || options.staleDays);
      i += 1;
      continue;
    }

    if (arg === '--collection' && next) {
      options.collection = String(next).trim() || options.collection;
      i += 1;
      continue;
    }

    if (arg === '--once') {
      options.once = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--skip-schema-check') {
      options.skipSchemaCheck = true;
      continue;
    }

    if (arg === '--trace') {
      options.trace = true;
      continue;
    }
  }

  if (!Array.isArray(options.areas) || options.areas.length === 0) {
    options.areas = DEFAULT_AREAS;
  }

  return options;
}

function resolveTypesenseConfig(collectionOverride, allowMissingConnection) {
  const hostRaw = parsePossiblyQuotedEnv('TYPESENSE_HOST');
  const protocol = parsePossiblyQuotedEnv('TYPESENSE_PROTOCOL') || 'https';
  const port = parsePossiblyQuotedEnv('TYPESENSE_PORT');
  const apiKey = parsePossiblyQuotedEnv('TYPESENSE_ADMIN_API_KEY') || parsePossiblyQuotedEnv('TYPESENSE_API_KEY');

  if (!hostRaw && !allowMissingConnection) {
    throw new Error('Missing TYPESENSE_HOST environment variable');
  }

  if (!apiKey && !allowMissingConnection) {
    throw new Error('Missing TYPESENSE_ADMIN_API_KEY or TYPESENSE_API_KEY environment variable');
  }

  const resolvedHostRaw = hostRaw || 'dry-run.local';
  const hasScheme = resolvedHostRaw.startsWith('http://') || resolvedHostRaw.startsWith('https://');
  const hostWithPort = hasScheme
    ? resolvedHostRaw
    : `${protocol}://${port ? `${resolvedHostRaw}:${port}` : resolvedHostRaw}`;

  return {
    baseUrl: hostWithPort.replace(/\/$/, ''),
    apiKey: apiKey || 'dry_run_no_key',
    collection: collectionOverride || parsePossiblyQuotedEnv('TYPESENSE_COLLECTION') || 'venues',
  };
}

async function fetchCollectionSchema(config) {
  const url = `${config.baseUrl}/collections/${encodeURIComponent(config.collection)}`;
  const response = await fetch(url, {
    headers: {
      'X-TYPESENSE-API-KEY': config.apiKey,
    },
  });

  if (response.status === 404) {
    throw new Error(`Typesense collection "${config.collection}" not found`);
  }

  if (!response.ok) {
    throw new Error(`Unable to read Typesense schema: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function verifySchema(schema) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const map = new Map(fields.map((field) => [field.name, field.type]));

  const missing = [];
  const mismatches = [];

  for (const [field, expectedType] of Object.entries(REQUIRED_SCHEMA)) {
    if (field === 'id' && !map.has('id')) {
      continue;
    }

    if (!map.has(field)) {
      missing.push(field);
      continue;
    }

    const actualType = String(map.get(field));
    if (actualType !== expectedType) {
      mismatches.push(`${field} (expected ${expectedType}, got ${actualType})`);
    }
  }

  if (missing.length || mismatches.length) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      mismatches.length ? `type mismatches: ${mismatches.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    throw new Error(`Collection schema is incompatible with live sync: ${details}`);
  }

  const fieldSet = new Set(fields.map((field) => String(field.name || '')));
  const hasWildcard = fieldSet.has('.*');

  return {
    fieldSet,
    hasWildcard,
  };
}

function canWriteField(schemaInfo, fieldName) {
  return schemaInfo.hasWildcard || schemaInfo.fieldSet.has(fieldName);
}

function ensureDocSchema(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (typeof doc.id !== 'string' || !doc.id) return false;
  if (typeof doc.name !== 'string' || !doc.name) return false;
  if (typeof doc.description !== 'string' || !doc.description) return false;
  if (!Array.isArray(doc.tags) || doc.tags.some((tag) => typeof tag !== 'string')) return false;
  if (typeof doc.area !== 'string' || !doc.area) return false;
  if (!Array.isArray(doc.mood) || doc.mood.some((m) => typeof m !== 'string')) return false;
  if (typeof doc.type !== 'string' || !doc.type) return false;
  if (!Number.isInteger(doc.estimated_cost)) return false;
  if (typeof doc.lat !== 'number' || Number.isNaN(doc.lat)) return false;
  if (typeof doc.lng !== 'number' || Number.isNaN(doc.lng)) return false;
  if (typeof doc.rating !== 'number' || Number.isNaN(doc.rating)) return false;
  if (!Number.isInteger(doc.popularity)) return false;
  if (typeof doc.url !== 'string' || !doc.url) return false;
  return true;
}

function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      areaRuns: {},
      places: {},
    };
  }

  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      areaRuns: parsed.areaRuns || {},
      places: parsed.places || {},
    };
  } catch {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      areaRuns: {},
      places: {},
    };
  }
}

function saveState(stateFile, state) {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

async function geocodeArea({ area, city, country }) {
  const query = `${area}, ${city}, ${country}`;
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'in',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      'User-Agent': 'hangout-live-sync/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim geocode failed for area: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No centroid found for area "${area}"`);
  }

  const lat = Number(data[0].lat);
  const lng = Number(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Invalid centroid coordinates for area "${area}"`);
  }

  return {
    lat,
    lng,
    displayName: String(data[0].display_name || query),
  };
}

async function geocodeVenue({ name, area, city, country }) {
  const queries = [
    `${name}, ${area}, ${city}, ${country}`,
    `${name}, ${city}, ${country}`,
  ];

  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '1',
      countrycodes: 'in',
    });

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'hangout-live-sync/1.0',
      },
    });

    if (!response.ok) continue;

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) continue;

    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    return {
      lat,
      lng,
      displayName: String(data[0].display_name || query),
      className: String(data[0]['class'] || '').toLowerCase(),
      typeName: String(data[0].type || '').toLowerCase(),
      addressType: String(data[0].addresstype || '').toLowerCase(),
    };
  }

  return null;
}

function buildDiscoveryQueries(area, city) {
  return [
    `popular cafes in ${area} ${city} for young people with budget details`,
    `best restaurants in ${area} ${city} for group hangouts cost for two`,
    `bowling arcade gaming escape room near ${area} ${city}`,
    `date friendly dessert cafes in ${area} ${city}`,
    `parks promenade outdoor hangout spots near ${area} ${city}`,
    `student friendly budget hangout places in ${area} ${city}`,
  ];
}

function normalizeCandidateName(raw) {
  return String(raw || '')
    .replace(/[|:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLowReliabilitySource(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes('reddit.com') ||
      host.includes('instagram.com') ||
      host.includes('facebook.com') ||
      host.includes('youtube.com') ||
      host.includes('youtu.be') ||
      host.includes('pinterest.') ||
      host.includes('tiktok.')
    );
  } catch {
    return false;
  }
}

function looksConcreteVenueName(name, area) {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  if (normalized.length < 4) return false;

  if (NAME_BLOCKLIST.some((term) => normalized.includes(term))) return false;
  if (NON_VENUE_BLOCKLIST.some((term) => normalized.includes(term))) return false;

  if (/^(unnamed|plot\s*\d+|shop\s*\d+|building\s*\d+|block\s*\d+)/.test(normalized)) {
    return false;
  }

  const areaTokens = tokenSet(area);
  const nameTokens = tokenSet(name);
  if (nameTokens.size === 0) return false;

  const directionTokens = new Set(['east', 'west', 'north', 'south', 'central']);
  const areaOnly = [...nameTokens].every((token) => areaTokens.has(token) || directionTokens.has(token));
  if (areaOnly) return false;

  const tooGeneric = /^(cafe|restaurant|garden|park|mall|club|bar|activity|hangout)$/.test(normalized);
  if (tooGeneric) return false;

  if (/^(instagram|facebook|youtube|tripadvisor|zomato|google|maps?)$/.test(normalized)) {
    return false;
  }

  if (/^r\s+[a-z0-9_]+$/.test(normalized)) {
    return false;
  }

  if (/\b(road|street|lane|marg|nagar|west|east|north|south)\b/.test(normalized) && !VENUE_NAME_HINTS.test(normalized)) {
    return false;
  }

  if (/\b(in|near)\s+[a-z]+$/.test(normalized) && !VENUE_NAME_HINTS.test(normalized)) {
    return false;
  }

  const tokenCount = normalized.split(' ').filter(Boolean).length;
  if (tokenCount < 2 && normalized.length < 8) return false;

  if (
    tokenCount >= 2 &&
    tokenCount <= 4 &&
    !VENUE_NAME_HINTS.test(normalized) &&
    normalized.split(' ').every((token) => /^[a-z]{2,}$/.test(token))
  ) {
    return false;
  }

  return true;
}

function extractTitleCandidates(title) {
  const parts = String(title || '')
    .split(/\||-|:|,/) 
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 5);

  return parts;
}

function extractTextCandidates(text) {
  const compact = String(text || '').replace(/\r/g, ' ');
  const segments = compact
    .split(/[\n.]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 120);

  const out = [];

  for (const segment of segments) {
    const cleaned = segment.replace(/^[-*\d)\s]+/, '').trim();
    if (!cleaned) continue;

    const quoted = cleaned.match(/"([^"]{3,60})"/g) || [];
    for (const piece of quoted) {
      out.push(piece.replace(/"/g, '').trim());
    }

    const titleCaseGroups = cleaned.match(/([A-Z][a-zA-Z0-9&'.-]+(?:\s+[A-Z][a-zA-Z0-9&'.-]+){0,5})/g) || [];
    for (const group of titleCaseGroups) {
      out.push(group.trim());
    }
  }

  return out;
}

function inferType(text, name = '') {
  const primary = `${name} ${name}`;
  if (/\b(fort|museum|gallery|viewpoint|heritage)\b/i.test(primary)) return 'activity';
  if (/\b(park|garden|udyan|trail|promenade|beach|seaface|lake)\b/i.test(primary)) return 'outdoor';
  if (/\b(cafe|coffee|bakery|dessert|gelato|tea)\b/i.test(primary)) return 'cafe';
  if (/\b(restaurant|eatery|diner|kitchen|bistro|grill)\b/i.test(primary)) return 'restaurant';

  if (TYPE_HINTS.cafe.test(text)) return 'cafe';
  if (TYPE_HINTS.restaurant.test(text)) return 'restaurant';
  if (TYPE_HINTS.outdoor.test(text)) return 'outdoor';
  if (TYPE_HINTS.activity.test(text)) return 'activity';
  return 'activity';
}

function inferMoods(type, text) {
  const moods = new Set();

  if (type === 'cafe') {
    moods.add('chill');
    moods.add('fun');
  }
  if (type === 'restaurant') {
    moods.add('fun');
    moods.add('romantic');
  }
  if (type === 'outdoor') {
    moods.add('chill');
    moods.add('romantic');
  }
  if (type === 'activity') {
    moods.add('fun');
    moods.add('adventure');
  }

  const normalized = normalizeText(text);
  if (/\b(date|romantic|sunset|cozy)\b/.test(normalized)) moods.add('romantic');
  if (/\b(calm|quiet|relax|peaceful)\b/.test(normalized)) moods.add('chill');
  if (/\b(adventure|thrill|sports|climb|escape|arcade|bowling)\b/.test(normalized)) moods.add('adventure');

  return Array.from(moods).slice(0, 4);
}

function extractEstimatedCost(text, type) {
  const content = String(text || '').replace(/,/g, ' ');

  const perPersonRange = content.match(
    /(?:₹|rs\.?|inr)\s*([0-9]{2,5})\s*(?:-|to)\s*(?:₹|rs\.?|inr)?\s*([0-9]{2,5})\s*(?:per\s*person|pp)?/i
  );
  if (perPersonRange) {
    const min = Number(perPersonRange[1]);
    const max = Number(perPersonRange[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
      return Math.round((min + max) / 2);
    }
  }

  const forTwo = content.match(
    /(?:cost\s*for\s*2|cost\s*for\s*two|for\s*2|for\s*two)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([0-9]{2,5})/i
  );
  if (forTwo) {
    const value = Number(forTwo[1]);
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value / 2);
    }
  }

  const perPerson = content.match(/(?:₹|rs\.?|inr)\s*([0-9]{2,5})\s*(?:per\s*person|pp)/i);
  if (perPerson) {
    const value = Number(perPerson[1]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return BASE_COST_BY_TYPE[type] || 350;
}

function inferCostRange(estimatedCost) {
  const value = clamp(Math.round(estimatedCost), 60, 4500);

  const range = {
    min: Math.round(clamp(value * 0.72, 40, 3500)),
    max: Math.round(clamp(value * 1.28, value, 5000)),
    label: 'mid',
  };

  if (value <= 220) range.label = 'budget';
  else if (value <= 520) range.label = 'mid';
  else if (value <= 1000) range.label = 'premium';
  else range.label = 'luxury';

  return range;
}

function computeConfidence({
  name,
  evidenceCount,
  distanceKm,
  type,
  displayName,
  area,
}) {
  const nameTokens = normalizeText(name).split(' ').filter(Boolean);
  const nameQuality = clamp((nameTokens.length >= 2 ? 0.72 : 0.52) + Math.min(0.16, nameTokens.length * 0.03), 0.3, 0.94);
  const evidenceScore = clamp(0.45 + Math.min(0.4, evidenceCount * 0.11), 0.45, 0.92);
  const geoScore = clamp(1 - distanceKm / 5, 0.2, 1);
  const typeScore = type === 'activity' || type === 'cafe' || type === 'restaurant' || type === 'outdoor' ? 0.86 : 0.5;

  const localitySignal = normalizeText(displayName).includes(normalizeText(area)) ? 1 : 0.72;

  return clamp(
    nameQuality * 0.28 +
      evidenceScore * 0.24 +
      geoScore * 0.24 +
      typeScore * 0.14 +
      localitySignal * 0.1,
    0,
    1
  );
}

function computeHangoutScore({ type, text, confidence, popularity }) {
  let typeBase = 0.56;
  if (type === 'cafe') typeBase = 0.84;
  if (type === 'restaurant') typeBase = 0.76;
  if (type === 'activity') typeBase = 0.86;
  if (type === 'outdoor') typeBase = 0.68;

  let socialBoost = 0;
  if (SOCIAL_ACTIVITY_HINTS.test(text)) socialBoost += 0.12;
  if (/\b(cozy|date|group|friends|hangout|popular|trending|crowd)\b/i.test(text)) socialBoost += 0.08;

  const popularityScore = clamp((popularity || 50) / 100, 0.2, 1);

  return clamp(typeBase * 0.56 + confidence * 0.24 + popularityScore * 0.12 + socialBoost, 0, 1);
}

function mergeTags(baseTags, extraTags) {
  const set = new Set([...(baseTags || []), ...(extraTags || [])].filter(Boolean));
  return Array.from(set).slice(0, 18);
}

function mapsUrl(lat, lng, name) {
  const q = `${lat},${lng} (${name})`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function buildAreaQueries(area, city) {
  return buildDiscoveryQueries(area, city);
}

async function tavilySearch(query, maxResults) {
  const apiKey = parsePossiblyQuotedEnv('TAVILY_API_KEY');
  if (!apiKey) return [];

  try {
    const { tavily } = await import('@tavily/core');
    const client = tavily({ apiKey });
    const response = await client.search(query, {
      maxResults,
      searchDepth: 'basic',
    });

    return Array.isArray(response.results) ? response.results : [];
  } catch {
    return [];
  }
}

function harvestCandidatesFromResults(results, area, query) {
  const harvested = [];

  for (const result of results) {
    const title = String(result.title || '');
    const content = String(result.content || '');

    const candidates = [
      ...extractTitleCandidates(title),
      ...extractTextCandidates(content),
    ];

    for (const rawName of candidates) {
      const name = normalizeCandidateName(rawName);
      if (!looksConcreteVenueName(name, area)) continue;
      if (isLowReliabilitySource(String(result.url || '')) && !VENUE_NAME_HINTS.test(name)) continue;

      harvested.push({
        name,
        evidenceText: `${title}. ${content}`.slice(0, 1200),
        sourceUrl: String(result.url || ''),
        query,
      });
    }
  }

  return harvested;
}

function collapseHarvestedCandidates(items) {
  const map = new Map();

  for (const item of items) {
    const key = normalizeText(item.name);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        name: item.name,
        evidence: [item.evidenceText],
        urls: item.sourceUrl ? [item.sourceUrl] : [],
        queryHits: new Set([item.query]),
      });
      continue;
    }

    const existing = map.get(key);
    existing.evidence.push(item.evidenceText);
    if (item.sourceUrl) existing.urls.push(item.sourceUrl);
    existing.queryHits.add(item.query);
  }

  const out = [];
  for (const value of map.values()) {
    out.push({
      name: value.name,
      evidenceText: value.evidence.slice(0, 6).join(' | '),
      evidenceCount: value.queryHits.size,
      urls: Array.from(new Set(value.urls)).slice(0, 4),
    });
  }

  return out.sort((a, b) => b.evidenceCount - a.evidenceCount);
}

async function searchTypesenseDocuments(config, params) {
  const searchParams = new URLSearchParams({
    q: params.q,
    query_by: params.queryBy,
    per_page: String(params.perPage),
    page: String(params.page || 1),
  });

  if (params.filterBy) {
    searchParams.set('filter_by', params.filterBy);
  }

  const url = `${config.baseUrl}/collections/${encodeURIComponent(config.collection)}/documents/search?${searchParams.toString()}`;

  const response = await fetch(url, {
    headers: {
      'X-TYPESENSE-API-KEY': config.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Typesense search failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function normalizeExistingDoc(rawDoc) {
  const tags = Array.isArray(rawDoc.tags)
    ? rawDoc.tags.filter((v) => typeof v === 'string' && v.trim())
    : typeof rawDoc.tags === 'string'
    ? rawDoc.tags.split(',').map((v) => v.trim()).filter(Boolean)
    : [];

  const mood = Array.isArray(rawDoc.mood)
    ? rawDoc.mood.filter((v) => typeof v === 'string' && v.trim())
    : typeof rawDoc.mood === 'string'
    ? rawDoc.mood.split(',').map((v) => v.trim()).filter(Boolean)
    : [];

  const doc = {
    id: String(rawDoc.id || ''),
    name: String(rawDoc.name || ''),
    description: String(rawDoc.description || ''),
    tags,
    area: String(rawDoc.area || ''),
    mood,
    type: String(rawDoc.type || 'activity'),
    estimated_cost: Math.round(clamp(parseNumber(rawDoc.estimated_cost) || 300, 80, 4500)),
    lat: parseNumber(rawDoc.lat),
    lng: parseNumber(rawDoc.lng),
    rating: clamp(parseNumber(rawDoc.rating) || 4, 0, 5),
    popularity: Math.round(clamp(parseNumber(rawDoc.popularity) || 40, 1, 100)),
    url: String(rawDoc.url || ''),
  };

  if (!doc.id || !doc.name || typeof doc.lat !== 'number' || typeof doc.lng !== 'number') {
    return null;
  }

  return doc;
}

async function fetchExistingAreaDocs(config, area) {
  const docs = [];
  const perPage = 100;
  const queryBy = 'name,description,tags,area,mood';
  const filterBy = `area:=\`${escapeFilterValue(area)}\``;

  for (let page = 1; page <= 8; page += 1) {
    const response = await searchTypesenseDocuments(config, {
      q: '*',
      queryBy,
      filterBy,
      perPage,
      page,
    });

    const hits = Array.isArray(response.hits) ? response.hits : [];
    if (hits.length === 0) break;

    for (const hit of hits) {
      const doc = normalizeExistingDoc(hit.document || {});
      if (doc) docs.push(doc);
    }

    if (hits.length < perPage) break;
  }

  return docs;
}

function mergeWithExisting(existing, candidate) {
  const mergedTags = mergeTags(existing.tags, candidate.tags);
  const mergedMood = Array.from(new Set([...(existing.mood || []), ...(candidate.mood || [])])).slice(0, 4);

  return {
    ...existing,
    name: existing.name || candidate.name,
    description: candidate.description.length > existing.description.length ? candidate.description : existing.description,
    tags: mergedTags,
    mood: mergedMood,
    type: candidate.hangout_score > 0.75 ? candidate.type : existing.type,
    estimated_cost: Math.round((existing.estimated_cost + candidate.estimated_cost) / 2),
    lat: typeof existing.lat === 'number' ? existing.lat : candidate.lat,
    lng: typeof existing.lng === 'number' ? existing.lng : candidate.lng,
    rating: clamp(Math.max(existing.rating, candidate.rating), 0, 5),
    popularity: Math.round(clamp(Math.max(existing.popularity, candidate.popularity), 1, 100)),
    url: existing.url || candidate.url,
  };
}

function isGeocodeLikelyVenue(geo) {
  const blockClass = new Set(['highway', 'boundary', 'place']);
  const blockType = new Set(['road', 'residential', 'suburb', 'neighbourhood', 'quarter', 'city_block']);
  const blockAddressType = new Set(['road', 'suburb', 'neighbourhood', 'quarter', 'locality']);

  if (blockClass.has(String(geo.className || ''))) return false;
  if (blockType.has(String(geo.typeName || ''))) return false;
  if (blockAddressType.has(String(geo.addressType || ''))) return false;

  return true;
}

function buildSmartQueries(area, city) {
  return buildAreaQueries(area, city);
}

function updateStateSignals(state, area, candidate, nowIso) {
  const key = `${normalizeText(candidate.name)}|${normalizeText(area)}`;

  if (!state.places[key]) {
    state.places[key] = {
      area,
      name: candidate.name,
      hits: 0,
      misses: 0,
      firstSeen: nowIso,
      lastSeen: nowIso,
      id: candidate.id,
    };
  }

  state.places[key].hits += 1;
  state.places[key].misses = 0;
  state.places[key].lastSeen = nowIso;
  state.places[key].name = candidate.name;
  state.places[key].id = candidate.id;

  return state.places[key];
}

function applyPopularityBoostFromHistory(candidate, placeState) {
  const hits = placeState?.hits || 0;
  const boost = Math.min(24, Math.round(Math.log1p(hits) * 7));
  candidate.popularity = Math.round(clamp(candidate.popularity + boost, 1, 100));

  const confidenceBoost = Math.min(0.12, hits * 0.012);
  candidate.confidence_score = clamp(candidate.confidence_score + confidenceBoost, 0, 1);

  const hangoutBoost = Math.min(0.1, hits * 0.01);
  candidate.hangout_score = clamp(candidate.hangout_score + hangoutBoost, 0, 1);

  return candidate;
}

function applyStaleDecay({ state, area, existingDocs, seenKeys, now, decayDays, staleDays }) {
  const updates = [];

  for (const [key, entry] of Object.entries(state.places)) {
    if (normalizeText(entry.area) !== normalizeText(area)) continue;
    if (seenKeys.has(key)) continue;

    entry.misses = (entry.misses || 0) + 1;

    const lastSeenAt = new Date(entry.lastSeen || entry.firstSeen || now.toISOString());
    const ageDays = Math.max(0, (now.getTime() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24));

    if (ageDays < decayDays) continue;

    const match = existingDocs.find((doc) => {
      const docKey = `${normalizeText(doc.name)}|${normalizeText(doc.area || area)}`;
      return docKey === key || (entry.id && doc.id === entry.id);
    });

    if (!match) continue;

    const nextPopularity = Math.round(
      clamp(
        match.popularity * (ageDays >= staleDays ? 0.82 : 0.9),
        5,
        100
      )
    );

    if (nextPopularity === match.popularity) continue;

    const staleTag = ageDays >= staleDays ? ['stale_candidate'] : [];

    updates.push({
      ...match,
      popularity: nextPopularity,
      tags: mergeTags(match.tags, staleTag),
    });
  }

  return updates;
}

function toUpsertDocument(doc, schemaInfo) {
  const base = {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    tags: Array.isArray(doc.tags) ? doc.tags.slice(0, 18) : [],
    area: doc.area,
    mood: Array.isArray(doc.mood) ? doc.mood.slice(0, 4) : ['fun'],
    type: doc.type,
    estimated_cost: Math.round(clamp(doc.estimated_cost, 80, 4500)),
    lat: doc.lat,
    lng: doc.lng,
    rating: clamp(doc.rating, 0, 5),
    popularity: Math.round(clamp(doc.popularity, 1, 100)),
    url: doc.url,
  };

  if (canWriteField(schemaInfo, 'confidence_score') && typeof doc.confidence_score === 'number') {
    base.confidence_score = clamp(doc.confidence_score, 0, 1);
  }
  if (canWriteField(schemaInfo, 'hangout_score') && typeof doc.hangout_score === 'number') {
    base.hangout_score = clamp(doc.hangout_score, 0, 1);
  }
  if (canWriteField(schemaInfo, 'cost_range_min') && typeof doc.cost_range_min === 'number') {
    base.cost_range_min = Math.round(clamp(doc.cost_range_min, 0, 5000));
  }
  if (canWriteField(schemaInfo, 'cost_range_max') && typeof doc.cost_range_max === 'number') {
    base.cost_range_max = Math.round(clamp(doc.cost_range_max, 0, 6000));
  }
  if (canWriteField(schemaInfo, 'cost_range_label') && typeof doc.cost_range_label === 'string') {
    base.cost_range_label = doc.cost_range_label;
  }
  if (canWriteField(schemaInfo, 'source') && typeof doc.source === 'string') {
    base.source = doc.source;
  }
  if (canWriteField(schemaInfo, 'discovery_hits') && typeof doc.discovery_hits === 'number') {
    base.discovery_hits = Math.round(clamp(doc.discovery_hits, 0, 999999));
  }
  if (canWriteField(schemaInfo, 'last_seen') && typeof doc.last_seen === 'number') {
    base.last_seen = doc.last_seen;
  }

  return base;
}

async function importDocuments(config, docs, batchSize) {
  if (!docs.length) {
    return { success: 0, failed: 0, failures: [] };
  }

  const importUrl = `${config.baseUrl}/collections/${encodeURIComponent(config.collection)}/documents/import?action=upsert&batch_size=${batchSize}`;
  const payload = docs.map((doc) => JSON.stringify(doc)).join('\n');

  const response = await fetch(importUrl, {
    method: 'POST',
    headers: {
      'X-TYPESENSE-API-KEY': config.apiKey,
      'Content-Type': 'text/plain',
    },
    body: payload,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Typesense import failed: ${response.status} ${response.statusText} ${text}`);
  }

  const lines = (await response.text())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let success = 0;
  let failed = 0;
  const failures = [];

  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.success === true) {
        success += 1;
      } else {
        failed += 1;
        failures.push({
          id: row.document?.id || 'unknown',
          error: row.error || 'Unknown import error',
        });
      }
    } catch {
      failed += 1;
      failures.push({ id: 'unknown', error: `Unparseable import line: ${line}` });
    }
  }

  return { success, failed, failures };
}

async function ingestArea({ area, options, config, schemaInfo, state }) {
  const start = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();
  const radiusKm = options.radiusMeters / 1000;
  const queryList = buildSmartQueries(area, options.city);

  console.log(`\n[LiveSync] Area: ${area}`);

  const centroid = await geocodeArea({ area, city: options.city, country: options.country });
  console.log(`[LiveSync] Centroid: ${centroid.lat.toFixed(6)}, ${centroid.lng.toFixed(6)} (${centroid.displayName})`);

  const existingDocs = await fetchExistingAreaDocs(config, area);
  console.log(`[LiveSync] Existing Typesense docs in area: ${existingDocs.length}`);

  const harvested = [];

  for (const query of queryList) {
    const results = await tavilySearch(query, options.maxResultsPerQuery);
    if (options.trace) {
      console.log(`[LiveSync] Tavily query "${query}" -> ${results.length} results`);
    }

    harvested.push(...harvestCandidatesFromResults(results, area, query));

    await sleep(120);
  }

  const collapsed = collapseHarvestedCandidates(harvested).slice(0, options.maxCandidatesPerArea);
  console.log(`[LiveSync] Concrete candidates extracted: ${collapsed.length}`);

  const prepared = [];
  const seenNameKeys = new Set();

  for (const item of collapsed) {
    const nameKey = normalizeText(item.name);
    if (!nameKey || seenNameKeys.has(nameKey)) continue;

    const geo = await geocodeVenue({
      name: item.name,
      area,
      city: options.city,
      country: options.country,
    });
    if (!geo) continue;
    if (!isGeocodeLikelyVenue(geo) && !VENUE_NAME_HINTS.test(item.name)) continue;

    const distanceKm = haversineDistanceKm(
      { lat: centroid.lat, lng: centroid.lng },
      { lat: geo.lat, lng: geo.lng }
    );
    if (distanceKm > radiusKm) continue;

    const text = `${item.name}. ${item.evidenceText}`;
    const type = inferType(text, item.name);
    const estimatedCost = extractEstimatedCost(text, type);
    const costRange = inferCostRange(estimatedCost);

    const rawPopularity = clamp(42 + item.evidenceCount * 8 - distanceKm * 6, 12, 92);
    const confidenceScore = computeConfidence({
      name: item.name,
      evidenceCount: item.evidenceCount,
      distanceKm,
      type,
      displayName: geo.displayName,
      area,
    });

    const tags = mergeTags(
      [
        `source:tavily_sync`,
        `cost_range:${costRange.label}`,
        `distance_band:${distanceKm <= 1.2 ? 'near' : distanceKm <= 2.2 ? 'mid' : 'edge'}`,
      ],
      [type]
    );

    const doc = {
      id: stableVenueId(item.name, area),
      name: item.name,
      description: item.evidenceText.slice(0, 420),
      tags,
      area,
      mood: inferMoods(type, text),
      type,
      estimated_cost: Math.round(clamp(estimatedCost, 80, 4500)),
      lat: geo.lat,
      lng: geo.lng,
      rating: clamp(3.8 + item.evidenceCount * 0.16, 3.6, 4.9),
      popularity: Math.round(rawPopularity),
      url: item.urls[0] || mapsUrl(geo.lat, geo.lng, item.name),
      source: 'tavily_sync',
      cost_range_min: costRange.min,
      cost_range_max: costRange.max,
      cost_range_label: costRange.label,
      confidence_score: confidenceScore,
      hangout_score: 0,
      discovery_hits: item.evidenceCount,
      last_seen: now.getTime(),
    };

    doc.hangout_score = computeHangoutScore({
      type,
      text,
      confidence: doc.confidence_score,
      popularity: doc.popularity,
    });

    if (doc.confidence_score < 0.56 || doc.hangout_score < 0.5) continue;

    const fuzzyExisting = existingDocs
      .map((existing) => {
        const similarity = similarityScore(existing.name, doc.name);
        const geoDistance = haversineDistanceKm(
          { lat: existing.lat, lng: existing.lng },
          { lat: doc.lat, lng: doc.lng }
        );
        return {
          existing,
          similarity,
          geoDistance,
        };
      })
      .filter((row) => row.similarity >= 0.84 && row.geoDistance <= 1.4)
      .sort((a, b) => b.similarity - a.similarity)[0];

    if (!fuzzyExisting && !VENUE_NAME_HINTS.test(item.name)) {
      const contextPattern = new RegExp(
        `${escapeRegExp(item.name)}.{0,32}(cafe|restaurant|bar|club|arcade|park|garden|fort|museum|theatre|theater|mall|bakery|dessert|studio)`,
        'i'
      );
      if (!contextPattern.test(item.evidenceText)) {
        continue;
      }
    }

    const merged = fuzzyExisting ? mergeWithExisting(fuzzyExisting.existing, doc) : doc;
    if (fuzzyExisting) {
      merged.id = fuzzyExisting.existing.id;
    }

    const stateEntry = updateStateSignals(state, area, merged, nowIso);
    merged.discovery_hits = stateEntry.hits;
    applyPopularityBoostFromHistory(merged, stateEntry);

    const stateKey = `${normalizeText(merged.name)}|${normalizeText(area)}`;
    seenNameKeys.add(stateKey);
    prepared.push(merged);

    await sleep(110);
  }

  const dedupedPrepared = [];
  for (const doc of prepared) {
    const duplicate = dedupedPrepared.find((picked) => similarityScore(picked.name, doc.name) >= 0.92);
    if (!duplicate) {
      dedupedPrepared.push(doc);
      continue;
    }

    if ((doc.hangout_score || 0) > (duplicate.hangout_score || 0)) {
      duplicate.name = doc.name;
      duplicate.description = doc.description;
      duplicate.tags = mergeTags(duplicate.tags, doc.tags);
      duplicate.mood = Array.from(new Set([...(duplicate.mood || []), ...(doc.mood || [])])).slice(0, 4);
      duplicate.type = doc.type;
      duplicate.estimated_cost = doc.estimated_cost;
      duplicate.lat = doc.lat;
      duplicate.lng = doc.lng;
      duplicate.rating = doc.rating;
      duplicate.popularity = doc.popularity;
      duplicate.url = doc.url;
      duplicate.cost_range_min = doc.cost_range_min;
      duplicate.cost_range_max = doc.cost_range_max;
      duplicate.cost_range_label = doc.cost_range_label;
      duplicate.confidence_score = doc.confidence_score;
      duplicate.hangout_score = doc.hangout_score;
      duplicate.discovery_hits = doc.discovery_hits;
      duplicate.last_seen = doc.last_seen;
    }
  }

  dedupedPrepared.sort((a, b) => {
    const aRank = (a.hangout_score || 0) * 0.58 + (a.confidence_score || 0) * 0.32 + (a.popularity || 0) / 100 * 0.1;
    const bRank = (b.hangout_score || 0) * 0.58 + (b.confidence_score || 0) * 0.32 + (b.popularity || 0) / 100 * 0.1;
    return bRank - aRank;
  });

  const topDocs = dedupedPrepared.slice(0, options.maxUpsertsPerArea);

  const seenStateKeys = new Set(topDocs.map((doc) => `${normalizeText(doc.name)}|${normalizeText(area)}`));
  const decayedDocs = applyStaleDecay({
    state,
    area,
    existingDocs,
    seenKeys: seenStateKeys,
    now,
    decayDays: options.decayDays,
    staleDays: options.staleDays,
  });

  const candidateDocs = [...topDocs, ...decayedDocs]
    .map((doc) => toUpsertDocument(doc, schemaInfo))
    .filter((doc) => ensureDocSchema(doc));

  const uniqueById = new Map();
  for (const doc of candidateDocs) {
    uniqueById.set(doc.id, doc);
  }
  const finalDocs = Array.from(uniqueById.values());

  if (options.dryRun) {
    console.log(`[LiveSync] Dry-run docs for ${area}: ${finalDocs.length}`);
    for (const preview of finalDocs.slice(0, 8)) {
      console.log(JSON.stringify(preview, null, 2));
    }
  } else {
    const importResult = await importDocuments(config, finalDocs, 100);
    console.log(`[LiveSync] Upserted ${importResult.success}, failed ${importResult.failed}`);

    if (importResult.failures.length > 0) {
      console.log('[LiveSync] Top import failures:');
      for (const failure of importResult.failures.slice(0, 8)) {
        console.log(`- ${failure.id}: ${failure.error}`);
      }
    }
  }

  const areaKey = slug(area);
  const runInfo = state.areaRuns[areaKey] || {
    area,
    runCount: 0,
    lastRunAt: nowIso,
  };
  runInfo.runCount += 1;
  runInfo.lastRunAt = nowIso;
  state.areaRuns[areaKey] = runInfo;

  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[LiveSync] Area complete: ${area} in ${elapsedSec}s | discovered=${collapsed.length} | prepared=${topDocs.length} | decayed=${decayedDocs.length}`);
}

async function runCycle({ options, config, schemaInfo, state }) {
  console.log(`\n[LiveSync] Starting cycle for areas: ${options.areas.join(', ')}`);

  for (const area of options.areas) {
    try {
      await ingestArea({ area, options, config, schemaInfo, state });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[LiveSync] Area failed (${area}): ${message}`);
    }
  }
}

function printEnvDiagnostics(options, config) {
  const envState = (name) => (parsePossiblyQuotedEnv(name) ? 'set' : 'missing');
  console.log('\n=== Live Sync Diagnostics ===');
  console.log(`TAVILY_API_KEY: ${envState('TAVILY_API_KEY')}`);
  console.log(`TYPESENSE_HOST: ${envState('TYPESENSE_HOST')}`);
  console.log(`TYPESENSE_API_KEY: ${envState('TYPESENSE_API_KEY')}`);
  console.log(`TYPESENSE_ADMIN_API_KEY: ${envState('TYPESENSE_ADMIN_API_KEY')}`);
  console.log(`Collection: ${config.collection}`);
  console.log(`Areas: ${options.areas.join(', ')}`);
  console.log(`Interval hours: ${options.intervalHours}`);
  console.log(`Radius meters: ${options.radiusMeters}`);
  console.log(`State file: ${options.stateFile}`);
  console.log('=============================\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = resolveTypesenseConfig(options.collection, options.dryRun && options.skipSchemaCheck);

  let schemaInfo = {
    fieldSet: new Set(),
    hasWildcard: false,
  };

  if (!options.skipSchemaCheck) {
    const schema = await fetchCollectionSchema(config);
    schemaInfo = verifySchema(schema);
  }

  const state = loadState(options.stateFile);
  printEnvDiagnostics(options, config);

  let shouldStop = false;
  process.on('SIGINT', () => {
    shouldStop = true;
    console.log('\n[LiveSync] SIGINT received. Finishing current cycle before exit...');
  });
  process.on('SIGTERM', () => {
    shouldStop = true;
    console.log('\n[LiveSync] SIGTERM received. Finishing current cycle before exit...');
  });

  if (options.once) {
    await runCycle({ options, config, schemaInfo, state });
    saveState(options.stateFile, state);
    return;
  }

  while (!shouldStop) {
    const cycleStartedAt = Date.now();

    await runCycle({ options, config, schemaInfo, state });
    saveState(options.stateFile, state);

    const elapsedMs = Date.now() - cycleStartedAt;
    const intervalMs = Math.max(60 * 1000, options.intervalHours * 60 * 60 * 1000);
    const waitMs = Math.max(2000, intervalMs - elapsedMs);

    if (shouldStop) break;

    console.log(`[LiveSync] Cycle complete. Sleeping ${(waitMs / 1000).toFixed(0)}s until next run...`);
    await sleep(waitMs);
  }

  saveState(options.stateFile, state);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[LiveSync] Failed: ${message}`);
  process.exit(1);
});
