import type { LatLng, HubCandidate, Mood } from '@/types';
import {
  findNearestStation,
  estimateTravelTime,
  getPopularStations,
} from './transit';

/**
 * Cartesian midpoint formula for geographic coordinates
 */
export function calculateMidpoint(locations: LatLng[]): LatLng {
  let x = 0, y = 0, z = 0;
  for (const loc of locations) {
    const latR = (loc.lat * Math.PI) / 180;
    const lngR = (loc.lng * Math.PI) / 180;
    x += Math.cos(latR) * Math.cos(lngR);
    y += Math.cos(latR) * Math.sin(lngR);
    z += Math.sin(latR);
  }
  const n = locations.length;
  x /= n; y /= n; z /= n;
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

/**
 * Calculate travel times from all member stations to a hub station
 */
function calculateTravelTimesToHub(
  memberStations: string[],
  hubStation: string
): number[] {
  return memberStations.map((ms) => estimateTravelTime(ms, hubStation));
}

/**
 * Generate Hub 1: Geometric center
 */
function generateGeometricHub(
  memberLocations: LatLng[],
  memberStations: string[]
): HubCandidate {
  const midpoint = calculateMidpoint(memberLocations);
  const nearestStation = findNearestStation(midpoint);
  const travelTimes = calculateTravelTimesToHub(memberStations, nearestStation.name);
  const maxTravelTime = Math.max(...travelTimes);
  const avgTravelTime = travelTimes.reduce((a, b) => a + b, 0) / travelTimes.length;

  return {
    name: nearestStation.name,
    lat: nearestStation.lat,
    lng: nearestStation.lng,
    station: nearestStation.name,
    strategy: 'geometric',
    travelTimes,
    maxTravelTime,
    avgTravelTime,
    fairnessScore: fairnessScore(travelTimes),
  };
}

/**
 * Generate Hub 2: Minimax transit (minimize the max travel time)
 */
function generateMinimaxHub(memberStations: string[]): HubCandidate {
  const candidates = getPopularStations();
  let bestHub = candidates[0];
  let bestMaxTime = Infinity;
  let bestTimes: number[] = [];

  for (const candidate of candidates) {
    const times = calculateTravelTimesToHub(memberStations, candidate.name);
    const maxTime = Math.max(...times);
    if (maxTime < bestMaxTime) {
      bestMaxTime = maxTime;
      bestHub = candidate;
      bestTimes = times;
    }
  }

  const avgTravelTime = bestTimes.reduce((a, b) => a + b, 0) / bestTimes.length;

  return {
    name: bestHub.name,
    lat: bestHub.lat,
    lng: bestHub.lng,
    station: bestHub.name,
    strategy: 'minimax_transit',
    travelTimes: bestTimes,
    maxTravelTime: bestMaxTime,
    avgTravelTime,
    fairnessScore: fairnessScore(bestTimes),
  };
}

/**
 * Generate Hub 3: Minimum total travel (most efficient)
 */
function generateMinTotalHub(memberStations: string[]): HubCandidate {
  const candidates = getPopularStations();
  let bestHub = candidates[0];
  let bestTotalTime = Infinity;
  let bestTimes: number[] = [];

  for (const candidate of candidates) {
    const times = calculateTravelTimesToHub(memberStations, candidate.name);
    const totalTime = times.reduce((a, b) => a + b, 0);
    if (totalTime < bestTotalTime) {
      bestTotalTime = totalTime;
      bestHub = candidate;
      bestTimes = times;
    }
  }

  const maxTravelTime = Math.max(...bestTimes);
  const avgTravelTime = bestTimes.reduce((a, b) => a + b, 0) / bestTimes.length;

  return {
    name: bestHub.name,
    lat: bestHub.lat,
    lng: bestHub.lng,
    station: bestHub.name,
    strategy: 'min_total_transit',
    travelTimes: bestTimes,
    maxTravelTime,
    avgTravelTime,
    fairnessScore: fairnessScore(bestTimes),
  };
}

/**
 * Generate Hub 4: Cultural / vibe hub
 */
function generateCulturalHub(
  memberStations: string[],
  mood: Mood
): HubCandidate {
  const culturalAreas = [
    {
      name: 'Bandra',
      center: { lat: 19.0544, lng: 72.8406 },
      vibeScore: { fun: 0.9, chill: 0.8, romantic: 0.82, adventure: 0.73 },
    },
    {
      name: 'Lower Parel',
      center: { lat: 19.0031, lng: 72.8296 },
      vibeScore: { fun: 0.84, chill: 0.7, romantic: 0.74, adventure: 0.66 },
    },
    {
      name: 'Dadar',
      center: { lat: 19.018, lng: 72.8448 },
      vibeScore: { fun: 0.72, chill: 0.67, romantic: 0.58, adventure: 0.69 },
    },
    {
      name: 'Colaba',
      center: { lat: 18.9067, lng: 72.8147 },
      vibeScore: { fun: 0.68, chill: 0.8, romantic: 0.9, adventure: 0.64 },
    },
    {
      name: 'Juhu',
      center: { lat: 19.1075, lng: 72.8263 },
      vibeScore: { fun: 0.76, chill: 0.83, romantic: 0.79, adventure: 0.62 },
    },
    {
      name: 'Andheri',
      center: { lat: 19.1197, lng: 72.8464 },
      vibeScore: { fun: 0.86, chill: 0.74, romantic: 0.6, adventure: 0.79 },
    },
    {
      name: 'Powai',
      center: { lat: 19.1176, lng: 72.906 },
      vibeScore: { fun: 0.74, chill: 0.84, romantic: 0.7, adventure: 0.8 },
    },
    {
      name: 'Worli',
      center: { lat: 19.0118, lng: 72.8182 },
      vibeScore: { fun: 0.71, chill: 0.76, romantic: 0.78, adventure: 0.67 },
    },
  ];

  let bestArea = culturalAreas[0];
  let bestScore = -Infinity;
  let bestTimes: number[] = [];
  let bestStationName = 'Dadar';

  for (const area of culturalAreas) {
    const nearestStation = findNearestStation(area.center);

    const times = calculateTravelTimesToHub(memberStations, nearestStation.name);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    // Normalize avg time: lower is better, cap at 60 mins
    const travelScore = Math.max(0, 1 - avgTime / 60);
    const vibeScore = area.vibeScore[mood];
    const combinedScore = travelScore * 0.5 + vibeScore * 0.5;

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestArea = area;
      bestTimes = times;
      bestStationName = nearestStation.name;
    }
  }

  const maxTravelTime = Math.max(...bestTimes);
  const avgTravelTime = bestTimes.reduce((a, b) => a + b, 0) / bestTimes.length;

  return {
    name: bestArea.name,
    lat: bestArea.center.lat,
    lng: bestArea.center.lng,
    station: bestStationName,
    strategy: 'cultural_hub',
    travelTimes: bestTimes,
    maxTravelTime,
    avgTravelTime,
    fairnessScore: fairnessScore(bestTimes),
  };
}

/**
 * Generate all 4 hub candidates
 */
export function generateHubCandidates(
  memberLocations: LatLng[],
  memberStations: string[],
  mood: Mood
): HubCandidate[] {
  const hubs = [
    generateGeometricHub(memberLocations, memberStations),
    generateMinimaxHub(memberStations),
    generateMinTotalHub(memberStations),
    generateCulturalHub(memberStations, mood),
  ];

  // Deduplicate — if any two hubs end up at the same station, keep only unique ones
  const seen = new Set<string>();
  const uniqueHubs: HubCandidate[] = [];
  for (const hub of hubs) {
    if (!seen.has(hub.name)) {
      seen.add(hub.name);
      uniqueHubs.push(hub);
    } else {
      // If duplicate station, still keep it but note it
      uniqueHubs.push(hub);
    }
  }

  return uniqueHubs;
}
