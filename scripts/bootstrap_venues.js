/**
 * Bootstrap venue discovery for all major Mumbai areas.
 *
 * Populates local.db with venues from the Ola Places API.
 * Run: node scripts/bootstrap_venues.js
 * Resume:  node scripts/bootstrap_venues.js --start 20
 * One zone: node scripts/bootstrap_venues.js --zone Andheri
 */
'use strict';

const path = require('path');
const { randomUUID } = require('crypto');

// Load env
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch (_) {}

const OLA_API_KEY = process.env.OLA_MAPS_API_KEY;
if (!OLA_API_KEY || OLA_API_KEY === 'your_ola_maps_api_key' || OLA_API_KEY.includes('placeholder')) {
  console.error('\nERROR: OLA_MAPS_API_KEY not set in .env');
  process.exit(1);
}

const DB_PATH = path.resolve(__dirname, '../local.db');
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

// ─── Zone list (mirrors DISCOVERY_ZONES in workers/api.ts) ───────────────────
const ALL_ZONES = [
  // South Mumbai
  { name: 'Colaba',         lat: 18.9219, lng: 72.8319, radius: 2000 },
  { name: 'Fort',           lat: 18.9389, lng: 72.8354, radius: 2000 },
  { name: 'Churchgate',     lat: 18.9347, lng: 72.8263, radius: 2000 },
  { name: 'Marine Lines',   lat: 18.9455, lng: 72.8215, radius: 2000 },
  { name: 'Girgaon',        lat: 18.9536, lng: 72.8159, radius: 2000 },
  { name: 'Grant Road',     lat: 18.9636, lng: 72.8178, radius: 2000 },
  { name: 'Mumbai Central', lat: 18.9697, lng: 72.8199, radius: 2000 },
  { name: 'Mahalakshmi',    lat: 18.9798, lng: 72.8167, radius: 2000 },
  // Central Mumbai
  { name: 'Byculla',        lat: 18.9795, lng: 72.8364, radius: 2000 },
  { name: 'Worli',          lat: 19.0082, lng: 72.8178, radius: 2500 },
  { name: 'Lower Parel',    lat: 18.9996, lng: 72.8283, radius: 2500 },
  { name: 'Prabhadevi',     lat: 19.0073, lng: 72.8273, radius: 2000 },
  { name: 'Parel',          lat: 19.0016, lng: 72.8429, radius: 2000 },
  { name: 'Dadar',          lat: 19.0178, lng: 72.8478, radius: 2500 },
  { name: 'Matunga',        lat: 19.0292, lng: 72.8457, radius: 2000 },
  { name: 'Sewri',          lat: 19.0089, lng: 72.8600, radius: 2000 },
  { name: 'Wadala',         lat: 19.0263, lng: 72.8631, radius: 2000 },
  { name: 'Sion',           lat: 19.0453, lng: 72.8695, radius: 2000 },
  // Western Suburbs
  { name: 'Mahim',          lat: 19.0411, lng: 72.8380, radius: 2000 },
  { name: 'Bandra',         lat: 19.0596, lng: 72.8295, radius: 3000 },
  { name: 'BKC',            lat: 19.0660, lng: 72.8668, radius: 2500 },
  { name: 'Khar',           lat: 19.0717, lng: 72.8355, radius: 2000 },
  { name: 'Santacruz',      lat: 19.0824, lng: 72.8425, radius: 2500 },
  { name: 'Juhu',           lat: 19.1075, lng: 72.8263, radius: 2500 },
  { name: 'Vile Parle',     lat: 19.0990, lng: 72.8486, radius: 2500 },
  { name: 'Andheri',        lat: 19.1136, lng: 72.8697, radius: 3500 },
  { name: 'Versova',        lat: 19.1385, lng: 72.8116, radius: 2500 },
  { name: 'Jogeshwari',     lat: 19.1346, lng: 72.8456, radius: 2500 },
  { name: 'Goregaon',       lat: 19.1544, lng: 72.8482, radius: 3000 },
  { name: 'Malad',          lat: 19.1872, lng: 72.8483, radius: 3000 },
  { name: 'Kandivali',      lat: 19.2054, lng: 72.8544, radius: 3000 },
  { name: 'Borivali',       lat: 19.2290, lng: 72.8570, radius: 3500 },
  { name: 'Dahisar',        lat: 19.2618, lng: 72.8595, radius: 3000 },
  // Eastern Suburbs (Central Line)
  { name: 'Kurla',          lat: 19.0607, lng: 72.8826, radius: 3000 },
  { name: 'Chunabhatti',    lat: 19.0417, lng: 72.8888, radius: 2000 },
  { name: 'Chembur',        lat: 19.0622, lng: 72.8999, radius: 2500 },
  { name: 'Ghatkopar',      lat: 19.0860, lng: 72.9082, radius: 3000 },
  { name: 'Vikhroli',       lat: 19.1048, lng: 72.9297, radius: 2500 },
  { name: 'Powai',          lat: 19.1176, lng: 72.9060, radius: 3000 },
  { name: 'Bhandup',        lat: 19.1519, lng: 72.9396, radius: 2500 },
  { name: 'Mulund',         lat: 19.1724, lng: 72.9596, radius: 3000 },
  { name: 'Thane',          lat: 19.2183, lng: 72.9781, radius: 4500 },
  { name: 'Dombivli',       lat: 19.2149, lng: 73.0893, radius: 3500 },
  // Harbour Line / Navi Mumbai
  { name: 'Mankhurd',       lat: 19.0683, lng: 72.9272, radius: 2500 },
  { name: 'Vashi',          lat: 19.0745, lng: 72.9978, radius: 3500 },
  { name: 'Sanpada',        lat: 19.0630, lng: 72.9998, radius: 2500 },
  { name: 'Juinagar',       lat: 19.0445, lng: 73.0064, radius: 2000 },
  { name: 'Nerul',          lat: 19.0341, lng: 73.0198, radius: 2500 },
  { name: 'Seawoods',       lat: 19.0212, lng: 73.0192, radius: 2500 },
  { name: 'Belapur',        lat: 19.0180, lng: 73.0392, radius: 3000 },
  { name: 'Kharghar',       lat: 19.0460, lng: 73.0680, radius: 3000 },
  { name: 'Airoli',         lat: 19.1505, lng: 73.0095, radius: 2500 },
  { name: 'Panvel',         lat: 18.9894, lng: 73.1175, radius: 4000 },
];

