#!/usr/bin/env node
/**
 * Typesense Venues — Clean Rebuild Pipeline
 * 
 * Step 1: Purge junk activities (bars, gymkhanas, public buildings, cost=4)
 * Step 2: Fix mislabeled entries (bars → restaurant, etc.)
 * Step 3: Seed 80+ real experiential activities (curated + Google Places)
 * Step 4: Validate final state
 *
 * Usage:
 *   node scripts/typesense-rebuild.mjs --dry-run    # preview changes
 *   node scripts/typesense-rebuild.mjs              # execute changes
 *   node scripts/typesense-rebuild.mjs --seed-only  # skip purge, only seed
 *   node scripts/typesense-rebuild.mjs --purge-only # skip seed, only purge
 */

const HOST = process.env.TYPESENSE_HOST;
const API_KEY = process.env.TYPESENSE_ADMIN_API_KEY || process.env.TYPESENSE_API_KEY;
const PROTOCOL = process.env.TYPESENSE_PROTOCOL || 'https';
const PORT = process.env.TYPESENSE_PORT || '443';
const COLLECTION = process.env.TYPESENSE_COLLECTION || 'venues';
const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

if (!HOST || !API_KEY) {
  console.error('Missing TYPESENSE_HOST or TYPESENSE_API_KEY');
  process.exit(1);
}

const BASE = `${PROTOCOL}://${HOST}:${PORT}`;
const DRY_RUN = process.argv.includes('--dry-run');
const SEED_ONLY = process.argv.includes('--seed-only');
const PURGE_ONLY = process.argv.includes('--purge-only');

