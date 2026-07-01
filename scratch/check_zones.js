const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

console.log('--- ZONES ---');
const zones = db.prepare('SELECT id, name, center_lat, center_lng FROM zones').all();
console.log(zones);

console.log('\n--- SAMPLE PLACES FOR A FEW ZONES ---');
for (const zone of zones.slice(0, 5)) {
  console.log(`\nZone: ${zone.name} (${zone.center_lat}, ${zone.center_lng})`);
  // Get places within 1.5km
  const radiusKm = 1.5;
  const latDiff = radiusKm / 111.0;
  const lngDiff = radiusKm / (111.0 * Math.cos(zone.center_lat * Math.PI / 180));
  
  const places = db.prepare(`
    SELECT p.id, p.name, p.address, p.lat, p.lng 
    FROM places p
    WHERE p.lat BETWEEN ? AND ? AND p.lng BETWEEN ? AND ?
    LIMIT 5
  `).all(zone.center_lat - latDiff, zone.center_lat + latDiff, zone.center_lng - lngDiff, zone.center_lng + lngDiff);
  
  console.log(places.map(p => ({ name: p.name, address: p.address })));
}

db.close();
