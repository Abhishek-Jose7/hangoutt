const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error("Error: GOOGLE_MAPS_API_KEY environment variable is not set.");
  process.exit(1);
}

const DISCOVERY_ZONES = [
  // === South Mumbai ===
  { name: 'Colaba', lat: 18.9219, lng: 72.8319, radius: 2000 },
  { name: 'Fort', lat: 18.9389, lng: 72.8354, radius: 2000 },
  { name: 'Churchgate', lat: 18.9347, lng: 72.8263, radius: 2000 },
  { name: 'Marine Lines', lat: 18.9455, lng: 72.8215, radius: 2000 },
  { name: 'Girgaon', lat: 18.9536, lng: 72.8159, radius: 2000 },
  { name: 'Grant Road', lat: 18.9636, lng: 72.8178, radius: 2000 },
  { name: 'Mumbai Central', lat: 18.9697, lng: 72.8199, radius: 2000 },
  { name: 'Mahalakshmi', lat: 18.9798, lng: 72.8167, radius: 2000 },
  // === Central Mumbai ===
  { name: 'Byculla', lat: 18.9795, lng: 72.8364, radius: 2000 },
  { name: 'Worli', lat: 19.0082, lng: 72.8178, radius: 2500 },
  { name: 'Lower Parel', lat: 18.9996, lng: 72.8283, radius: 2500 },
  { name: 'Prabhadevi', lat: 19.0073, lng: 72.8273, radius: 2000 },
  { name: 'Parel', lat: 19.0016, lng: 72.8429, radius: 2000 },
  { name: 'Dadar', lat: 19.0178, lng: 72.8478, radius: 2500 },
  { name: 'Matunga', lat: 19.0292, lng: 72.8457, radius: 2000 },
  { name: 'Sewri', lat: 19.0089, lng: 72.8600, radius: 2000 },
  { name: 'Wadala', lat: 19.0263, lng: 72.8631, radius: 2000 },
  { name: 'Sion', lat: 19.0453, lng: 72.8695, radius: 2000 },
  // === Western Suburbs ===
  { name: 'Mahim', lat: 19.0411, lng: 72.8380, radius: 2000 },
  { name: 'Bandra', lat: 19.0596, lng: 72.8295, radius: 3000 },
  { name: 'BKC', lat: 19.0660, lng: 72.8668, radius: 2500 },
  { name: 'Khar', lat: 19.0717, lng: 72.8355, radius: 2000 },
  { name: 'Santacruz', lat: 19.0824, lng: 72.8425, radius: 2500 },
  { name: 'Juhu', lat: 19.1075, lng: 72.8263, radius: 2500 },
  { name: 'Vile Parle', lat: 19.0990, lng: 72.8486, radius: 2500 },
  { name: 'Andheri', lat: 19.1136, lng: 72.8697, radius: 3500 },
  { name: 'Versova', lat: 19.1385, lng: 72.8116, radius: 2500 },
  { name: 'Jogeshwari', lat: 19.1346, lng: 72.8456, radius: 2500 },
  { name: 'Goregaon', lat: 19.1544, lng: 72.8482, radius: 3000 },
  { name: 'Malad', lat: 19.1872, lng: 72.8483, radius: 3000 },
  { name: 'Kandivali', lat: 19.2054, lng: 72.8544, radius: 3000 },
  { name: 'Borivali', lat: 19.2290, lng: 72.8570, radius: 3500 },
  { name: 'Dahisar', lat: 19.2618, lng: 72.8595, radius: 3000 },
  // === Eastern Suburbs (Central Line) ===
  { name: 'Kurla', lat: 19.0607, lng: 72.8826, radius: 3000 },
  { name: 'Chunabhatti', lat: 19.0417, lng: 72.8888, radius: 2000 },
  { name: 'Chembur', lat: 19.0622, lng: 72.8999, radius: 2500 },
  { name: 'Ghatkopar', lat: 19.0860, lng: 72.9082, radius: 3000 },
  { name: 'Vikhroli', lat: 19.1048, lng: 72.9297, radius: 2500 },
  { name: 'Powai', lat: 19.1176, lng: 72.9060, radius: 3000 },
  { name: 'Bhandup', lat: 19.1519, lng: 72.9396, radius: 2500 },
  { name: 'Mulund', lat: 19.1724, lng: 72.9596, radius: 3000 },
  { name: 'Thane', lat: 19.2183, lng: 72.9781, radius: 4500 },
  { name: 'Dombivli', lat: 19.2149, lng: 73.0893, radius: 3500 },
  // === Harbour Line / Navi Mumbai ===
  { name: 'Mankhurd', lat: 19.0683, lng: 72.9272, radius: 2500 },
  { name: 'Vashi', lat: 19.0745, lng: 72.9978, radius: 3500 },
  { name: 'Sanpada', lat: 19.0630, lng: 72.9998, radius: 2500 },
  { name: 'Juinagar', lat: 19.0445, lng: 73.0064, radius: 2000 },
  { name: 'Nerul', lat: 19.0341, lng: 73.0198, radius: 2500 },
  { name: 'Seawoods', lat: 19.0212, lng: 73.0192, radius: 2500 },
  { name: 'Belapur', lat: 19.0180, lng: 73.0392, radius: 3000 },
  { name: 'Kharghar', lat: 19.0460, lng: 73.0680, radius: 3000 },
  { name: 'Airoli', lat: 19.1505, lng: 73.0095, radius: 2500 },
  { name: 'Panvel', lat: 18.9894, lng: 73.1175, radius: 4000 },
];

