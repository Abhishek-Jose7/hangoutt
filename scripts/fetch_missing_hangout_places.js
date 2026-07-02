const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error('GOOGLE_MAPS_API_KEY is not set in the environment or .env.');
  process.exit(1);
}

const QUERY_SETS = [
  { category: 'CAFE', cost: [0, 250, 650], queries: ['independent cafe', 'specialty coffee cafe', 'romantic cafe', 'board game cafe', 'rooftop cafe', 'art cafe'] },
  { category: 'RESTAURANT', cost: [0, 450, 1200], queries: ['romantic restaurant', 'rooftop restaurant', 'bistro', 'gastropub', 'date night restaurant'] },
  { category: 'DESSERT', cost: [0, 180, 500], queries: ['patisserie', 'dessert cafe', 'gelato', 'bakery cafe', 'ice cream cafe'] },
  { category: 'ARCADE', cost: [350, 100, 700], queries: ['arcade games', 'gaming arcade', 'indoor games'] },
  { category: 'BOWLING', cost: [450, 100, 700], queries: ['bowling alley', 'bowling arcade'] },
  { category: 'ESCAPE_ROOM', cost: [700, 0, 0], queries: ['escape room', 'mystery room'] },
  { category: 'MUSEUM', cost: [150, 0, 0], queries: ['museum', 'science centre', 'art museum'] },
  { category: 'ART_GALLERY', cost: [150, 0, 0], queries: ['art gallery', 'contemporary art gallery'] },
  { category: 'POTTERY', cost: [900, 0, 0], queries: ['pottery studio', 'ceramic workshop', 'art workshop'] },
  { category: 'PARK', cost: [0, 0, 0], queries: ['promenade', 'lake promenade', 'beach', 'fort viewpoint', 'waterfront park'] },
];

const CATEGORY_CONFIG = Object.fromEntries(QUERY_SETS.map(set => [set.category, set]));

const LOW_INTENT_CHAINS = [
  'mcdonald', 'domino', 'kfc', 'subway', 'burger king', 'pizza hut',
  'barbeque nation', 'bbq nation', 'monginis', 'ribbons and balloons',
  'cafe coffee day', 'café coffee day', 'ccd', 'mad over donuts',
  'belgian waffle', 'naturals ice cream', 'starbucks', 'barista',
  'mccafé', 'mccafe', 'coffee day express'
];

const BAD_PATTERNS = [
  ' pvt ltd', ' pvt. ltd', ' limited', ' ltd.', 'corporate', 'office',
  'apartment', 'housing', 'society', ' co-op', ' chs', 'residency',
  'tower', 'villa', 'building', 'bldg', 'gate no', 'transit', 'compound',
  'estate', 'banquet', 'community hall', 'rickshaw', 'auto stand', 'parking',
  'metro station', 'railway station', 'bus stand', 'collection', 'boutique',
  'clothing', 'designer', 'couture', 'tailor', 'saree', 'fashion', 'textile',
  'jeweller', 'advisory', 'wealth', 'consultancy', 'law firm', 'legal',
  'finance', 'financial', 'diagnostic', 'clinic', 'hospital', 'dental',
  'school', 'college', 'classes', 'tuition', 'hostel', 'gymkhana',
  'club house', 'ground', 'maidan', 'kridangan', 'football turf',
  'cricket ground', 'mandir', 'temple', 'masjid', 'church', 'vihar',
  'holiday', 'holidays', 'travel', 'travels', 'tour', 'tours', 'frame',
  'frames', 'branding', 'conclave', 'dynamic positioning', 'training centre',
  'training center', 'guest house', 'resturant service', 'hotel ', 'max',
  'wholesale', 'exhibition centre', 'manufacturing', 'enterprise',
  'shop', 'shops', 'store', 'stores', 'mart', 'supermarket', 'super market'
];

