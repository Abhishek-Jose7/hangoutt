const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(__dirname, '../local.db');
const db = new Database(dbPath);

const MUMBAI_ZONES = db.prepare('SELECT name, center_lat AS lat, center_lng AS lng FROM zones').all();

function getHaversineDistance(p1, p2) {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
      
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getVenueZone(lat, lng, name, address) {
  const addr = (address || '').toLowerCase();
  const n = name.toLowerCase();
  
  const sortedZonesByLength = [...MUMBAI_ZONES].sort((a, b) => b.name.length - a.name.length);
  for (const zone of sortedZonesByLength) {
    const zName = zone.name.toLowerCase();
    if (zName === 'bkc') {
      if (addr.includes('bkc') || addr.includes('bandra kurla complex')) {
        return 'BKC';
      }
    }
    if (addr.includes(zName) || n.includes(zName)) {
      return zone.name;
    }
  }

  let closestZone = MUMBAI_ZONES[0];
  let minDist = Infinity;
  for (const zone of MUMBAI_ZONES) {
    const d = getHaversineDistance({ lat, lng }, { lat: zone.lat, lng: zone.lng });
    if (d < minDist) {
      minDist = d;
      closestZone = zone;
    }
  }
  return closestZone.name;
}

function run() {
  const placesList = db.prepare(`
    SELECT p.id, p.name, p.address, p.lat, p.lng, pc.category
    FROM places p
    JOIN place_categories pc ON p.id = pc.place_id
  `).all();
  
  const counts = {};
  const targetZones = ['Bhandup', 'Vikhroli', 'Mulund', 'Powai'];
  
  targetZones.forEach(z => { counts[z] = {}; });

  placesList.forEach(p => {
    const zoneName = getVenueZone(p.lat, p.lng, p.name, p.address);
    if (targetZones.includes(zoneName)) {
      const cat = p.category;
      counts[zoneName][cat] = (counts[zoneName][cat] || 0) + 1;
    }
  });

  console.log('Categories counts per zone:');
  console.log(JSON.stringify(counts, null, 2));

  db.close();
}

run();
