const path = require('path');
const Database = require('better-sqlite3');

const MUMBAI_ZONES = [
  { name: 'Colaba', lat: 18.9219, lng: 72.8319 },
  { name: 'Fort', lat: 18.9389, lng: 72.8354 },
  { name: 'Churchgate', lat: 18.9347, lng: 72.8263 },
  { name: 'Marine Lines', lat: 18.9455, lng: 72.8215 },
  { name: 'Mahalakshmi', lat: 18.9798, lng: 72.8167 },
  { name: 'Worli', lat: 19.0082, lng: 72.8178 },
  { name: 'Lower Parel', lat: 18.9996, lng: 72.8283 },
  { name: 'Prabhadevi', lat: 19.0073, lng: 72.8273 },
  { name: 'Dadar', lat: 19.0178, lng: 72.8478 },
  { name: 'Matunga', lat: 19.0292, lng: 72.8457 },
  { name: 'Sewri', lat: 19.0089, lng: 72.8600 },
  { name: 'Wadala', lat: 19.0263, lng: 72.8631 },
  { name: 'Sion', lat: 19.0453, lng: 72.8695 },
  { name: 'Mahim', lat: 19.0411, lng: 72.8380 },
  { name: 'Bandra', lat: 19.0596, lng: 72.8295 },
  { name: 'BKC', lat: 19.0660, lng: 72.8668 },
  { name: 'Khar', lat: 19.0717, lng: 72.8355 },
  { name: 'Santacruz', lat: 19.0824, lng: 72.8425 },
  { name: 'Juhu', lat: 19.1075, lng: 72.8263 },
  { name: 'Vile Parle', lat: 19.0990, lng: 72.8486 },
  { name: 'Andheri', lat: 19.1136, lng: 72.8697 },
  { name: 'Versova', lat: 19.1385, lng: 72.8116 },
  { name: 'Jogeshwari', lat: 19.1346, lng: 72.8456 },
  { name: 'Goregaon', lat: 19.1544, lng: 72.8482 },
  { name: 'Malad', lat: 19.1872, lng: 72.8483 },
  { name: 'Kandivali', lat: 19.2054, lng: 72.8544 },
  { name: 'Borivali', lat: 19.2290, lng: 72.8570 },
  { name: 'Dahisar', lat: 19.2618, lng: 72.8595 },
  { name: 'Kurla', lat: 19.0607, lng: 72.8826 },
  { name: 'Chunabhatti', lat: 19.0417, lng: 72.8888 },
  { name: 'Chembur', lat: 19.0622, lng: 72.8999 },
  { name: 'Ghatkopar', lat: 19.0860, lng: 72.9082 },
  { name: 'Vikhroli', lat: 19.1048, lng: 72.9297 },
  { name: 'Powai', lat: 19.1176, lng: 72.9060 },
  { name: 'Bhandup', lat: 19.1519, lng: 72.9396 },
  { name: 'Mulund', lat: 19.1724, lng: 72.9596 },
  { name: 'Thane', lat: 19.2183, lng: 72.9781 },
  { name: 'Dombivli', lat: 19.2149, lng: 73.0893 },
  { name: 'Mankhurd', lat: 19.0683, lng: 72.9272 },
  { name: 'Vashi', lat: 19.0745, lng: 72.9978 },
  { name: 'Sanpada', lat: 19.0630, lng: 72.9998 },
  { name: 'Nerul', lat: 19.0341, lng: 73.0198 },
  { name: 'Seawoods', lat: 19.0212, lng: 73.0186 },
  { name: 'Belapur', lat: 19.0180, lng: 73.0392 },
  { name: 'Kharghar', lat: 19.0460, lng: 73.0680 },
  { name: 'Airoli', lat: 19.1505, lng: 73.0095 },
  { name: 'Panvel', lat: 18.9894, lng: 73.1175 },
];

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
  const dbPath = path.resolve(__dirname, '../local.db');
  const db = new Database(dbPath);

  const placesList = db.prepare("SELECT id, name, address, lat, lng FROM places").all();
  
  const counts = {};
  MUMBAI_ZONES.forEach(z => { counts[z.name] = 0; });

  placesList.forEach(p => {
    const zoneName = getVenueZone(p.lat, p.lng, p.name, p.address);
    if (counts[zoneName] !== undefined) {
      counts[zoneName]++;
    } else {
      counts[zoneName] = 1;
    }
  });

  console.log('Venue counts per zone:');
  Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(zone => {
    console.log(`- ${zone}: ${counts[zone]}`);
  });

  db.close();
}

run();
