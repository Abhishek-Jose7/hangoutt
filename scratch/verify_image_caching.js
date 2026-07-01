const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

console.log('Querying database image status...');

// 1. Total places
const totalPlaces = db.prepare('SELECT COUNT(*) as count FROM places').get();
console.log(`Total places in DB: ${totalPlaces.count}`);

// 2. Places with image_url populated
const withImageUrl = db.prepare('SELECT COUNT(*) as count FROM places WHERE image_url IS NOT NULL').get();
console.log(`Places with image_url populated: ${withImageUrl.count}`);

// 3. Places with image_data (cached base64) populated
const withImageData = db.prepare('SELECT COUNT(*) as count FROM places WHERE image_data IS NOT NULL').get();
console.log(`Places with image_data (cached base64) populated: ${withImageData.count}`);

// 4. Sample places with image_url
const samples = db.prepare('SELECT id, name, image_url, image_data IS NOT NULL as has_data FROM places WHERE image_url IS NOT NULL LIMIT 5').all();
console.log('\nSample cached images:');
console.log(samples);

db.close();
