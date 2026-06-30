const Database = require('better-sqlite3');
const path = require('path');
const { execSync } = require('child_process');

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

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

console.log('Seeding local.db zones...');
try {
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO zones (id, name, center_lat, center_lng, radius)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const zone of DISCOVERY_ZONES) {
      const zoneId = `zone_${zone.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      insertStmt.run(zoneId, zone.name, zone.lat, zone.lng, zone.radius / 1000.0);
    }
  })();
  console.log(`Successfully seeded ${DISCOVERY_ZONES.length} zones locally.`);
} catch (err) {
  console.error('Error seeding local database:', err);
} finally {
  db.close();
}

// Generate D1 insert SQL
console.log('\nGenerating SQL for D1 database...');
const sqlLines = [
  '-- Seed All 53 Zones',
  'INSERT OR REPLACE INTO zones (id, name, center_lat, center_lng, radius) VALUES'
];

for (let i = 0; i < DISCOVERY_ZONES.length; i++) {
  const zone = DISCOVERY_ZONES[i];
  const zoneId = `zone_${zone.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const isLast = i === DISCOVERY_ZONES.length - 1;
  sqlLines.push(`('${zoneId}', '${zone.name}', ${zone.lat}, ${zone.lng}, ${zone.radius / 1000.0})${isLast ? ';' : ','}`);
}

const sqlStr = sqlLines.join('\n');
const tempSqlPath = path.resolve(__dirname, 'seed_zones_d1.sql');
require('fs').writeFileSync(tempSqlPath, sqlStr);

console.log('Executing D1 migration...');
try {
  execSync(`npx wrangler d1 execute hangout-dev --remote --file="${tempSqlPath}"`, { stdio: 'inherit' });
  console.log('Successfully seeded D1 zones.');
} catch (err) {
  console.error('Error executing D1 command:', err.message);
} finally {
  try { require('fs').unlinkSync(tempSqlPath); } catch (_) {}
}
