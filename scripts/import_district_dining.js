/*
 * Import fresh Mumbai-region dining venues from District's public sitemap.
 * No Maps API. District pages expose Schema.org Restaurant JSON-LD with
 * current price, address, coordinates, rating, hours, phone, and images.
 *
 * Usage:
 *   node scripts/import_district_dining.js
 *
 * Writes one replayable SQL migration. It never overwrites an existing venue;
 * local.db is updated by the normal Drizzle migration runner afterwards.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'drizzle', 'migrations', '0024_district_web_venues.sql');
const SITEMAP_COUNT = 9;
const MAX_PAGE_FETCHES = 2500;
const CONCURRENCY = 16;

function getBuffer(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Timeout for ${url}`)));
    request.on('error', reject);
  });
}

async function getText(url, timeoutMs = 30000) {
  const body = await getBuffer(url, timeoutMs);
  return body.toString('utf8');
}

async function getGzipText(url) {
  return zlib.gunzipSync(await getBuffer(url)).toString('utf8');
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|cafe|restaurant|and|co|company|mumbai|navi|thane)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function getJsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const graph = Array.isArray(parsed) ? parsed : parsed?.['@graph'] || [parsed];
      const restaurant = graph.find(item => /Restaurant|CafeOrCoffeeShop|FoodEstablishment|LocalBusiness/i.test(String(item?.['@type'] || '')));
      if (restaurant?.name && restaurant?.geo && restaurant?.address) return restaurant;
    } catch {
      // Some pages contain a non-JSON script block. Keep looking.
    }
  }
  return null;
}

function parsePrice(priceRange) {
  const text = String(priceRange || '');
  const hasTwoPersonBasis = /for\s*(two|2)|2\s*people|couple/i.test(text);
  // Remove numeric basis markers before extracting prices, otherwise
  // "₹800 for 2 people" becomes a false ₹1 upper bound.
  const valueText = text.replace(/for\s*(two|2)\s*(people|persons)?|\b2\s*people\b|\bcouple\b/gi, '');
  const values = [...valueText.matchAll(/\d[\d,]*/g)]
    .map(match => Number(match[0].replaceAll(',', '')))
    .filter(value => Number.isFinite(value) && value > 0);
  if (values.length === 0) return null;
  const divisor = hasTwoPersonBasis ? 2 : 1;
  const min = Math.round(values[0] / divisor);
  const max = Math.round((values[1] ?? values[0]) / divisor);
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
    basis: hasTwoPersonBasis ? 'per_head_from_two' : 'source_headline',
  };
}

function categoryFor(venue, url) {
  const text = `${venue.name} ${url} ${(venue.servesCuisine || []).join(' ')}`.toLowerCase();
  if (/ice cream|gelato|dessert|patisserie|sweet shop/.test(text)) return 'DESSERT';
  if (/arcade|gaming|bowling|escape room|trampoline|play zone/.test(text)) return 'ARCADE';
  if (/cafe|coffee|bakery|tea room|bakehouse/.test(text)) return 'CAFE';
  return 'RESTAURANT';
}

function isMumbaiRegion(venue) {
  const lat = numberOrNull(venue?.geo?.latitude);
  const lng = numberOrNull(venue?.geo?.longitude);
  if (lat === null || lng === null) return false;
  return lat >= 18.80 && lat <= 19.40 && lng >= 72.70 && lng <= 73.30;
}

function isStrongVenueUrl(url) {
  return /(?:cafe|coffee|restaurant|bistro|kitchen|lounge|bar|bakery|pizza|brew|diner|grill|rooftop|garden|games|gaming|bowling|arcade|play|escape|karaoke|dessert|ice-cream|sushi|taco|burger|paratha|dhaba|misal|biryani|thali|food)/i.test(url);
}

function parseVenue(venue, url, html) {
  if (!venue || !isMumbaiRegion(venue)) return null;
  if (/temporarily closed|permanently closed|closed for dining/i.test(html.slice(0, 160000))) return null;
  const image = Array.isArray(venue.image) ? venue.image[0] : venue.image;
  const parsedPrice = parsePrice(venue.priceRange);
  const pricePerHead = parsedPrice?.min ?? null;
  const lat = numberOrNull(venue.geo.latitude);
  const lng = numberOrNull(venue.geo.longitude);
  if (!venue.name || !venue.address?.streetAddress || !image || pricePerHead === null || lat === null || lng === null) return null;

  const nameLower = String(venue.name).toLowerCase();
  if (/(dhaba|family restaurant|fast food|food centre|food center|juice centre|juice center|snacks corner|roadside|takeaway only)/i.test(nameLower)) return null;

  const aggregate = venue.aggregateRating || {};
  const rating = numberOrNull(aggregate.ratingValue);
  const reviewCount = Math.max(0, Math.round(numberOrNull(aggregate.ratingCount) || 0));
  const category = categoryFor(venue, url);
  const sourceId = `district_${crypto.createHash('sha1').update(url).digest('hex').slice(0, 20)}`;
  const metadata = JSON.stringify({
    source: 'District',
    priceRange: venue.priceRange,
    priceBasis: parsedPrice?.basis,
    cuisines: venue.servesCuisine || [],
    openingHours: venue.openingHoursSpecification || [],
    amenities: venue.amenityFeature || [],
    sourceUrl: url,
  });

  const popularity = clamp(Math.log10(reviewCount + 10) / 5);
  const quality = rating === null ? 0.68 : clamp(rating / 5);
  const budget = clamp(1 - pricePerHead / 2500);
  const overall = +(0.30 * quality + 0.20 * popularity + 0.20 * budget + 0.15 * 0.82 + 0.15 * 0.72).toFixed(3);

  return {
    id: sourceId,
    name: String(venue.name).trim(),
    address: String(venue.address.streetAddress).trim(),
    lat,
    lng,
    rating,
    reviewCount,
    sourceUrl: url,
    imageUrl: String(image),
    phone: venue.telephone || null,
    openingHoursJson: metadata,
    category,
    pricePerHead,
    optionalCostMax: parsedPrice?.max ?? Math.round(pricePerHead * 1.6),
    scores: {
      popularity: +popularity.toFixed(3),
      budgetFriendliness: +budget.toFixed(3),
      conversation: 0.82,
      groupSuitability: 0.82,
      dateSuitability: 0.72,
      friendsSuitability: 0.86,
      familySuitability: 0.68,
      weatherSuitability: 0.98,
      uniqueness: 0.55,
      experienceScore: 0.62,
      overall,
    },
  };
}