// ─── Categories to discover ───────────────────────────────────────────────────
const CATEGORIES = [
  { type: 'cafe',           cat: 'CAFE' },
  { type: 'restaurant',     cat: 'RESTAURANT' },
  { type: 'amusement_park', cat: 'ARCADE' },
  { type: 'bowling_alley',  cat: 'BOWLING' },
  { type: 'museum',         cat: 'MUSEUM' },
  { type: 'shopping_mall',  cat: 'MALL' },
  { type: 'park',           cat: 'PARK' },
  { type: 'bakery',         cat: 'DESSERT' },
  { type: 'movie_theater',  cat: 'MOVIE' },
  { type: 'stadium',        cat: 'SPORTS' },
];

const BAD_TYPES = new Set([
  'delivery', 'meal_delivery', 'hospital', 'health', 'doctor', 'dentist',
  'physiotherapist', 'spa', 'gym', 'beauty_salon', 'hair_care',
  'school', 'university', 'lodging', 'car_repair', 'car_wash',
  'transit_station', 'bus_station', 'subway_station', 'parking',
]);

const BAD_PATTERNS = [
  'anchor', 'emcee', 'dj ', ' dj', 'show host',
  'event planner', 'wedding planner', 'decorator', 'caterer', 'catering',
  'photographer', 'videographer', 'consultant', 'pvt ltd', 'pvt. ltd',
  'cosmetologist', 'physiotherapist', 'dermatologist',
  'beauty parlour', 'salon', 'spa', 'gym', 'fitness center',
  'metro station', 'railway station', 'bus stand', 'bus terminal', 'bus depot',
  'airport lounge', 'airport terminal',
  'corporate park', 'corporate tower', 'corporate hub',
  'apartment', ' apts', 'housing society', 'co-op housing', 'chawl',
  'gate no', ' gate 1', ' gate 2', 'garden gate',
  'puppeteer', 'ventriloquist', 'puppet-maker',
  'cable vision', 'cable tv', 'cable network', 'infotainment',
  'wall painting', 'statue structure', 'maidan',
  'kidzania', 'smaaash junior', 'kids play area',
  'delivery only', 'cloud kitchen', 'takeaway only',
  'temple', 'mandir', 'masjid', 'mosque', 'church', 'gurudwara', 'synagogue',
];

