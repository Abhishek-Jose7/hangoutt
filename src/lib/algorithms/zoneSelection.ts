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

// Predefined candidate meetup zones for Mumbai and Bengaluru
const MUMBAI_ZONES: CandidateZone[] = [
  { name: 'Dadar', lat: 19.0178, lng: 72.8478 },
  { name: 'Kurla', lat: 19.0607, lng: 72.8826 },
  { name: 'Vashi', lat: 19.0745, lng: 72.9978 },
  { name: 'Ghatkopar', lat: 19.0860, lng: 72.9082 },
  { name: 'Andheri', lat: 19.1136, lng: 72.8697 },
  { name: 'Bandra', lat: 19.0596, lng: 72.8295 },
  { name: 'Belapur', lat: 19.0180, lng: 73.0392 },
];

const BENGALURU_ZONES: CandidateZone[] = [
  { name: 'Koramangala', lat: 12.9348, lng: 77.6189 },
  { name: 'Indiranagar', lat: 12.9719, lng: 77.6412 },
  { name: 'MG Road', lat: 12.9738, lng: 77.6119 },
  { name: 'Jayanagar', lat: 12.9250, lng: 77.5897 },
  { name: 'HSR Layout', lat: 12.9105, lng: 77.6450 },
  { name: 'Whitefield', lat: 12.9698, lng: 77.7499 },
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
    return BENGALURU_ZONES.slice(0, 4); // Default fallback
  }

  // Detect city: Mumbai vs Bengaluru
  const avgLat = memberLocations.reduce((sum, loc) => sum + loc.lat, 0) / memberLocations.length;
  const candidatePool = avgLat > 16.0 ? MUMBAI_ZONES : BENGALURU_ZONES;

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