if (DRY_RUN) console.log('🔍 DRY RUN — no changes will be made\n');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function tsSearch(q, filterBy, perPage = 250, page = 1) {
  const params = new URLSearchParams({
    q, query_by: 'name', per_page: String(perPage), page: String(page),
  });
  if (filterBy) params.set('filter_by', filterBy);
  const res = await fetch(`${BASE}/collections/${COLLECTION}/documents/search?${params}`, {
    headers: { 'X-TYPESENSE-API-KEY': API_KEY },
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function tsDelete(id) {
  if (DRY_RUN) return;
  const res = await fetch(`${BASE}/collections/${COLLECTION}/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-TYPESENSE-API-KEY': API_KEY },
  });
  if (!res.ok && res.status !== 404) {
    console.warn(`  ⚠ Delete failed for ${id}: ${res.status}`);
  }
}

async function tsUpsert(doc) {
  if (DRY_RUN) return;
  const res = await fetch(`${BASE}/collections/${COLLECTION}/documents?action=upsert`, {
    method: 'POST',
    headers: {
      'X-TYPESENSE-API-KEY': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`  ⚠ Upsert failed for ${doc.name}: ${res.status} — ${text.slice(0, 200)}`);
  }
}

async function tsUpdate(id, updates) {
  if (DRY_RUN) return;
  const res = await fetch(`${BASE}/collections/${COLLECTION}/documents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'X-TYPESENSE-API-KEY': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    console.warn(`  ⚠ Update failed for ${id}: ${res.status}`);
  }
}

async function fetchAllByFilter(filterBy) {
  const docs = [];
  let page = 1;
  while (true) {
    const data = await tsSearch('*', filterBy, 250, page);
    const hits = data.hits || [];
    if (!hits.length) break;
    for (const h of hits) if (h.document) docs.push(h.document);
    if (hits.length < 250) break;
    page++;
  }
  return docs;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 1 — PURGE JUNK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const JUNK_NAME_PATTERNS = [
  /\bgymkhana\b/i, /\bsports\s*(association|club|complex|centre|center|academy)\b/i,
  /\bgymnasium\b/i, /\bswimming\s*pool\b/i, /\bcricket\b/i, /\bachilles\b/i,
  /\bwrestling\b/i, /\btalim\b/i, /\bvyayamshala\b/i, /\bakhada\b/i,
  /\bMHB Ground\b/i, /\brecreation\s*ground\b/i, /\bsports\s*ground\b/i,
  /\bplayground\b/i, /\btennis\s*court\b/i, /\bbadminton\b/i,
  /\bMTNL\b/i, /\bCrisil\b/i, /\btowers?\b/i, /\bexchange\b/i,
  /\bCETTM\b/i, /\bpublic\s*building\b/i,
  /\bcybercafe\b/i, /\binternet\s*cafe\b/i,
  /^park\s*\d/i, /^ground\s*\d/i,
];

const JUNK_TAG_PATTERNS = ['sports_centre', 'public_building', 'internet_cafe'];

function isJunkActivity(doc) {
  const name = (doc.name || '').toLowerCase();
  const tags = Array.isArray(doc.tags) ? doc.tags.join(' ').toLowerCase() : (doc.tags || '').toLowerCase();
  const desc = (doc.description || '').toLowerCase();
  const blob = `${name} ${tags} ${desc}`;

  // Bars/pubs mislabeled as activity
  if (tags.includes('bar') || tags.includes('pub')) return 'bar_as_activity';
  if (/\b(bar|pub|taproom|brewery|wine\s*shop|liquor|lounge)\b/.test(name)) return 'bar_as_activity';

  // Sports centres and gymkhanas
  for (const pat of JUNK_NAME_PATTERNS) {
    if (pat.test(blob)) return 'junk_name';
  }
  for (const tag of JUNK_TAG_PATTERNS) {
    if (tags.includes(tag)) return 'junk_tag';
  }

  // Mall without any engagement signal
  if (tags.includes('mall') || /\b(mall|shopping\s*centre|shopping\s*center|plaza)\b/.test(name)) {
    const engagement = /\b(arcade|bowling|escape|gaming|cinema|movie|pvr|inox|timezone|smaaash|trampoline|fun\s*city|food\s*court)\b/i;
    if (!engagement.test(blob)) return 'empty_mall';
  }

  // Fake estimated_cost = 4
  if (doc.estimated_cost === 4) return 'fake_cost';

  return null;
}

function shouldReclassify(doc) {
  const name = (doc.name || '').toLowerCase();
  const tags = Array.isArray(doc.tags) ? doc.tags.join(' ').toLowerCase() : (doc.tags || '').toLowerCase();

  // Bars/pubs → restaurant
  if (tags.includes('bar') || tags.includes('pub') || /\b(bar|pub|taproom|lounge)\b/.test(name)) {
    return 'restaurant';
  }
  return null;
}

async function purgeJunkActivities() {
  console.log('━━━ STEP 1: Purge junk activities ━━━\n');
  
  const activities = await fetchAllByFilter('type:=activity');
  console.log(`Found ${activities.length} activity entries\n`);

  let deleted = 0;
  let reclassified = 0;
  const deleteReasons = {};

  for (const doc of activities) {
    const reason = isJunkActivity(doc);
    if (!reason) continue;

    deleteReasons[reason] = (deleteReasons[reason] || 0) + 1;

    // Some can be reclassified instead of deleted
    const newType = shouldReclassify(doc);
    if (newType && reason === 'bar_as_activity') {
      if (DRY_RUN) {
        console.log(`  🔄 Would reclassify: ${doc.name} → ${newType}`);
      } else {
        await tsUpdate(doc.id, { type: newType });
        console.log(`  🔄 Reclassified: ${doc.name} → ${newType}`);
      }
      reclassified++;
    } else {
      if (DRY_RUN) {
        console.log(`  🗑 Would delete: ${doc.name} (${reason})`);
      } else {
        await tsDelete(doc.id);
        console.log(`  🗑 Deleted: ${doc.name} (${reason})`);
      }
      deleted++;
    }
  }

  console.log(`\nPurge summary:`);
  console.log(`  Deleted: ${deleted}`);
  console.log(`  Reclassified: ${reclassified}`);
  console.log(`  Reasons: ${JSON.stringify(deleteReasons)}`);
  console.log('');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 2 — FIX COSTS across entire collection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function realisticCost(type, name) {
  const n = (name || '').toLowerCase();
  if (type === 'activity') {
    if (/bowling/.test(n)) return 500;
    if (/arcade|gaming|timezone|smaaash|fun\s*city/.test(n)) return 450;
    if (/escape/.test(n)) return 700;
    if (/trampoline|bounce/.test(n)) return 800;
    if (/go.?kart/.test(n)) return 600;
    if (/cinema|pvr|inox|movie|theatre|theater/.test(n)) return 350;
    if (/museum|gallery|fort/.test(n)) return 200;
    if (/snow|water\s*park/.test(n)) return 1000;
    if (/comedy|concert/.test(n)) return 500;
    return 500;
  }
  if (type === 'cafe') {
    if (/starbucks|blue\s*tokai|third\s*wave/.test(n)) return 400;
    if (/chaayos/.test(n)) return 200;
    return 300;
  }
  if (type === 'restaurant') {
    if (/mcdonald|burger\s*king|subway|domino/.test(n)) return 250;
    if (/social|premium|tapas/.test(n)) return 800;
    return 600;
  }
  if (type === 'outdoor') return 100;
  return 400;
}

async function fixBrokenCosts() {
  console.log('━━━ STEP 2: Fix broken cost data ━━━\n');

  // Fix all documents that have estimated_cost <= 10 (clearly wrong)
  const broken = await fetchAllByFilter('estimated_cost:<10');
  console.log(`Found ${broken.length} documents with estimated_cost < 10\n`);

  let fixed = 0;
  for (const doc of broken) {
    const newCost = realisticCost(doc.type, doc.name);
    if (DRY_RUN) {
      console.log(`  💰 Would fix: ${doc.name} (${doc.type}) cost ${doc.estimated_cost} → ${newCost}`);
    } else {
      await tsUpdate(doc.id, { estimated_cost: newCost });
    }
    fixed++;
  }

  console.log(`\nFixed ${fixed} broken cost entries\n`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 3 — SEED REAL ACTIVITIES (curated)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CURATED_ACTIVITIES = [
  // ── Arcades / Gaming Zones ──
  { name: 'Timezone Inorbit Mall Malad', area: 'Malad', lat: 19.1726, lng: 72.8355, tags: ['arcade', 'gaming', 'bowling'], cost: 500, rating: 4.2, pop: 85, mood: ['fun', 'adventure'] },
  { name: 'Timezone R City Mall Ghatkopar', area: 'Ghatkopar', lat: 19.0863, lng: 72.9165, tags: ['arcade', 'gaming', 'bowling'], cost: 500, rating: 4.1, pop: 82, mood: ['fun', 'adventure'] },
  { name: 'Timezone Phoenix Marketcity Kurla', area: 'Kurla', lat: 19.0864, lng: 72.8897, tags: ['arcade', 'gaming'], cost: 500, rating: 4.0, pop: 80, mood: ['fun', 'adventure'] },
  { name: 'Timezone Oberoi Mall Goregaon', area: 'Goregaon', lat: 19.1730, lng: 72.8620, tags: ['arcade', 'gaming'], cost: 500, rating: 4.0, pop: 78, mood: ['fun', 'adventure'] },
  { name: 'Timezone Viviana Mall Thane', area: 'Thane West', lat: 19.2094, lng: 72.9707, tags: ['arcade', 'gaming', 'bowling'], cost: 500, rating: 4.3, pop: 88, mood: ['fun', 'adventure'] },
  { name: 'Smaaash Kamala Mills Lower Parel', area: 'Lower Parel', lat: 19.0048, lng: 72.8264, tags: ['arcade', 'bowling', 'gaming', 'vr'], cost: 800, rating: 4.1, pop: 88, mood: ['fun', 'adventure'] },
  { name: 'Smaaash BKC', area: 'Bandra East', lat: 19.0662, lng: 72.8654, tags: ['arcade', 'bowling', 'gaming'], cost: 800, rating: 4.0, pop: 82, mood: ['fun', 'adventure'] },
  { name: 'Game Palacio High Street Phoenix', area: 'Lower Parel', lat: 18.9949, lng: 72.8245, tags: ['bowling', 'arcade', 'gaming'], cost: 900, rating: 4.2, pop: 86, mood: ['fun', 'adventure'] },
  { name: 'Fun City Growels 101 Kandivali', area: 'Kandivali', lat: 19.2048, lng: 72.8522, tags: ['arcade', 'gaming'], cost: 400, rating: 3.9, pop: 72, mood: ['fun'] },
  { name: 'Fun City Viviana Mall Thane', area: 'Thane West', lat: 19.2094, lng: 72.9707, tags: ['arcade', 'gaming'], cost: 400, rating: 4.0, pop: 75, mood: ['fun'] },
  { name: 'Amoeba Andheri', area: 'Andheri West', lat: 19.1344, lng: 72.8289, tags: ['gaming', 'sports_bar', 'bowling'], cost: 700, rating: 4.1, pop: 80, mood: ['fun', 'adventure'] },
  { name: 'Funcity Inorbit Mall Vashi', area: 'Vashi', lat: 19.0660, lng: 73.0013, tags: ['arcade', 'gaming'], cost: 400, rating: 3.9, pop: 70, mood: ['fun'] },
  { name: 'Play Arena Malad', area: 'Malad', lat: 19.1870, lng: 72.8490, tags: ['gaming', 'vr', 'arcade'], cost: 600, rating: 4.0, pop: 74, mood: ['fun', 'adventure'] },

  // ── Escape Rooms ──
  { name: 'Mystery Rooms Andheri', area: 'Andheri West', lat: 19.1352, lng: 72.8324, tags: ['escape_room'], cost: 800, rating: 4.5, pop: 90, mood: ['fun', 'adventure'] },
  { name: 'Mystery Rooms Bandra', area: 'Bandra West', lat: 19.0590, lng: 72.8340, tags: ['escape_room'], cost: 800, rating: 4.4, pop: 88, mood: ['fun', 'adventure'] },
  { name: 'Mystery Rooms Lower Parel', area: 'Lower Parel', lat: 19.0030, lng: 72.8270, tags: ['escape_room'], cost: 850, rating: 4.3, pop: 85, mood: ['fun', 'adventure'] },
  { name: 'Breakout Escape Room Bandra', area: 'Bandra West', lat: 19.0621, lng: 72.8348, tags: ['escape_room'], cost: 900, rating: 4.4, pop: 87, mood: ['fun', 'adventure'] },
  { name: 'Breakout Escape Room Andheri', area: 'Andheri West', lat: 19.1315, lng: 72.8290, tags: ['escape_room'], cost: 900, rating: 4.3, pop: 84, mood: ['fun', 'adventure'] },
  { name: 'Lock N Escape Thane', area: 'Thane West', lat: 19.1960, lng: 72.9630, tags: ['escape_room'], cost: 750, rating: 4.2, pop: 80, mood: ['fun', 'adventure'] },
  { name: 'Escape Room Mumbai Borivali', area: 'Borivali', lat: 19.2291, lng: 72.8574, tags: ['escape_room'], cost: 700, rating: 4.0, pop: 72, mood: ['fun', 'adventure'] },
  { name: 'Clue Hunt Andheri', area: 'Andheri West', lat: 19.1260, lng: 72.8350, tags: ['escape_room'], cost: 800, rating: 4.3, pop: 82, mood: ['fun', 'adventure'] },

  // ── Trampoline / Bounce ──
  { name: 'Bounce Infinity Mall Malad', area: 'Malad', lat: 19.1845, lng: 72.8349, tags: ['trampoline', 'bounce'], cost: 1000, rating: 4.3, pop: 92, mood: ['fun', 'adventure'] },
  { name: 'SkyJumper Trampoline Park Kalyan', area: 'Kalyan', lat: 19.2437, lng: 73.1355, tags: ['trampoline'], cost: 800, rating: 4.1, pop: 78, mood: ['fun', 'adventure'] },
  { name: 'Bounce Bandra', area: 'Bandra West', lat: 19.0570, lng: 72.8350, tags: ['trampoline', 'bounce'], cost: 1000, rating: 4.2, pop: 88, mood: ['fun', 'adventure'] },

  // ── Go Karting ──
  { name: 'Hakone Entertainment Centre Powai', area: 'Powai', lat: 19.1187, lng: 72.9103, tags: ['go_kart', 'gaming'], cost: 700, rating: 4.0, pop: 82, mood: ['fun', 'adventure'] },
  { name: 'EKart Bandra Kurla Complex', area: 'BKC', lat: 19.0650, lng: 72.8680, tags: ['go_kart'], cost: 600, rating: 3.9, pop: 74, mood: ['fun', 'adventure'] },

  // ── Cinema (reliable fallback) ──
  { name: 'PVR Icon Phoenix Palladium', area: 'Lower Parel', lat: 18.9945, lng: 72.8252, tags: ['cinema', 'movie'], cost: 400, rating: 4.3, pop: 90, mood: ['fun', 'chill', 'romantic'] },
  { name: 'PVR Juhu', area: 'Juhu', lat: 19.1035, lng: 72.8290, tags: ['cinema', 'movie'], cost: 350, rating: 4.1, pop: 82, mood: ['fun', 'chill', 'romantic'] },
  { name: 'INOX R City Mall Ghatkopar', area: 'Ghatkopar', lat: 19.0863, lng: 72.9165, tags: ['cinema', 'movie'], cost: 350, rating: 4.2, pop: 84, mood: ['fun', 'chill', 'romantic'] },
  { name: 'PVR Phoenix Marketcity Kurla', area: 'Kurla', lat: 19.0864, lng: 72.8897, tags: ['cinema', 'movie'], cost: 350, rating: 4.1, pop: 82, mood: ['fun', 'chill', 'romantic'] },
  { name: 'INOX Inorbit Mall Malad', area: 'Malad', lat: 19.1726, lng: 72.8355, tags: ['cinema', 'movie'], cost: 300, rating: 4.0, pop: 78, mood: ['fun', 'chill'] },
  { name: 'Cinepolis Viviana Mall Thane', area: 'Thane West', lat: 19.2094, lng: 72.9707, tags: ['cinema', 'movie'], cost: 300, rating: 4.2, pop: 80, mood: ['fun', 'chill', 'romantic'] },
  { name: 'PVR Oberoi Mall Goregaon', area: 'Goregaon', lat: 19.1730, lng: 72.8620, tags: ['cinema', 'movie'], cost: 300, rating: 4.0, pop: 76, mood: ['fun', 'chill'] },
  { name: 'INOX Nakshatra Mall Dadar', area: 'Dadar', lat: 19.0171, lng: 72.8450, tags: ['cinema', 'movie'], cost: 300, rating: 4.0, pop: 74, mood: ['fun', 'chill'] },

  // ── Snow / Water / Theme ──
  { name: 'Snow World Phoenix Marketcity Kurla', area: 'Kurla', lat: 19.0864, lng: 72.8897, tags: ['snow', 'theme_park'], cost: 1000, rating: 3.9, pop: 76, mood: ['fun', 'adventure'] },
  { name: 'Adlabs Imagica Khopoli', area: 'Khopoli', lat: 18.7965, lng: 73.2880, tags: ['theme_park', 'water_park'], cost: 1500, rating: 4.0, pop: 85, mood: ['fun', 'adventure'] },
  { name: 'EsselWorld Gorai', area: 'Borivali', lat: 19.2350, lng: 72.7990, tags: ['theme_park', 'water_park'], cost: 1200, rating: 3.8, pop: 80, mood: ['fun', 'adventure'] },

  // ── Comedy / Live Events ──
  { name: 'Canvas Laugh Club Lower Parel', area: 'Lower Parel', lat: 19.0010, lng: 72.8290, tags: ['comedy', 'live_show'], cost: 500, rating: 4.4, pop: 88, mood: ['fun', 'chill'] },
  { name: 'The Habitat Khar', area: 'Khar', lat: 19.0710, lng: 72.8360, tags: ['comedy', 'live_show', 'music'], cost: 600, rating: 4.3, pop: 86, mood: ['fun', 'chill'] },
  { name: 'NCPA Nariman Point', area: 'Nariman Point', lat: 18.9269, lng: 72.8193, tags: ['music', 'live_show', 'theatre'], cost: 500, rating: 4.5, pop: 90, mood: ['chill', 'romantic'] },
  { name: 'Prithvi Theatre Juhu', area: 'Juhu', lat: 19.1087, lng: 72.8266, tags: ['theatre', 'live_show'], cost: 300, rating: 4.5, pop: 92, mood: ['chill', 'romantic', 'fun'] },

  // ── Board Game Cafes / Niche ──
  { name: 'Board Game Bash Andheri', area: 'Andheri West', lat: 19.1290, lng: 72.8340, tags: ['board_game', 'gaming', 'cafe'], cost: 400, rating: 4.2, pop: 78, mood: ['fun', 'chill'] },
  { name: 'Creeda Bandra', area: 'Bandra West', lat: 19.0610, lng: 72.8340, tags: ['board_game', 'gaming'], cost: 500, rating: 4.3, pop: 80, mood: ['fun', 'chill'] },
  { name: 'Chaos Andheri', area: 'Andheri West', lat: 19.1350, lng: 72.8270, tags: ['pub', 'gaming', 'sports_bar'], cost: 700, rating: 4.1, pop: 80, mood: ['fun'] },

  // ── VR / Laser Tag ──
  { name: 'VR World Juhu', area: 'Juhu', lat: 19.1040, lng: 72.8280, tags: ['vr', 'gaming'], cost: 600, rating: 4.0, pop: 72, mood: ['fun', 'adventure'] },
  { name: 'Laser Tag Zone Andheri', area: 'Andheri West', lat: 19.1340, lng: 72.8310, tags: ['laser_tag', 'gaming'], cost: 500, rating: 4.0, pop: 70, mood: ['fun', 'adventure'] },

  // ── Museums / Cultural (quality outdoor-activity hybrid) ──
  { name: 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya', area: 'Fort', lat: 18.9268, lng: 72.8326, tags: ['museum'], cost: 200, rating: 4.5, pop: 92, mood: ['chill', 'romantic'] },
  { name: 'Dr Bhau Daji Lad Museum', area: 'Byculla', lat: 18.9784, lng: 72.8347, tags: ['museum'], cost: 150, rating: 4.4, pop: 82, mood: ['chill', 'romantic'] },
  { name: 'Nehru Science Centre Worli', area: 'Worli', lat: 19.0180, lng: 72.8215, tags: ['museum', 'science'], cost: 200, rating: 4.2, pop: 78, mood: ['fun', 'chill'] },
  { name: 'Kala Ghoda Art Precinct', area: 'Fort', lat: 18.9322, lng: 72.8327, tags: ['gallery', 'art'], cost: 200, rating: 4.3, pop: 85, mood: ['chill', 'romantic'] },
  { name: 'NGMA Mumbai', area: 'Fort', lat: 18.9306, lng: 72.8308, tags: ['gallery', 'art', 'museum'], cost: 150, rating: 4.2, pop: 74, mood: ['chill', 'romantic'] },

  // ── Paintball / Adventure ──
  { name: 'Delta Force Paintball Panvel', area: 'Panvel', lat: 18.9940, lng: 73.1190, tags: ['paintball', 'adventure'], cost: 1000, rating: 4.1, pop: 74, mood: ['adventure', 'fun'] },
  { name: 'Della Adventure Lonavala', area: 'Lonavala', lat: 18.7540, lng: 73.4080, tags: ['adventure', 'zip_line', 'paintball'], cost: 1500, rating: 4.3, pop: 85, mood: ['adventure', 'fun'] },
];

function buildTypesenseDoc(entry) {
  return {
    id: `curated_${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60)}`,
    name: entry.name,
    type: 'activity',
    description: `${entry.tags.join(', ')} in ${entry.area}. Popular hangout activity for groups.`,
    tags: entry.tags,
    area: entry.area,
    mood: entry.mood,
    lat: entry.lat,
    lng: entry.lng,
    estimated_cost: entry.cost,
    rating: entry.rating,
    popularity: entry.pop,
    url: `https://www.google.com/maps/search/?api=1&query=${entry.lat}%2C${entry.lng}%20(${encodeURIComponent(entry.name)})`,
  };
}

async function seedCuratedActivities() {
  console.log('━━━ STEP 3: Seed curated activities ━━━\n');
  console.log(`Seeding ${CURATED_ACTIVITIES.length} curated venues...\n`);

  let inserted = 0;
  for (const entry of CURATED_ACTIVITIES) {
    const doc = buildTypesenseDoc(entry);
    if (DRY_RUN) {
      console.log(`  ➕ Would upsert: ${doc.name} (${entry.area}) — ₹${entry.cost} — tags: ${entry.tags.join(', ')}`);
    } else {
      await tsUpsert(doc);
      console.log(`  ➕ Upserted: ${doc.name}`);
    }
    inserted++;
  }

  console.log(`\nSeeded ${inserted} curated activities\n`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 3b — Google Places live fetch (if API key available)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ACTIVITY_QUERIES = [
  'arcade gaming zone',
  'bowling alley',
  'escape room',
  'trampoline park',
  'vr gaming zone',
  'go karting',
  'laser tag',
  'board game cafe',
];

const MUMBAI_AREAS = [
  'Malad Mumbai', 'Andheri Mumbai', 'Bandra Mumbai', 'Lower Parel Mumbai',
  'Borivali Mumbai', 'Thane Mumbai', 'Powai Mumbai', 'Ghatkopar Mumbai',
  'Kurla Mumbai', 'Goregaon Mumbai', 'Vashi Navi Mumbai', 'Dadar Mumbai',
];

function extractTags(name) {
  const n = name.toLowerCase();
  const tags = [];
  if (/arcade|gaming/.test(n)) tags.push('arcade', 'gaming');
  if (/bowling/.test(n)) tags.push('bowling');
  if (/escape/.test(n)) tags.push('escape_room');
  if (/trampoline|bounce|sky.?jump/.test(n)) tags.push('trampoline');
  if (/vr|virtual\s*reality/.test(n)) tags.push('vr');
  if (/go.?kart/.test(n)) tags.push('go_kart');
  if (/laser/.test(n)) tags.push('laser_tag');
  if (/board\s*game/.test(n)) tags.push('board_game');
  if (/cinema|pvr|inox|movie/.test(n)) tags.push('cinema');
  if (/comedy/.test(n)) tags.push('comedy');
  if (tags.length === 0) tags.push('activity');
  return tags;
}

function estimateCostFromName(name) {
  const n = name.toLowerCase();
  if (/bowling/.test(n)) return 500;
  if (/arcade|gaming|timezone|smaaash/.test(n)) return 450;
  if (/escape/.test(n)) return 700;
  if (/trampoline|bounce/.test(n)) return 800;
  if (/go.?kart/.test(n)) return 600;
  if (/laser/.test(n)) return 500;
  if (/vr/.test(n)) return 500;
  return 500;
}

async function fetchGooglePlaces(query, location) {
  if (!GOOGLE_KEY || GOOGLE_KEY === 'placeholder') return [];
  
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + location)}&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

async function seedFromGooglePlaces() {
  if (!GOOGLE_KEY || GOOGLE_KEY === 'placeholder') {
    console.log('━━━ STEP 3b: Google Places — SKIPPED (no API key) ━━━');
    console.log('  Set GOOGLE_PLACES_KEY in .env.local to enable live fetch\n');
    return;
  }

  console.log('━━━ STEP 3b: Fetching from Google Places API ━━━\n');

  const seen = new Set();
  let fetched = 0;

  for (const area of MUMBAI_AREAS) {
    for (const query of ACTIVITY_QUERIES) {
      const results = await fetchGooglePlaces(query, area);
      
      for (const r of results) {
        if (!r.name || !r.geometry?.location) continue;
        if (r.user_ratings_total < 50) continue; // too few reviews = obscure
        if (r.rating && r.rating < 3.8) continue; // bad rating

        const key = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seen.has(key)) continue;
        seen.add(key);

        const tags = extractTags(r.name);
        const doc = {
          id: `gp_${r.place_id}`,
          name: r.name,
          type: 'activity',
          description: `${tags.join(', ')} in ${area.replace(' Mumbai', '').replace(' Navi Mumbai', '')}. Rated ${r.rating}/5.`,
          tags,
          area: area.replace(' Mumbai', '').replace(' Navi Mumbai', ''),
          mood: ['fun', 'adventure'],
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          estimated_cost: estimateCostFromName(r.name),
          rating: r.rating || 3.5,
          popularity: Math.round((r.rating || 3.5) * Math.log10((r.user_ratings_total || 100) + 1) * 10),
          url: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`,
        };

        if (DRY_RUN) {
          console.log(`  ➕ Would upsert: ${doc.name} (${doc.area}) — ${r.rating}⭐ ${r.user_ratings_total} reviews`);
        } else {
          await tsUpsert(doc);
          console.log(`  ➕ Upserted: ${doc.name}`);
        }
        fetched++;
      }

      // Rate limit: Google Places allows 10 QPS
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\nFetched & stored ${fetched} places from Google\n`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 4 — VALIDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function validateFinalState() {
  console.log('━━━ STEP 4: Final validation ━━━\n');

  // Fetch counts by type
  const types = ['activity', 'cafe', 'restaurant', 'outdoor'];
  for (const type of types) {
    const data = await tsSearch('*', `type:=${type}`, 1);
    console.log(`  ${type}: ${data.found ?? '?'} documents`);
  }

  // Check strong activities
  const activities = await fetchAllByFilter('type:=activity');
  const strongKeywords = ['bowling', 'arcade', 'escape', 'trampoline', 'gaming',
    'timezone', 'smaaash', 'bounce', 'mystery', 'breakout', 'go kart', 'laser',
    'vr', 'comedy', 'cinema', 'pvr', 'inox', 'paintball', 'museum', 'gallery'];

  const strong = activities.filter((doc) => {
    const blob = `${doc.name} ${(doc.tags || []).join(' ')}`.toLowerCase();
    return strongKeywords.some((kw) => blob.includes(kw));
  });

  console.log(`\n  Strong experiential activities: ${strong.length} / ${activities.length}`);

  // Check for remaining junk
  let junkRemaining = 0;
  for (const doc of activities) {
    if (isJunkActivity(doc)) junkRemaining++;
  }
  console.log(`  Remaining junk activities: ${junkRemaining}`);

  // Cost sanity
  const badCost = activities.filter((d) => !d.estimated_cost || d.estimated_cost < 50);
  console.log(`  Activities with bad/missing cost: ${badCost.length}`);

  // Area coverage for activities
  const byArea = {};
  for (const doc of activities) {
    const a = doc.area || '(unknown)';
    byArea[a] = (byArea[a] || 0) + 1;
  }
  console.log('\n  Activity coverage by area:');
  for (const [area, count] of Object.entries(byArea).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`    ${area}: ${count}`);
  }

  console.log('');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Typesense Venues — Clean Rebuild Pipeline`);
  console.log(`  ${BASE}/collections/${COLLECTION}`);
  console.log(`  ${DRY_RUN ? '🔍 DRY RUN MODE' : '🔥 LIVE MODE'}`);
  console.log(`${'═'.repeat(60)}\n`);

  if (!PURGE_ONLY && !SEED_ONLY) {
    await purgeJunkActivities();
    await fixBrokenCosts();
    await seedCuratedActivities();
    await seedFromGooglePlaces();
    await validateFinalState();
  } else if (PURGE_ONLY) {
    await purgeJunkActivities();
    await fixBrokenCosts();
    await validateFinalState();
  } else if (SEED_ONLY) {
    await seedCuratedActivities();
    await seedFromGooglePlaces();
    await validateFinalState();
  }

  console.log(DRY_RUN ? '🔍 Dry run complete — no changes were made.\n' : '✅ Rebuild complete.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