const CONVERSATION_SCORES = {
  POTTERY: 10, BOARD_GAMES: 8, ESCAPE_ROOM: 8,
  MUSEUM: 7, ART_GALLERY: 7, CAFE: 6, RESTAURANT: 5, PARK: 6,
  DESSERT: 5, ARCADE: 4, BOWLING: 4, SPORTS: 3, MALL: 3, MOVIE: 4,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'X-Request-Id': `hangoutt-bootstrap-${Date.now()}`,
      'Referer': 'http://localhost:3000',
      'Origin': 'http://localhost:3000',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

function countExistingVenues(zone, category) {
  const latDiff = zone.radius / 111000;
  const lngDiff = zone.radius / (111000 * Math.cos(zone.lat * Math.PI / 180));
  const row = db.prepare(`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM places p
    JOIN place_categories pc ON pc.place_id = p.id
    WHERE p.lat BETWEEN ? AND ?
      AND p.lng BETWEEN ? AND ?
      AND pc.category = ?
      AND p.is_hidden = 0
  `).get(
    zone.lat - latDiff, zone.lat + latDiff,
    zone.lng - lngDiff, zone.lng + lngDiff,
    category
  );
  return row ? row.cnt : 0;
}

function getCosts(cat) {
  switch (cat) {
    case 'CAFE':       return { mandatory: 0,   min: 200, max: 600 };
    case 'RESTAURANT': return { mandatory: 0,   min: 300, max: 1000 };
    case 'BOWLING':    return { mandatory: 350, min: 100, max: 400 };
    case 'ARCADE':     return { mandatory: 300, min: 100, max: 500 };
    case 'MUSEUM':     return { mandatory: 150, min: 0,   max: 0 };
    case 'MALL':       return { mandatory: 0,   min: 100, max: 500 };
    case 'PARK':       return { mandatory: 0,   min: 0,   max: 0 };
    case 'DESSERT':    return { mandatory: 0,   min: 150, max: 450 };
    case 'MOVIE':      return { mandatory: 300, min: 0,   max: 200 };
    case 'SPORTS':     return { mandatory: 300, min: 100, max: 500 };
    default:           return { mandatory: 0,   min: 200, max: 600 };
  }
}

function getSuitability(cat) {
  return {
    group:   ['CAFE','RESTAURANT','BOWLING','ARCADE','MOVIE','SPORTS'].includes(cat) ? 0.8 : 0.5,
    date:    ['CAFE','PARK','RESTAURANT','DESSERT','MOVIE'].includes(cat) ? 0.9 : 0.5,
    friends: ['BOWLING','ARCADE','CAFE','SPORTS','ESCAPE_ROOM'].includes(cat) ? 0.9 : 0.5,
    family:  ['MUSEUM','PARK','RESTAURANT','MOVIE','MALL'].includes(cat) ? 0.9 : 0.5,
    weather: ['PARK'].includes(cat) ? 0.6 : 1.0,
    unique:  ['MUSEUM','ESCAPE_ROOM'].includes(cat) ? 0.8 : 0.5,
  };
}

const insertOrUpdatePlace = db.prepare(`
  INSERT INTO places (
    id, name, address, lat, lng, rating, review_count,
    business_status, source_name, source_place_id,
    is_hidden, last_verified, verified_at, first_seen, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?,
    'OPERATIONAL', 'OLA', ?,
    0, ?, ?, ?, ?, ?
  )
  ON CONFLICT(id) DO UPDATE SET
    name         = excluded.name,
    address      = excluded.address,
    rating       = excluded.rating,
    review_count = excluded.review_count,
    is_hidden    = 0,
    last_verified = excluded.last_verified,
    updated_at   = excluded.updated_at
`);

const insertCategory = db.prepare(`
  INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)
`);

const insertCost = db.prepare(`
  INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max)
  VALUES (?, ?, ?, ?)
`);

const insertScore = db.prepare(`
  INSERT OR REPLACE INTO place_scores (
    place_id, popularity, budget_friendliness, conversation,
    group_suitability, date_suitability, friends_suitability,
    family_suitability, weather_suitability, uniqueness, experience_score, overall
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function upsertVenue({ id, name, address, lat, lng, rating, reviewCount, placeId, cat }) {
  const now = new Date().toISOString();
  const costs = getCosts(cat);
  const suit = getSuitability(cat);
  const convScore = (CONVERSATION_SCORES[cat] || 5) / 10.0;
  const popularity = rating ? rating / 5.0 : 0.5;
  const budgetFriendly = Math.max(0, Math.min(1, 1 - costs.mandatory / 1500));
  const expScore = 0.8;
  const overall = (popularity + convScore + expScore) / 3.0;
  const experienceType = ['BOWLING','ARCADE','MUSEUM'].includes(cat) ? 'PRIMARY_EXPERIENCE'
                       : ['CAFE','RESTAURANT','DESSERT'].includes(cat) ? 'FOOD_STOP'
                       : 'OPTIONAL_STOP';

  insertOrUpdatePlace.run(
    id, name, address, lat, lng, rating ?? null, reviewCount ?? 0,
    placeId, now, now, now, now, now
  );
  insertCategory.run(randomUUID(), id, cat);
  insertCategory.run(randomUUID(), id, experienceType);
  insertCost.run(id, costs.mandatory, costs.min, costs.max);
  insertScore.run(
    id, popularity, budgetFriendly, convScore,
    suit.group, suit.date, suit.friends, suit.family,
    suit.weather, suit.unique, expScore, overall
  );
}

// ─── Main discovery loop ──────────────────────────────────────────────────────
async function discoverZone(zone) {
  let zoneTotal = 0;
  for (const { type, cat } of CATEGORIES) {
    const existing = countExistingVenues(zone, cat);
    if (existing >= 6) {
      process.stdout.write(`  ${cat.padEnd(12)} ${existing} already ✓\n`);
      continue;
    }

    const url = `https://api.olamaps.io/places/v1/nearbysearch?layers=venue&types=${type}&location=${zone.lat},${zone.lng}&radius=${zone.radius}&api_key=${OLA_API_KEY}`;
    let results = [];
    try {
      const data = await fetchJson(url);
      results = (data?.predictions || data?.results || []).slice(0, 12);
      await sleep(350);
    } catch (err) {
      process.stdout.write(`  ${cat.padEnd(12)} API error: ${err.message}\n`);
      await sleep(1000);
      continue;
    }

    let added = 0;
    for (const item of results) {
      const placeId = item.place_id;
      if (!placeId) continue;

      // Fetch full details
      let result;
      try {
        const detailsUrl = `https://api.olamaps.io/places/v1/details?place_id=${encodeURIComponent(placeId)}&api_key=${OLA_API_KEY}`;
        const detailsData = await fetchJson(detailsUrl);
        result = detailsData?.result;
        await sleep(200);
      } catch (_) {
        continue;
      }
      if (!result) continue;

      const name = (result.name || item.description || '').trim();
      if (!name || name.length < 3) continue;

      const address = result.formatted_address || result.vicinity || '';
      const placeLat = result.geometry?.location?.lat;
      const placeLng = result.geometry?.location?.lng;
      if (!placeLat || !placeLng) continue;

      // Skip permanently closed
      const status = (result.business_status || '').toUpperCase();
      if (status.includes('CLOSED')) continue;

      const rating = result.rating ? Number(result.rating) : null;
      const reviewCount = result.user_ratings_total || 0;

      // Lenient quality gate — reject only if Ola has confirmed evidence the venue is bad
      if (rating !== null && rating > 0 && reviewCount > 0 && (rating < 4.0 || reviewCount < 20)) continue;

      // Type filter
      const types = result.types || [];
      if (types.some(t => BAD_TYPES.has(t))) continue;

      // Name pattern filter
      const nameLower = name.toLowerCase();
      if (BAD_PATTERNS.some(p => nameLower.includes(p))) continue;

      // Tighter arcade gate — amusement_park returns water parks, corporate parks
      if (type === 'amusement_park' && reviewCount < 50) continue;

      // For bakery/dessert — skip pure bread shops and pharmacies
      if (cat === 'DESSERT') {
        if (nameLower.includes('medical') || nameLower.includes('pharmacy') ||
            nameLower.includes('chemist') || nameLower.includes('bread factory')) continue;
      }

      // For stadium/sports — skip corporate sports clubs with <50 reviews
      if (cat === 'SPORTS' && reviewCount < 30) continue;

      db.transaction(() => {
        upsertVenue({
          id: `OLA_${placeId}`,
          name, address, lat: placeLat, lng: placeLng,
          rating, reviewCount, placeId, cat,
        });
      })();
      added++;
    }

    process.stdout.write(`  ${cat.padEnd(12)} +${added} new (was ${existing})\n`);
    zoneTotal += added;
  }
  return zoneTotal;
}