function dedupeVenues(venues, existing) {
  const accepted = [];
  const names = new Set(existing.map(row => normalise(row.name)).filter(Boolean));
  const addressNames = new Set(existing.map(row => `${normalise(row.name)}|${normalise(row.address)}`));
  for (const venue of venues) {
    const name = normalise(venue.name);
    const address = normalise(venue.address);
    if (!name || names.has(name) || addressNames.has(`${name}|${address}`)) continue;
    const nearDuplicate = existing.concat(accepted).some(row => {
      if (haversineKm(row, venue) > 0.08) return false;
      const existingName = normalise(row.name);
      return existingName === name || existingName.includes(name) || name.includes(existingName);
    });
    if (nearDuplicate) continue;
    accepted.push(venue);
    names.add(name);
    addressNames.add(`${name}|${address}`);
  }
  return accepted;
}

function migrationSql(venues) {
  const statements = [
    'ALTER TABLE places ADD COLUMN source_url text;',
    ...venues.map(v => `INSERT OR IGNORE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, business_status, opening_hours_json, phone, image_url, source_url) VALUES (${sqlString(v.id)}, ${sqlString(v.name)}, ${sqlString(v.address)}, ${v.lat}, ${v.lng}, ${v.rating === null ? 'NULL' : v.rating}, ${v.reviewCount}, 'DISTRICT_WEB', ${sqlString(v.sourceUrl)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 1.08, 'OPERATIONAL', ${sqlString(v.openingHoursJson)}, ${sqlString(v.phone)}, ${sqlString(v.imageUrl)}, ${sqlString(v.sourceUrl)});`),
    ...venues.map(v => `INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES (${sqlString(`${v.id}_category`)}, ${sqlString(v.id)}, ${sqlString(v.category)});`),
    ...venues.map(v => `INSERT OR IGNORE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES (${sqlString(v.id)}, 0, ${v.pricePerHead}, ${v.optionalCostMax});`),
    ...venues.map(v => `INSERT OR IGNORE INTO place_scores (place_id, popularity, budget_friendliness, conversation, group_suitability, date_suitability, friends_suitability, family_suitability, weather_suitability, uniqueness, experience_score, overall) VALUES (${sqlString(v.id)}, ${v.scores.popularity}, ${v.scores.budgetFriendliness}, ${v.scores.conversation}, ${v.scores.groupSuitability}, ${v.scores.dateSuitability}, ${v.scores.friendsSuitability}, ${v.scores.familySuitability}, ${v.scores.weatherSuitability}, ${v.scores.uniqueness}, ${v.scores.experienceScore}, ${v.scores.overall});`),
  ];
  return statements.join('\n--> statement-breakpoint\n') + '\n';
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        const value = await fn(items[index], index);
        if (value) out.push(value);
      } catch {
        // Individual pages can disappear; keep import moving.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  const sitemapUrls = Array.from({ length: SITEMAP_COUNT }, (_, index) => `https://www.district.in/dining/search-sitemap/sitemap-restaurant-pages${index + 1}.xml.gz`);
  const sitemapTexts = await Promise.all(sitemapUrls.map(getGzipText));
  const allUrls = sitemapTexts.flatMap(text => [...text.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]));
  const candidates = allUrls
    .filter(url => /^https:\/\/www\.district\.in\/dining\/mumbai\//.test(url) && isStrongVenueUrl(url))
    .sort((a, b) => crypto.createHash('md5').update(a).digest('hex').localeCompare(crypto.createHash('md5').update(b).digest('hex')))
    .slice(0, MAX_PAGE_FETCHES);

  console.log(`District sitemap: ${allUrls.length} URLs; fetching ${candidates.length} high-signal Mumbai-region pages.`);
  const venues = await mapLimit(candidates, CONCURRENCY, async (url, index) => {
    const html = await getText(url);
    const venue = parseVenue(getJsonLd(html), url, html);
    if ((index + 1) % 100 === 0) console.log(`Fetched ${index + 1}/${candidates.length}`);
    return venue;
  });

  const Database = require('better-sqlite3');
  const db = new Database(path.join(ROOT, 'local.db'), { readonly: true });
  const existing = db.prepare('SELECT name, address, lat, lng FROM places').all();
  db.close();

  const fresh = dedupeVenues(venues, existing);
  fs.writeFileSync(OUT, `-- Fresh District web venue import. Source pages checked 2026-09-07.\n-- Generated from public JSON-LD; no Maps API used.\n${migrationSql(fresh)}`);
  console.log(JSON.stringify({ sitemapUrls: allUrls.length, pagesFetched: candidates.length, parsed: venues.length, fresh: fresh.length, output: OUT }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
