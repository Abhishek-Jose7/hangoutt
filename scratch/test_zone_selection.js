// Test zone selection algorithm

const memberCoords = [
  { lat: 19.0178, lng: 72.8478 }, // Dadar (Ulhasnagar)
  { lat: 19.0178, lng: 72.8478 }, // Dadar (Dahisar)
  { lat: 19.0178, lng: 72.8478 }, // Dadar (borivali)
  { lat: 19.2483, lng: 72.8596 }, // Dahisar
  { lat: 18.9696, lng: 72.8194 }, // Byculla
  { lat: 19.1360, lng: 72.8488 }, // Andheri
  { lat: 19.2483, lng: 72.8596 }, // Dahisar
  { lat: 19.0212, lng: 73.0192 }  // Seawoods
];

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
];

function getHaversineDistance(p1, p2) {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((p1.lat * Math.PI) / 180) * Math.cos((p2.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function selectCandidateZones(memberLocations) {
  const scored = MUMBAI_ZONES.map((zone) => {
    const distances = memberLocations.map((member) => getHaversineDistance(member, zone));
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const stdDev = Math.sqrt(variance);
    const penaltyScore = avgDistance * 0.5 + maxDistance * 0.3 + stdDev * 0.2;
    return { zone, avgDistance, maxDistance, stdDev, penaltyScore };
  });

  scored.sort((a, b) => a.penaltyScore - b.penaltyScore);
  return scored;
}

const scored = selectCandidateZones(memberCoords);
console.log('Top 15 zones by penalty score:');
scored.slice(0, 15).forEach((sz, idx) => {
  console.log(`${idx + 1}. Name: ${sz.zone.name}, Penalty: ${sz.penaltyScore.toFixed(2)}, AvgDist: ${sz.avgDistance.toFixed(2)}, MaxDist: ${sz.maxDistance.toFixed(2)}, StdDev: ${sz.stdDev.toFixed(2)}`);
});
