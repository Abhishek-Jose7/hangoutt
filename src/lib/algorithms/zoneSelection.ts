import 'server-only';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface CandidateZone {
  name: string;
  lat: number;
  lng: number;
}

// Predefined candidate meetup zones for Mumbai, Navi Mumbai, and Thane
const MUMBAI_ZONES: CandidateZone[] = [
  { name: 'Bandra', lat: 19.0596, lng: 72.8295 },
  { name: 'Dadar', lat: 19.0178, lng: 72.8478 },
  { name: 'Kurla', lat: 19.0607, lng: 72.8826 },
  { name: 'Ghatkopar', lat: 19.0860, lng: 72.9082 },
  { name: 'Vashi', lat: 19.0745, lng: 72.9978 },
  { name: 'Andheri', lat: 19.1136, lng: 72.8697 },
  { name: 'Belapur', lat: 19.0180, lng: 73.0392 },
  { name: 'Seawoods', lat: 19.0210, lng: 73.0186 },
  { name: 'Borivali', lat: 19.2290, lng: 72.8570 },
];

// Haversine formula to calculate distance in km between two coordinates
export function getHaversineDistance(p1: LatLng, p2: LatLng): number {
  const R = 6371; // Earth radius in km
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

export function selectCandidateZones(memberLocations: LatLng[]): CandidateZone[] {
  if (memberLocations.length === 0) {
    return MUMBAI_ZONES.slice(0, 4); // Default fallback
  }

  // Force candidate pool to Mumbai
  const candidatePool = MUMBAI_ZONES;
  const byName = (name: string) => candidatePool.find(zone => zone.name === name);

  const latSpread = Math.max(...memberLocations.map(loc => loc.lat)) - Math.min(...memberLocations.map(loc => loc.lat));
  const lngSpread = Math.max(...memberLocations.map(loc => loc.lng)) - Math.min(...memberLocations.map(loc => loc.lng));
  if (latSpread > 0.12 && lngSpread > 0.10) {
    return ['Bandra', 'Dadar', 'Kurla', 'Ghatkopar']
      .map(byName)
      .filter((zone): zone is CandidateZone => Boolean(zone));
  }

  // Score each candidate zone based on distance averages and disparities (fairness)
  const scoredZones = candidatePool.map((zone) => {
    const distances = memberLocations.map((member) => getHaversineDistance(member, zone));
    
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    
    // Standard deviation of distances (Travel fairness metric)
    const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const stdDev = Math.sqrt(variance);

    // Composite travel penalty (lower is better)
    // Minimizes overall distance, caps extreme commute times for any single member, and ensures fairness (stdDev)
    const penaltyScore = avgDistance * 0.5 + maxDistance * 0.3 + stdDev * 0.2;

    return {
      zone,
      avgDistance,
      maxDistance,
      stdDev,
      penaltyScore,
    };
  });

  // Sort by penalty score ascending (most balanced first)
  scoredZones.sort((a, b) => a.penaltyScore - b.penaltyScore);

  // Return the top 3-4 zones (always return 4 if available, otherwise 3)
  const count = Math.min(candidatePool.length, 4);
  return scoredZones.slice(0, count).map((item) => item.zone);
}