const SEARCH_CATEGORIES = [
  { type: 'cafe', cat: 'CAFE' },
  { type: 'restaurant', cat: 'RESTAURANT' },
  { type: 'amusement_center', cat: 'ARCADE' },
  { type: 'bowling_alley', cat: 'BOWLING' },
  { type: 'museum', cat: 'MUSEUM' },
  { type: 'shopping_mall', cat: 'MALL' },
  { type: 'park', cat: 'PARK' },
  { type: 'bakery', cat: 'DESSERT' },
  { type: 'movie_theater', cat: 'MOVIE' },
  { type: 'stadium', cat: 'SPORTS' },
];

const CONVERSATION_SCORES = {
  POTTERY: 10,
  BOARD_GAMES: 8,
  ESCAPE_ROOM: 8,
  MUSEUM: 7,
  ART_GALLERY: 7,
  CAFE: 6,
  RESTAURANT: 5,
  PARK: 6,
  DESSERT: 5,
  ARCADE: 4,
  BOWLING: 4,
  MOVIE: 4,
  SPORTS: 3,
  MALL: 3,
};

const DEFAULT_COSTS = {
  CAFE: { mand: 0, min: 150, max: 450 },
  RESTAURANT: { mand: 0, min: 250, max: 750 },
  DESSERT: { mand: 0, min: 100, max: 300 },
  ARCADE: { mand: 200, min: 200, max: 600 },
  BOWLING: { mand: 350, min: 0, max: 200 },
  MUSEUM: { mand: 50, min: 0, max: 100 },
  PARK: { mand: 0, min: 0, max: 50 },
  MALL: { mand: 0, min: 0, max: 200 },
  MOVIE: { mand: 250, min: 100, max: 300 },
  SPORTS: { mand: 100, min: 0, max: 200 },
};

const JUNK_KEYWORDS = [
  ' chs', 'chs ', 'c.h.s', 'society', 'apartment', 'apts', 'residency', 'residences',
  'tower', 'villa', 'bungalow', 'chawl', 'building', 'bldg', 'flat', 'house',
  'pvt ltd', 'pvt. ltd', 'limited', 'ltd.', 'corporate', 'office', 'knowledge park',
  'business park', 'refinery', 'station', 'bus stand', 'bus depot', 'bus terminal',
  'railway', 'metro', 'monorail', 'rickshaw', 'auto stand', 'parking', 'highway',
  'flyover', 'bridge', 'gate no', ' gate 1', ' gate 2', 'durga puja', 'canteen', 'mess',
  'rto', 'delivery only', 'cloud kitchen', 'takeaway only', 'goat farm', 'cisf',
  'monginis', 'ribbons & balloons', 'souffle cake', 'cake shop', 'cake counter', 'cake express'
];

