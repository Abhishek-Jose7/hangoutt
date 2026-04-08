#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nextEnvPkg from '@next/env';

const { loadEnvConfig } = nextEnvPkg;

loadEnvConfig(process.cwd());
loadLooseEnvFile(path.join(process.cwd(), '.env.local'));

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

const VALID_TYPES = [
  'cafe',
  'restaurant',
  'fast_food',
  'bar',
  'park',
  'garden',
  'mall',
  'cinema',
  'tourist_attraction',
];

const BLOCKED_KEYWORDS = [
  'bank',
  'atm',
  'office',
  'government',
  'school',
  'hospital',
  'clinic',
  'pharmacy',
  'petrol',
  'fuel',
  'warehouse',
  'toilet',
  'public toilet',
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

function printHelpAndExit(code) {
  console.log(`\nTypesense Venue Sync\n\nUsage:\n  npm run typesense:sync -- --area "Bandra West" [options]\n\nOptions:\n  --city <name>          City name (default: Mumbai)\n  --country <name>       Country name (default: India)\n  --radius <meters>      Overpass search radius (default: 2800)\n  --limit <count>        Max transformed docs to import (default: 450)\n  --batch-size <count>   Typesense import batch size (default: 100)\n  --timeout <seconds>    Overpass timeout value (default: 50)\n  --collection <name>    Typesense collection (default: env TYPESENSE_COLLECTION or venues)\n  --dry-run              Build docs but do not import\n  --skip-schema-check    Skip remote schema validation\n  --help                 Show this help\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    area: '',
    city: 'Mumbai',
    country: 'India',
    radius: 2800,
    timeoutSeconds: 50,
    limit: 450,
    batchSize: 100,
    dryRun: false,
    skipSchemaCheck: false,
    collection: process.env.TYPESENSE_COLLECTION?.trim() || 'venues',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--area' && next) {
      out.area = String(next).trim();
      i += 1;
      continue;
    }

    if (arg === '--city' && next) {
      out.city = String(next).trim();
      i += 1;
      continue;
    }

    if (arg === '--country' && next) {
      out.country = String(next).trim();
      i += 1;
      continue;
    }

    if (arg === '--radius' && next) {
      out.radius = Math.max(300, Number(next) || out.radius);
      i += 1;
      continue;
    }

    if (arg === '--limit' && next) {
      out.limit = Math.max(50, Number(next) || out.limit);
      i += 1;
      continue;
    }

    if (arg === '--batch-size' && next) {
      out.batchSize = Math.max(20, Math.min(400, Number(next) || out.batchSize));
      i += 1;
      continue;
    }

    if (arg === '--timeout' && next) {
      out.timeoutSeconds = Math.max(20, Number(next) || out.timeoutSeconds);
      i += 1;
      continue;
    }

    if (arg === '--collection' && next) {
      out.collection = String(next).trim();
      i += 1;
      continue;
    }

    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }

    if (arg === '--skip-schema-check') {
      out.skipSchemaCheck = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelpAndExit(0);
    }
  }

  if (!out.area) {
    console.error('Missing required argument: --area "Bandra West"');
    printHelpAndExit(1);
  }

  return out;
}

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(input) {
  return normalizeText(input).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function normalizeAreaName(input) {
  const cleaned = normalizeText(input);
  if (!cleaned) return 'Mumbai';
  return cleaned
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim();
}

function tokenQuality(name) {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function hasBalancedAlpha(name) {
  const compact = String(name).replace(/\s+/g, '');
  if (!compact) return false;
  const alphaChars = compact.replace(/[^A-Za-z]/g, '').length;
  return alphaChars / compact.length >= 0.55;
}

function looksLikeGarbagePoi(name) {
  const lowered = normalizeText(name);
  if (!lowered) return true;
  if (lowered.length < 4) return true;

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

function hasDisallowedTags(tags) {
  const amenity = String(tags.amenity || '').toLowerCase();
  if (amenity && DISALLOWED_AMENITIES.has(amenity)) return true;

  const text = normalizeText(
    `${tags.amenity || ''} ${tags.office || ''} ${tags.building || ''} ${tags.healthcare || ''} ${tags.name || ''}`
  );

  return BLOCKED_KEYWORDS.some((keyword) => text.includes(keyword));
}

function toNum(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseRupees(text) {
  if (!text) return undefined;
  const cleaned = String(text).replace(/,/g, '');
  const range = cleaned.match(/(\d{2,5})\s*[-/]\s*(\d{2,5})/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return Math.round((a + b) / 2);
  }

  const single = cleaned.match(/(\d{2,5})/);
  if (!single) return undefined;
  const value = Number(single[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function resolveOsmType(tags) {
  const amenity = String(tags.amenity || '').toLowerCase();
  const leisure = String(tags.leisure || '').toLowerCase();
  const tourism = String(tags.tourism || '').toLowerCase();
  const shop = String(tags.shop || '').toLowerCase();

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

function inferType(osmType) {
  if (osmType === 'cafe') return 'cafe';
  if (osmType === 'restaurant' || osmType === 'fast_food' || osmType === 'bar') return 'restaurant';
  if (osmType === 'park' || osmType === 'garden') return 'outdoor';
  return 'activity';
}

function inferMoods(type, tags) {
  const moods = new Set();

  if (type === 'outdoor') {
    moods.add('chill');
    moods.add('romantic');
  }

  if (type === 'restaurant') {
    moods.add('fun');
    moods.add('romantic');
  }

  if (type === 'cafe') {
    moods.add('chill');
    moods.add('fun');
  }

  if (type === 'activity') {
    moods.add('fun');
    moods.add('adventure');
  }

  const text = normalizeText(
    `${tags.amenity || ''} ${tags.leisure || ''} ${tags.tourism || ''} ${tags.shop || ''} ${tags.cuisine || ''} ${tags.name || ''}`
  );

  if (/(park|garden|lake|viewpoint|sunset|promenade|beach)/.test(text)) moods.add('chill');
  if (/(fine dining|dessert|cafe|date|viewpoint)/.test(text)) moods.add('romantic');
  if (/(escape|bowling|arcade|sports|amusement|theme park)/.test(text)) moods.add('adventure');
  if (/(cinema|restaurant|mall|food court|music|club|pub)/.test(text)) moods.add('fun');

  return Array.from(moods).slice(0, 4);
}

function inferEstimatedCost(type, tags) {
  const baseline = {
    cafe: 320,
    restaurant: 650,
    activity: 700,
    outdoor: 120,
  };

  const explicit =
    parseRupees(tags['price:per_person']) ||
    parseRupees(tags.price) ||
    parseRupees(tags.charge);

  const value = explicit || baseline[type] || 450;
  return Math.round(clamp(value, 80, 4000));
}

function inferRating(tags) {
  const candidate = toNum(tags.rating) ?? toNum(tags.stars);
  if (typeof candidate === 'number') return clamp(candidate, 0, 5);
  return 4;
}

function inferPopularity(tags) {
  let score = 40;
  if (tags.website || tags['contact:website']) score += 14;
  if (tags.phone || tags['contact:phone']) score += 10;
  if (tags.opening_hours) score += 8;
  if (tags.brand || tags.operator) score += 10;
  if (tags.wikidata || tags.wikipedia) score += 16;

  const rating = toNum(tags.rating) || toNum(tags.stars);
  if (typeof rating === 'number' && rating >= 4) score += 8;

  return Math.round(clamp(score, 1, 100));
}

function inferDescription(tags, type, area) {
  const pieces = [];
  const cuisine = String(tags.cuisine || '').trim();
  const amenity = String(tags.amenity || '').trim();
  const leisure = String(tags.leisure || '').trim();
  const tourism = String(tags.tourism || '').trim();

  if (cuisine) pieces.push(`${cuisine.replace(/;/g, ', ')} spot`);
  if (!cuisine && amenity) pieces.push(amenity.replace(/_/g, ' '));
  if (leisure) pieces.push(leisure.replace(/_/g, ' '));
  if (tourism) pieces.push(tourism.replace(/_/g, ' '));
  if (pieces.length === 0) pieces.push(type);

  return `${pieces.join(' | ')} in ${area}`;
}

function inferTags(tags, type) {
  const bucket = new Set([type]);
  const keys = ['amenity', 'leisure', 'tourism', 'shop', 'cuisine', 'diet:vegetarian', 'outdoor_seating'];

  for (const key of keys) {
    const raw = tags[key];
    if (!raw) continue;

    const values = String(raw)
      .split(';')
      .map((v) => normalizeText(v).replace(/\s+/g, '_'))
      .filter(Boolean)
      .slice(0, 3);

    for (const value of values) bucket.add(value);
  }

  return Array.from(bucket).slice(0, 15);
}

function mapsUrl(lat, lng, name) {
  const q = `${lat},${lng} (${name})`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function makeStableId(name, lat, lng) {
  const seed = `${normalizeText(name)}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
  const digest = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
  return `osm_${digest}`;
}

function ensureDocSchema(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (typeof doc.id !== 'string' || !doc.id) return false;
  if (typeof doc.name !== 'string' || !doc.name) return false;
  if (typeof doc.description !== 'string' || !doc.description) return false;
  if (!Array.isArray(doc.tags) || doc.tags.some((t) => typeof t !== 'string')) return false;
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

async function geocodeArea({ area, city, country }) {
  const query = `${area}, ${city}, ${country}`;
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      'User-Agent': 'hangout-typesense-sync/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim geocode failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No centroid found for area "${area}" in "${city}"`);
  }

  const lat = Number(data[0].lat);
  const lng = Number(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Invalid geocode coordinates received');
  }

  return {
    lat,
    lng,
    displayName: String(data[0].display_name || query),
  };
}

function buildOverpassQuery({ lat, lng, radius, timeoutSeconds }) {
  return `[out:json][timeout:${timeoutSeconds}];\n(\n  nwr[\"amenity\"~\"cafe|restaurant|fast_food|bar|cinema\"][\"name\"](around:${radius},${lat},${lng});\n  nwr[\"leisure\"~\"park|garden\"][\"name\"](around:${radius},${lat},${lng});\n  nwr[\"tourism\"=\"attraction\"][\"name\"](around:${radius},${lat},${lng});\n  nwr[\"shop\"=\"mall\"][\"name\"](around:${radius},${lat},${lng});\n);\nout center;`;
}

async function fetchOsmPlaces(query) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
  ];

  const errors = [];

  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 70000);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=UTF-8',
            'User-Agent': 'hangout-typesense-sync/1.0',
          },
          body: query,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          errors.push(`${endpoint} attempt ${attempt}: ${response.status} ${response.statusText}`);
          continue;
        }

        const payload = await response.json();
        return Array.isArray(payload.elements) ? payload.elements : [];
      } catch (error) {
        clearTimeout(timer);
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(`${endpoint} attempt ${attempt}: ${reason}`);
      }
    }
  }

  throw new Error(`Overpass fetch failed after retries: ${errors.join(' | ')}`);
}

