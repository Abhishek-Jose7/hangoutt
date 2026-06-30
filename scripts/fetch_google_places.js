const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error("Error: GOOGLE_MAPS_API_KEY environment variable is not set.");
  process.exit(1);
}

const JUNK_KEYWORDS = [
  ' chs', 'chs ', 'c.h.s', 'society', 'apartment', 'apts', 'residency', 'residences',
  'tower', 'villa', 'bungalow', 'chawl', 'building', 'bldg', 'flat', 'house',
  'pvt ltd', 'pvt. ltd', 'limited', 'ltd.', 'corporate', 'office', 'knowledge park',
  'business park', 'refinery', 'station', 'bus stand', 'bus depot', 'bus terminal',
  'railway', 'metro', 'monorail', 'rickshaw', 'auto stand', 'parking', 'highway',
  'flyover', 'bridge', 'gate no', ' gate 1', ' gate 2', 'durga puja', 'canteen', 'mess',
  'rto', 'delivery only', 'cloud kitchen', 'takeaway only', 'goat farm', 'cisf',
  'monginis', 'ribbons & balloons', 'souffle cake', 'cake shop', 'cake counter', 'cake express',
  'al fresco', 'al sadah', 'argent silver', 'arthur road', '90ft balaji'
];

function isJunk(name, address) {
  const n = name.toLowerCase();
  const a = (address || '').toLowerCase();
  
  if (JUNK_KEYWORDS.some(k => n.includes(k) || a.includes(k))) return true;
  
  if (n.includes('plaza') || n.includes('market')) {
    const whitelist = ['cinema', 'theatre', 'multiplex', 'phoenix marketcity', 'jio world plaza', 'palladium', 'mall', 'dosa plaza'];
    if (!whitelist.some(w => n.includes(w))) {
      return true;
    }
  }
  
  if ((n.endsWith(' road') || n.endsWith(' rd') || n.endsWith(' marg') || n.endsWith(' lane') || n.endsWith(' path')) && 
      !n.includes('cafe') && !n.includes('restaurant') && !n.includes('hotel') && !n.includes('diner') && !n.includes('bar') && !n.includes('eats')) {
    return true;
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
        maxResultCount: 6, // Fetch up to 6 places per zone to get a good selection
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
  const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'restaurant';
  const cat = type.toUpperCase() === 'CAFE' ? 'CAFE' : 'RESTAURANT';
  
  const dbPath = path.resolve(__dirname, '../local.db');
  console.log(`Reading zones from local database: ${dbPath}`);
  const localDb = new Database(dbPath);
  const zones = localDb.prepare("SELECT name, center_lat AS lat, center_lng AS lng, radius FROM zones").all();
  localDb.close();
  
  console.log(`Found ${zones.length} zones. Fetching '${type}' venues using Google Places API...`);
  
  const sqlLines = [];
  const insertedIds = new Set();
  const localStatements = [];
  
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    console.log(`[${i + 1}/${zones.length}] Querying zone: ${zone.name}...`);
    
    const places = await fetchNearby(zone.lat, zone.lng, zone.radius, type);
    if (places === null) {
      console.log('Google Places API quota/rate-limit hit. Saving collected places and exiting...');
      break;
    }
    
    let added = 0;
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
      added++;
      
      const rating = p.rating || null;
      const ratingStr = rating !== null ? rating.toFixed(1) : 'NULL';
      const reviewCount = p.userRatingCount || 0;
      
      const popularity = rating !== null ? rating / 5.0 : 0.5;
      const conversationScoreVal = cat === 'CAFE' ? 0.6 : 0.5;
      const experienceScore = 0.8;
      const overall = ((popularity + conversationScoreVal + experienceScore) / 3.0).toFixed(4);
      
      const escName = name.replace(/'/g, "''");
      const escAddr = address.replace(/'/g, "''");
      
      const categoryId = `${id}_${cat}`;
      sqlLines.push(`INSERT OR REPLACE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, business_status) VALUES ('${id}', '${escName}', '${escAddr}', ${placeLat}, ${placeLng}, ${ratingStr}, ${reviewCount}, 'GOOGLE', '${p.id}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 1.0, 'OPERATIONAL');`);
      sqlLines.push(`INSERT OR REPLACE INTO place_categories (id, place_id, category) VALUES ('${categoryId}', '${id}', '${cat}');`);
      
      const costMand = cat === 'CAFE' ? 0 : 0;
      const costMin = cat === 'CAFE' ? 150 : 250;
      const costMax = cat === 'CAFE' ? 450 : 750;
      
      sqlLines.push(`INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES ('${id}', ${costMand}, ${costMin}, ${costMax});`);
      sqlLines.push(`INSERT OR REPLACE INTO place_scores (place_id, popularity, budget_friendliness, overall) VALUES ('${id}', ${popularity}, 0.8, ${overall});`);
      
      localStatements.push({
        place: [id, name, address, placeLat, placeLng, rating, reviewCount, 'GOOGLE', p.id],
        category: [categoryId, id, cat],
        cost: [id, costMand, costMin, costMax],
        score: [id, popularity, 0.8, parseFloat(overall)]
      });
    }
    
    console.log(`  Added ${added} venues for zone ${zone.name}.`);
    
    // Batch write to avoid command size limits
    if ((i > 0 && i % 8 === 0) || i === zones.length - 1) {
      if (sqlLines.length > 0) {
        console.log(`\n--- Uploading batch of ${localStatements.length} places to remote D1 and local.db ---`);
        const tempSqlFile = path.resolve(__dirname, `gmaps_batch_${Date.now()}.sql`);
        fs.writeFileSync(tempSqlFile, sqlLines.join('\n'));
        
        try {
          execSync(`npx wrangler d1 execute hangout-dev --remote --file="${tempSqlFile}"`, { stdio: 'inherit' });
          console.log('  Remote D1 update success!');
        } catch (err) {
          console.error('  Remote D1 update failed:', err.message);
        } finally {
          try { fs.unlinkSync(tempSqlFile); } catch (_) {}
        }
        
        try {
          const writeDb = new Database(dbPath);
          const insertPlace = writeDb.prepare(`INSERT OR REPLACE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, business_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'GOOGLE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 1.0, 'OPERATIONAL')`);
          const insertCategory = writeDb.prepare(`INSERT OR REPLACE INTO place_categories (id, place_id, category) VALUES (?, ?, ?)`);
          const insertCost = writeDb.prepare(`INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES (?, ?, ?, ?)`);
          const insertScore = writeDb.prepare(`INSERT OR REPLACE INTO place_scores (place_id, popularity, budget_friendliness, overall) VALUES (?, ?, ?, ?)`);
          
          writeDb.transaction(() => {
            for (const s of localStatements) {
              insertPlace.run(...s.place);
              insertCategory.run(...s.category);
              insertCost.run(...s.cost);
              insertScore.run(...s.score);
            }
          })();
          writeDb.close();
          console.log('  Local DB update success!');
        } catch (err) {
          console.error('  Local DB update failed:', err.message);
        }
        
        sqlLines.length = 0;
        localStatements.length = 0;
      }
    }
    
    await sleep(400); // 400ms delay between zone queries to stay within request-per-minute limits
  }
  
  console.log('\nGoogle Places fetch complete!');
}

main().catch(console.error);