function isJunk(name, address) {
  const n = name.toLowerCase();
  const a = (address || '').toLowerCase();
  
  if (JUNK_KEYWORDS.some(k => n.includes(k))) return true;
  
  // Plazas / markets whitelist
  if (n.includes('plaza') || n.includes('market')) {
    const whitelist = ['cinema', 'theatre', 'multiplex', 'phoenix marketcity', 'jio world plaza', 'palladium', 'mall', 'dosa plaza'];
    if (!whitelist.some(w => n.includes(w))) {
      return true;
    }
  }
  
  return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchNearby(lat, lng, radius, type) {
  const url = 'https://places.googleapis.com/v1/places:searchNearby';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types'
      },
      body: JSON.stringify({
        includedTypes: [type],
        maxResultCount: 4, // Top 4 places per category
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radius
          }
        }
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 429 || errText.includes('quota') || errText.includes('rate limit')) {
        console.warn(`Google Places API rate-limited or quota exceeded: ${errText}`);
        return null;
      }
      return [];
    }
    const data = await res.json();
    return data.places || [];
  } catch (err) {
    console.error(`Fetch error for type ${type}:`, err.message);
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const startIdx = args.includes('--start') ? parseInt(args[args.indexOf('--start') + 1] || '0') : 0;
  
  // 1. Hide all old OLA places
  console.log('Hiding all existing OLA places to clean the database...');
  try {
    execSync(`npx wrangler d1 execute hangout-dev --remote --command="UPDATE places SET is_hidden = 1 WHERE source_name = 'OLA';"`, { stdio: 'ignore' });
    const Database = require('better-sqlite3');
    const localDb = new Database(path.resolve(__dirname, '../local.db'));
    localDb.prepare(`UPDATE places SET is_hidden = 1 WHERE source_name = 'OLA'`).run();
    localDb.close();
    console.log('Successfully hid old OLA places.');
  } catch (err) {
    console.warn('Error hiding old OLA places:', err.message);
  }

  const zones = DISCOVERY_ZONES.slice(startIdx);
  console.log(`\nBootstrapping Google Places for ${zones.length} zones starting from index ${startIdx}...`);
  
  const sqlLines = [];
  const insertedIds = new Set();
  const localStatements = [];
  
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const globalIdx = startIdx + i;
    console.log(`[${globalIdx + 1}/${DISCOVERY_ZONES.length}] Querying zone: ${zone.name}...`);
    
    let zonePlaceCount = 0;
    for (const { type, cat } of SEARCH_CATEGORIES) {
      const places = await fetchNearby(zone.lat, zone.lng, zone.radius, type);
      if (places === null) {
        console.log('API limit reached in this window. Proceeding to write collected places...');
        break;
      }
      
      for (const p of places) {
        const id = `GOOGLE_${p.id}`;
        if (insertedIds.has(id)) continue;
        
        const name = p.displayName?.text || 'Unknown';
        const address = p.formattedAddress || '';
        const placeLat = p.location?.latitude;
        const placeLng = p.location?.longitude;
        
        if (!placeLat || !placeLng) continue;
        if (isJunk(name, address)) continue;
        
        insertedIds.add(id);
        zonePlaceCount++;
        
        const rating = p.rating || null;
        const ratingStr = rating !== null ? rating.toFixed(1) : 'NULL';
        const reviewCount = p.userRatingCount || 0;
        
        const popularity = rating !== null ? rating / 5.0 : 0.5;
        const conversationScoreVal = (CONVERSATION_SCORES[cat] || 5) / 10.0;
        const experienceScore = 0.8;
        const overall = ((popularity + conversationScoreVal + experienceScore) / 3.0).toFixed(4);
        
        const escName = name.replace(/'/g, "''");
        const escAddr = address.replace(/'/g, "''");
        
        const categoryId = `${id}_${cat}`;
        sqlLines.push(`INSERT OR REPLACE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, business_status) VALUES ('${id}', '${escName}', '${escAddr}', ${placeLat}, ${placeLng}, ${ratingStr}, ${reviewCount}, 'GOOGLE', '${p.id}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 1.0, 'OPERATIONAL');`);
        sqlLines.push(`INSERT OR REPLACE INTO place_categories (id, place_id, category) VALUES ('${categoryId}', '${id}', '${cat}');`);
        
        const costs = DEFAULT_COSTS[cat] || { mand: 0, min: 0, max: 0 };
        sqlLines.push(`INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES ('${id}', ${costs.mand}, ${costs.min}, ${costs.max});`);
        sqlLines.push(`INSERT OR REPLACE INTO place_scores (place_id, popularity, budget_friendliness, overall) VALUES ('${id}', ${popularity}, 0.8, ${overall});`);
        
        localStatements.push({
          place: [id, name, address, placeLat, placeLng, rating, reviewCount, 'GOOGLE', p.id],
          category: [categoryId, id, cat],
          cost: [id, costs.mand, costs.min, costs.max],
          score: [id, popularity, 0.8, parseFloat(overall)]
        });
      }
      await sleep(350); // Throttle: 350ms sleep between types
    }
    console.log(`  Zone ${zone.name}: Added ${zonePlaceCount} new places. Total collected: ${insertedIds.size}`);
    
    // Write out every 8 zones or at the end of the loop
    if ((i > 0 && i % 8 === 0) || i === zones.length - 1) {
      if (sqlLines.length > 0) {
        console.log(`\n--- Writing batch of ${localStatements.length} Google Places to D1 remote & local.db ---`);
        const tempSqlFile = path.resolve(__dirname, 'google_batch_insert.sql');
        fs.writeFileSync(tempSqlFile, sqlLines.join('\n'));
        
        try {
          const res = execSync(`npx wrangler d1 execute hangout-dev --remote --file="${tempSqlFile}"`, { encoding: 'utf8' });
          console.log(`  Uploaded batch successfully to remote D1.`, res.substring(0, 200));
        } catch (err) {
          console.error(`  D1 upload failed:`, err.message);
          if (err.stdout) console.error('stdout:', err.stdout);
          if (err.stderr) console.error('stderr:', err.stderr);
        } finally {
          try { fs.unlinkSync(tempSqlFile); } catch (_) {}
        }
        
        try {
          const Database = require('better-sqlite3');
          const localDb = new Database(path.resolve(__dirname, '../local.db'));
          
          const insertPlace = localDb.prepare(`INSERT OR REPLACE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, business_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'GOOGLE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 1.0, 'OPERATIONAL')`);
          const insertCategory = localDb.prepare(`INSERT OR REPLACE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`);
          const insertCost = localDb.prepare(`INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES (?, ?, ?, ?)`);
          const insertScore = localDb.prepare(`INSERT OR REPLACE INTO place_scores (place_id, popularity, budget_friendliness, overall) VALUES (?, ?, ?, ?)`);
          
          localDb.transaction(() => {
            for (const s of localStatements) {
              insertPlace.run(...s.place);
              insertCategory.run(...s.category);
              insertCost.run(...s.cost);
              insertScore.run(...s.score);
            }
          })();
          localDb.close();
          console.log(`  Wrote batch successfully to local.db.`);
        } catch (err) {
          console.error(`  Local DB write failed:`, err.message);
        }
        
        // Clear buffers
        sqlLines.length = 0;
        localStatements.length = 0;
      }
    }
    
    await sleep(2000); // 2 seconds between zones
  }
  
  console.log('\nGoogle Places bootstrap complete!');
}

main().catch(console.error);