function transformElementsToDocs(elements, options) {
  const seen = new Set();
  const docs = [];

  for (const element of elements) {
    const tags = element.tags || {};
    const name = String(tags.name || '').trim();
    const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat;
    const lng = typeof element.lon === 'number' ? element.lon : element.center?.lon;

    if (!name || typeof lat !== 'number' || typeof lng !== 'number') {
      continue;
    }

    if (hasDisallowedTags(tags) || looksLikeGarbagePoi(name)) {
      continue;
    }

    const osmType = resolveOsmType(tags);
    if (!osmType || !VALID_TYPES.includes(osmType)) {
      continue;
    }

    const normalizedName = normalizeText(name);
    if (!normalizedName || normalizedName.length < 4) {
      continue;
    }

    const dedupeKey = `${normalizedName}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const type = inferType(osmType);
    const mood = inferMoods(type, tags);
    const doc = {
      id: makeStableId(name, lat, lng),
      name,
      description: inferDescription(tags, type, options.area),
      tags: inferTags(tags, type),
      area: options.area,
      mood,
      type,
      estimated_cost: inferEstimatedCost(type, tags),
      lat,
      lng,
      rating: inferRating(tags),
      popularity: inferPopularity(tags),
      url: mapsUrl(lat, lng, name),
    };

    if (!ensureDocSchema(doc)) {
      continue;
    }

    docs.push(doc);
    if (docs.length >= options.limit) {
      break;
    }
  }

  return docs;
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
  const hostWithPort = hasScheme ? resolvedHostRaw : `${protocol}://${port ? `${resolvedHostRaw}:${port}` : resolvedHostRaw}`;

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
  const map = new Map(fields.map((f) => [f.name, f.type]));

  const missing = [];
  const mismatches = [];

  for (const [field, expectedType] of Object.entries(REQUIRED_SCHEMA)) {
    // Typesense supports an implicit document id even when `id` is not listed in `fields`.
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
    const problems = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      mismatches.length ? `type mismatches: ${mismatches.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    throw new Error(`Collection schema is incompatible with pipeline: ${problems}`);
  }
}

async function importDocuments(config, docs, batchSize) {
  if (!docs.length) {
    return {
      success: 0,
      failed: 0,
      failures: [],
    };
  }

  const importUrl = `${config.baseUrl}/collections/${encodeURIComponent(config.collection)}/documents/import?action=upsert&batch_size=${batchSize}`;
  const body = docs.map((doc) => JSON.stringify(doc)).join('\n');

  const response = await fetch(importUrl, {
    method: 'POST',
    headers: {
      'X-TYPESENSE-API-KEY': config.apiKey,
      'Content-Type': 'text/plain',
    },
    body,
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
      const item = JSON.parse(line);
      if (item.success === true) {
        success += 1;
      } else {
        failed += 1;
        failures.push({
          id: item.document?.id,
          error: item.error || 'Unknown error',
        });
      }
    } catch {
      failed += 1;
      failures.push({ id: 'unknown', error: `Unparseable import response: ${line}` });
    }
  }

  return { success, failed, failures };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  args.area = normalizeAreaName(args.area);
  const config = resolveTypesenseConfig(args.collection, args.dryRun && args.skipSchemaCheck);

  console.log(`\n[TypesenseSync] Area: ${args.area}, City: ${args.city}`);
  console.log(`[TypesenseSync] Collection: ${config.collection}, Radius: ${args.radius}m, Dry-run: ${args.dryRun ? 'yes' : 'no'}`);

  if (!args.skipSchemaCheck) {
    const schema = await fetchCollectionSchema(config);
    verifySchema(schema);
  }

  const centroid = await geocodeArea(args);
  console.log(`[TypesenseSync] Geocoded centroid: ${centroid.lat.toFixed(6)}, ${centroid.lng.toFixed(6)} (${centroid.displayName})`);

  const overpassQuery = buildOverpassQuery({
    lat: centroid.lat,
    lng: centroid.lng,
    radius: args.radius,
    timeoutSeconds: args.timeoutSeconds,
  });

  const elements = await fetchOsmPlaces(overpassQuery);
  console.log(`[TypesenseSync] OSM elements fetched: ${elements.length}`);

  const docs = transformElementsToDocs(elements, {
    area: args.area,
    limit: args.limit,
  });

  const areaSlug = slug(args.area);
  const typeBreakdown = docs.reduce((acc, doc) => {
    acc[doc.type] = (acc[doc.type] || 0) + 1;
    return acc;
  }, {});

  console.log(`[TypesenseSync] Documents ready: ${docs.length}`);
  console.log(`[TypesenseSync] Type breakdown: ${JSON.stringify(typeBreakdown)}`);

  if (docs.length === 0) {
    console.warn('[TypesenseSync] No valid documents generated after cleaning/filtering.');
    return;
  }

  if (args.dryRun) {
    console.log('\n[TypesenseSync] Dry-run preview (first 5 docs):');
    for (const doc of docs.slice(0, 5)) {
      console.log(JSON.stringify(doc, null, 2));
    }
    console.log(`\n[TypesenseSync] Dry-run completed for area slug: ${areaSlug}`);
    return;
  }

  const result = await importDocuments(config, docs, args.batchSize);
  console.log(`\n[TypesenseSync] Import complete: ${result.success} upserted, ${result.failed} failed`);

  if (result.failures.length > 0) {
    console.log('[TypesenseSync] Top failures:');
    for (const failure of result.failures.slice(0, 10)) {
      console.log(`- ${failure.id || 'unknown'} -> ${failure.error}`);
    }
  }
}

run().catch((error) => {
  console.error(`\n[TypesenseSync] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