const STRONG_PATTERNS = [
  'social', 'cafe', 'café', 'coffee', 'bistro', 'bakery', 'patisserie',
  'dessert', 'creamery', 'ice cream', 'gelato', 'taproom', 'bar', 'brew',
  'brewery', 'diner', 'kitchen', 'restaurant', 'pizzeria', 'arcade', 'game',
  'gaming', 'timezone', 'smaaash', 'bowling', 'escape', 'museum', 'gallery',
  'art', 'studio', 'pottery', 'workshop', 'promenade', 'beach', 'lake',
  'fort', 'national park', 'nature park', 'waterfront', 'viewpoint', 'mall'
];

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function positionalArgs() {
  const raw = process.argv.slice(2);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (token.startsWith('--')) {
      const next = raw[i + 1];
      if (next && !next.startsWith('--')) i++;
      continue;
    }
    out.push(token);
  }
  return out;
}

function resolveCliOptions() {
  const positional = positionalArgs();
  const firstPositional = positional[0] && positional[0].toLowerCase() === 'all' ? null : positional[0];
  const zone = argValue('--zone', firstPositional || null);
  const category = argValue('--category', null);
  const positionalLimit = positional.find(value => /^\d+$/.test(value));
  const limitPerQuery = Number(argValue('--limit-per-query', positionalLimit || '8'));
  const explicitDryRun = hasFlag('--dry-run') || positional.includes('dry-run') || process.env.DRY_RUN === '1';
  const write = hasFlag('--write') || positional.includes('write') || process.env.WRITE === '1';
  const remote = hasFlag('--remote') || positional.includes('remote') || process.env.REMOTE === '1';
  const dryRun = explicitDryRun || !write;
  const allZones = hasFlag('--all') || positional.includes('all') || process.env.ALL_ZONES === '1';
  const dbPath = path.resolve(process.cwd(), argValue('--db', process.env.DB_LOCAL_PATH || './local.db'));
  return { zone, category, limitPerQuery, dryRun, remote, allZones, dbPath, write };
}

function includesAny(text, patterns) {
  return patterns.some(p => text.includes(p));
}

function categoryScore(category) {
  return {
    CAFE: [0.6, 0.8, 0.8, 0.9, 0.8, 0.7],
    RESTAURANT: [0.5, 0.8, 0.8, 0.9, 0.7, 0.7],
    DESSERT: [0.5, 0.9, 0.7, 0.9, 0.7, 0.6],
    ARCADE: [0.4, 0.7, 0.9, 0.5, 0.9, 0.7],
    BOWLING: [0.4, 0.7, 0.9, 0.5, 0.9, 0.7],
    ESCAPE_ROOM: [0.8, 0.6, 1.0, 0.6, 0.9, 0.9],
    MUSEUM: [0.7, 0.8, 0.8, 0.8, 0.5, 0.8],
    ART_GALLERY: [0.8, 0.8, 0.8, 0.9, 0.6, 0.9],
    POTTERY: [0.9, 0.6, 1.0, 0.9, 0.8, 0.9],
    PARK: [0.7, 1.0, 0.6, 0.9, 0.7, 0.8],
  }[category] || [0.5, 0.7, 0.7, 0.7, 0.7, 0.7];
}

function inferCategory(place, fallbackCategory) {
  const text = `${place.displayName?.text || ''} ${(place.types || []).join(' ')}`.toLowerCase();
  if (text.includes('escape') || text.includes('mystery room')) return 'ESCAPE_ROOM';
  if (text.includes('bowling')) return 'BOWLING';
  if (text.includes('arcade') || text.includes('gaming') || text.includes('game zone') || text.includes('timezone') || text.includes('smaaash')) return 'ARCADE';
  if (text.includes('pottery') || text.includes('ceramic')) return 'POTTERY';
  if (text.includes('gallery') && !text.includes('cafe') && !text.includes('restaurant')) return 'ART_GALLERY';
  if (text.includes('museum') || text.includes('science centre') || text.includes('science center')) return 'MUSEUM';
  if (text.includes('patisserie') || text.includes('dessert') || text.includes('gelato') || text.includes('ice cream') || text.includes('bakery')) return 'DESSERT';
  if (text.includes('promenade') || text.includes('beach') || text.includes('lake') || text.includes('fort') || text.includes('waterfront')) return 'PARK';
  return fallbackCategory;
}

