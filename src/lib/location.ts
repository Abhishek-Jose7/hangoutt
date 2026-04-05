import type { LatLng, HubCandidate, Mood, Station } from '@/types';
import {
  findNearestStation,
  estimateTravelTime,
  findBalancedHubStations,
  getPopularStations,
} from './transit';

/**
 * Cartesian midpoint formula for geographic coordinates
 */
export function calculateMidpoint(locations: LatLng[]): LatLng {
  let x = 0;
  let y = 0;
  let z = 0;

  for (const loc of locations) {
    const latR = (loc.lat * Math.PI) / 180;
    const lngR = (loc.lng * Math.PI) / 180;
    x += Math.cos(latR) * Math.cos(lngR);
    y += Math.cos(latR) * Math.sin(lngR);
    z += Math.sin(latR);
  }

  const n = locations.length || 1;
  x /= n;
  y /= n;
  z /= n;

  const lngOut = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const latOut = Math.atan2(z, hyp);

  return { lat: (latOut * 180) / Math.PI, lng: (lngOut * 180) / Math.PI };
}

/**
 * Calculate travel fairness score
 * 1 = perfectly fair, 0 = very unfair
 */
function fairnessScore(travelTimes: number[]): number {
  if (travelTimes.length === 0) return 1;
  const mean = travelTimes.reduce((a, b) => a + b, 0) / travelTimes.length;
  if (mean === 0) return 1;
  const variance = travelTimes.reduce((sum, t) => sum + (t - mean) ** 2, 0) / travelTimes.length;
  const stdDev = Math.sqrt(variance);
  return Math.max(0, Math.min(1, 1 - stdDev / mean));
}

function normalizeMemberStations(memberLocations: LatLng[], memberStations: string[]): string[] {
  return memberLocations.map((location, idx) => {
    const nearest = findNearestStation(location);
    return nearest?.name || memberStations[idx] || 'Dadar';
  });
}

function buildHubCandidate(
  station: Station,
  strategy: HubCandidate['strategy'],
  memberStations: string[]
): HubCandidate {
  const travelTimes = memberStations.map((memberStation) =>
    estimateTravelTime(memberStation, station.name)
  );

  const maxTravelTime = Math.max(...travelTimes);
  const avgTravelTime = travelTimes.reduce((a, b) => a + b, 0) / travelTimes.length;

  return {
    name: station.name,
    lat: station.lat,
    lng: station.lng,
    station: station.name,
    strategy,
    travelTimes,
    maxTravelTime,
    avgTravelTime,
    fairnessScore: fairnessScore(travelTimes),
  };
}

/**
 * Generate 4 balanced hub candidates with equality-first train travel.
 */
export function generateHubCandidates(
  memberLocations: LatLng[],
  memberStations: string[],
  _mood: Mood
): HubCandidate[] {
  const normalizedStations = normalizeMemberStations(memberLocations, memberStations);
  const balanced = findBalancedHubStations(normalizedStations, 4);

  const stationPool = [...balanced];

  // Keep a geometric fallback in case balancing produces fewer than 4 unique stations.
  const geometricMidpointStation = findNearestStation(calculateMidpoint(memberLocations));
  if (!stationPool.some((s) => s.name === geometricMidpointStation.name)) {
    stationPool.push(geometricMidpointStation);
  }

  for (const station of getPopularStations()) {
    if (stationPool.length >= 4) break;
    if (!stationPool.some((s) => s.name === station.name)) {
      stationPool.push(station);
    }
  }

  const chosen = stationPool.slice(0, 4);
  const strategies: HubCandidate['strategy'][] = [
    'geometric',
    'minimax_transit',
    'min_total_transit',
    'cultural_hub',
  ];

  return chosen.map((station, idx) =>
    buildHubCandidate(station, strategies[idx] || 'cultural_hub', normalizedStations)
  );
}