async function main() {
  const args = process.argv.slice(2);

  // Single zone mode: --zone "Andheri"
  const zoneIdx = args.indexOf('--zone');
  if (zoneIdx !== -1) {
    const zoneName = args[zoneIdx + 1];
    const zone = ALL_ZONES.find(z => z.name.toLowerCase() === zoneName.toLowerCase());
    if (!zone) {
      console.error(`Zone "${zoneName}" not found. Available: ${ALL_ZONES.map(z => z.name).join(', ')}`);
      process.exit(1);
    }
    console.log(`\n[${zone.name}]`);
    const n = await discoverZone(zone);
    console.log(`Done. ${n} venues added for ${zone.name}.`);
    db.close();
    return;
  }

  // Batch mode with optional --start N
  const startIdx = args.includes('--start') ? parseInt(args[args.indexOf('--start') + 1] || '0') : 0;
  const zones = ALL_ZONES.slice(startIdx);
  const totalZones = ALL_ZONES.length;

  console.log(`\nBootstrap: ${zones.length} zones (${startIdx}–${totalZones - 1}), ${CATEGORIES.length} categories each`);
  console.log('Min coverage threshold: 6 per zone/category (skips if already met)\n');

  let grandTotal = 0;
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const globalIdx = startIdx + i;
    console.log(`\n[${globalIdx + 1}/${totalZones}] ${zone.name}`);
    const n = await discoverZone(zone);
    grandTotal += n;
    console.log(`  → ${n} added this zone | ${grandTotal} total so far`);
  }

  db.close();
  console.log(`\nDone. ${grandTotal} venues added/updated across ${zones.length} zones.`);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  try { db.close(); } catch (_) {}
  process.exit(1);
});
