const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const samplePlaces = [
  {
    "id": "ChIJ36FUO2rJ5zsR-niSfgBdZzc",
    "displayName": { "text": "Boojee cafe" },
    "formattedAddress": "Sat Kartar building, 16th Rd, Bandra West, Mumbai, Maharashtra 400050, India",
    "location": { "latitude": 19.0670917, "longitude": 72.831001 },
    "rating": 4.4,
    "userRatingCount": 1246,
    "category": "CAFE"
  },
  {
    "id": "ChIJO6enasHJ5zsRO69nxUQXoBE",
    "displayName": { "text": "Benne - Heritage Bangalore Dosa" },
    "formattedAddress": "Shop no. 1, plot 85, TPS 3, louis bell building, 16th Rd, Bandra West, Mumbai, India",
    "location": { "latitude": 19.0625845, "longitude": 72.8308966 },
    "rating": 4.3,
    "userRatingCount": 1742,
    "category": "RESTAURANT"
  }
];

const sqlLines = [];
for (const p of samplePlaces) {
  const id = `GOOGLE_${p.id}`;
  const escName = p.displayName.text.replace(/'/g, "''");
  const escAddr = p.formattedAddress.replace(/'/g, "''");
  const ratingStr = p.rating ? p.rating.toFixed(1) : 'NULL';
  
  sqlLines.push(`INSERT OR REPLACE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, business_status) VALUES ('${id}', '${escName}', '${escAddr}', ${p.location.latitude}, ${p.location.longitude}, ${ratingStr}, ${p.userRatingCount}, 'GOOGLE', '${p.id}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 1.0, 'OPERATIONAL');`);
  sqlLines.push(`INSERT OR REPLACE INTO place_categories (place_id, category) VALUES ('${id}', '${p.category}');`);
  sqlLines.push(`INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES ('${id}', 0, 150, 450);`);
  sqlLines.push(`INSERT OR REPLACE INTO place_scores (place_id, popularity, budget_friendliness, overall) VALUES ('${id}', ${p.rating / 5.0}, 0.8, 0.75);`);
}

const tempSqlFile = path.resolve(__dirname, 'test_batch_upload.sql');
fs.writeFileSync(tempSqlFile, sqlLines.join('\n'));

console.log('Running D1 execute with detailed error tracing...');
try {
  const res = execSync(`npx wrangler d1 execute hangout-dev --remote --file="${tempSqlFile}"`, { encoding: 'utf8' });
  console.log('SUCCESS! Output:\n', res);
} catch (err) {
  console.error('FAILED! Error message:', err.message);
  if (err.stdout) console.error('stdout:', err.stdout);
  if (err.stderr) console.error('stderr:', err.stderr);
} finally {
  try { fs.unlinkSync(tempSqlFile); } catch (_) {}
}