function isGoodPlace(place, category) {
  const name = place.displayName?.text || '';
  const address = place.formattedAddress || '';
  const text = `${name} ${address} ${(place.types || []).join(' ')}`.toLowerCase();
  const rating = Number(place.rating || 0);
  const reviews = Number(place.userRatingCount || 0);
  if (!name || !place.location?.latitude || !place.location?.longitude) return false;
  if ((place.businessStatus || '').includes('CLOSED')) return false;
  if (includesAny(text, LOW_INTENT_CHAINS)) return false;
  if (includesAny(text, BAD_PATTERNS) && !includesAny(text, STRONG_PATTERNS)) return false;
  if (rating > 0 && rating < 4.2) return false;
  if (reviews > 0 && reviews < (category === 'PARK' ? 25 : 40)) return false;
  if (category === 'PARK' && !includesAny(text, ['promenade', 'beach', 'lake', 'fort', 'waterfront', 'viewpoint', 'national park', 'nature park', 'central park'])) return false;
  return includesAny(text, STRONG_PATTERNS) || (rating >= 4.4 && reviews >= 75);
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function searchText(query, zone, limit) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.businessStatus,places.photos'
    },
    body: JSON.stringify({
      textQuery: `${query} in ${zone.name}, Mumbai`,
      maxResultCount: limit,
      locationBias: {
        circle: {
          center: { latitude: zone.lat, longitude: zone.lng },
          radius: Math.max(1000, Math.round((zone.radius * 1000) || 2500))
        }
      }
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google searchText failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.places || [];
}

async function main() {
  const options = resolveCliOptions();
  const dbPath = options.dbPath;
  const zoneFilter = options.zone;
  const categoryFilter = options.category;
  const limit = options.limitPerQuery;
  const remote = options.remote;
  const dryRun = options.dryRun;

  if (!zoneFilter && !options.allZones) {
    throw new Error('Refusing to scan every zone implicitly. Pass --zone <name> for one zone, or --all for every zone.');
  }
  if (remote && dryRun) {
    throw new Error('Remote upload requires explicit write mode. Use positional args like: Bandra 8 write remote');
  }
  if (dryRun) {
    console.log('[DRY RUN] No database writes will be made. Add positional arg "write" to insert.');
  }

  const db = new Database(dbPath);
  const zones = db.prepare('SELECT name, center_lat AS lat, center_lng AS lng, radius FROM zones ORDER BY name').all()
    .filter(z => !zoneFilter || z.name.toLowerCase() === zoneFilter.toLowerCase());
  if (zones.length === 0) throw new Error(`No zones matched ${zoneFilter || '(all)'}`);

  const existing = new Set(db.prepare("SELECT id FROM places WHERE source_name = 'GOOGLE'").all().map(r => r.id));
  const placeStmt = db.prepare(`INSERT OR IGNORE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, image_url, last_verified, verified_at, first_seen, business_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'GOOGLE', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'OPERATIONAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  const catStmt = db.prepare('INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)');
  const costStmt = db.prepare(`INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES (?, ?, ?, ?)`);
  const scoreStmt = db.prepare(`INSERT OR REPLACE INTO place_scores (place_id, popularity, budget_friendliness, conversation, group_suitability, date_suitability, friends_suitability, family_suitability, weather_suitability, uniqueness, experience_score, overall)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const sqlLines = [];
  const insertLocal = db.transaction((rows) => {
    for (const row of rows) {
      placeStmt.run(row.place);
      catStmt.run(row.cat);
      costStmt.run(row.cost);
      scoreStmt.run(row.score);
    }
  });

  let fetched = 0;
  let inserted = 0;
  let skippedExisting = 0;
  let skippedWeak = 0;
  const rows = [];

  const querySets = QUERY_SETS.filter(q => !categoryFilter || q.category === categoryFilter.toUpperCase());
  for (const zone of zones) {
    console.log(`\n[ZONE] ${zone.name}`);
    for (const set of querySets) {
      for (const q of set.queries) {
        const places = await searchText(q, zone, limit);
        fetched += places.length;
        for (const p of places) {
          const id = `GOOGLE_${p.id}`;
          if (existing.has(id)) {
            skippedExisting++;
            continue;
          }
          const category = inferCategory(p, set.category);
          const categoryConfig = CATEGORY_CONFIG[category] || set;
          if (!isGoodPlace(p, category)) {
            skippedWeak++;
            continue;
          }

          const lat = p.location.latitude;
          const lng = p.location.longitude;
          const dist = getDistance(zone.lat, zone.lng, lat, lng);
          const maxDistance = zone.radius + 0.5; // allow 0.5km buffer for boundary areas
          if (dist > maxDistance) {
            skippedWeak++;
            continue;
          }

          existing.add(id);
          const name = p.displayName.text;
          const address = p.formattedAddress || '';
          const rating = p.rating || null;
          const reviews = p.userRatingCount || 0;
          const [conversation, budget, experience, date, friends, unique] = categoryScore(category);
          const popularity = rating ? Math.min(1, rating / 5) : 0.7;
          const family = ['MUSEUM', 'ART_GALLERY', 'PARK', 'CAFE', 'RESTAURANT', 'DESSERT'].includes(set.category) ? 0.8 : 0.6;
          const weather = set.category === 'PARK' ? 0.6 : 1.0;
          const overall = (popularity + conversation + experience + unique) / 4;
          const [mandatory, min, max] = categoryConfig.cost;
          const catId = `${id}_${category}`;

          const photoRef = p.photos?.[0]?.name ? p.photos[0].name.split('/photos/')[1] || p.photos[0].name.split('/').pop() : null;
          const imageUrl = photoRef ? `/api/places/photo?ref=${encodeURIComponent(photoRef)}` : null;

          rows.push({
            place: [id, name, address, lat, lng, rating, reviews, p.id, imageUrl],
            cat: [catId, id, category],
            cost: [id, mandatory, min, max],
            score: [id, popularity, budget, conversation, 0.8, date, friends, family, weather, unique, experience, overall],
          });

          sqlLines.push(`INSERT OR IGNORE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, image_url, last_verified, verified_at, first_seen, business_status, created_at, updated_at) VALUES (${sqlString(id)}, ${sqlString(name)}, ${sqlString(address)}, ${lat}, ${lng}, ${rating === null ? 'NULL' : rating}, ${reviews}, 'GOOGLE', ${sqlString(p.id)}, ${sqlString(imageUrl)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'OPERATIONAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
          sqlLines.push(`INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (${sqlString(catId)}, ${sqlString(id)}, ${sqlString(category)});`);
          sqlLines.push(`INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES (${sqlString(id)}, ${mandatory}, ${min}, ${max});`);
          sqlLines.push(`INSERT OR REPLACE INTO place_scores (place_id, popularity, budget_friendliness, conversation, group_suitability, date_suitability, friends_suitability, family_suitability, weather_suitability, uniqueness, experience_score, overall) VALUES (${sqlString(id)}, ${popularity}, ${budget}, ${conversation}, 0.8, ${date}, ${friends}, ${family}, ${weather}, ${unique}, ${experience}, ${overall});`);
          inserted++;
          console.log(`  + ${category}: ${name}`);
        }
      }
    }
  }

  if (!dryRun && rows.length > 0) insertLocal(rows);

  if (!dryRun && remote && sqlLines.length > 0) {
    const sqlPath = path.resolve(__dirname, `missing_hangouts_${Date.now()}.sql`);
    fs.writeFileSync(sqlPath, sqlLines.join('\n'));
    try {
      execSync(`npx wrangler d1 execute hangout-dev --remote --file="${sqlPath}"`, { stdio: 'inherit' });
    } finally {
      try { fs.unlinkSync(sqlPath); } catch {}
    }
  }

  db.close();
  console.log(`\nDone. fetched=${fetched}, inserted=${inserted}, existing=${skippedExisting}, rejected=${skippedWeak}, dryRun=${dryRun}, remote=${remote}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
