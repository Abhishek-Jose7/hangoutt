import stationsData from './stations.json';
import type { Station, LatLng } from '@/types';

export const stations: Station[] = stationsData as Station[];

const BOARDING_BUFFER_MINS = 5;
const MINS_PER_STATION = 2.5;
const UNKNOWN_STATION_FALLBACK = 60;

const LINE_PATHS: string[][] = [
  ['Churchgate', 'Marine Lines', 'Charni Road', 'Grant Road', 'Mumbai Central', 'Mahalaxmi', 'Lower Parel', 'Prabhadevi', 'Dadar', 'Matunga Road', 'Mahim', 'Bandra', 'Khar Road', 'Santacruz', 'Vile Parle', 'Andheri', 'Jogeshwari', 'Ram Mandir', 'Goregaon', 'Malad', 'Kandivali', 'Borivali', 'Dahisar', 'Mira Road', 'Bhayandar', 'Naigaon', 'Vasai Road', 'Nalasopara', 'Virar', 'Vaitarna', 'Saphale', 'Kelve Road', 'Palghar', 'Umroli', 'Boisar', 'Vangaon', 'Dahanu Road'],
  ['CSMT', 'Masjid', 'Sandhurst Road', 'Byculla', 'Chinchpokli', 'Currey Road', 'Parel', 'Dadar', 'Matunga', 'Sion', 'Kurla', 'Vidyavihar', 'Ghatkopar', 'Vikhroli', 'Kanjurmarg', 'Bhandup', 'Nahur', 'Mulund', 'Thane', 'Kalwa', 'Mumbra', 'Diva', 'Kopar', 'Dombivli', 'Thakurli', 'Kalyan'],
  ['Kalyan', 'Shahad', 'Ambivli', 'Titwala', 'Khadavli', 'Vasind', 'Asangaon', 'Atgaon', 'Khardi', 'Kasara'],
  ['Kalyan', 'Vithalwadi', 'Ulhasnagar', 'Ambernath', 'Badlapur', 'Vangani', 'Shelu', 'Neral', 'Bhivpuri Road', 'Karjat'],
  ['Karjat', 'Palasdari', 'Kelavli', 'Dolavli', 'Lowjee', 'Khopoli'],
  ['CSMT', 'Dockyard Road', 'Reay Road', 'Cotton Green', 'Sewri', 'Wadala Road', 'GTB Nagar', 'Chunabhatti', 'Kurla', 'Tilak Nagar', 'Chembur', 'Govandi', 'Mankhurd', 'Vashi', 'Sanpada', 'Juinagar', 'Nerul', 'Seawoods Darave', 'Belapur', 'Kharghar', 'Mansarovar', 'Khandeshwar', 'Panvel'],
  ['Wadala Road', 'Kings Circle', 'Mahim', 'Bandra', 'Khar Road', 'Santacruz', 'Vile Parle', 'Andheri'],
  ['Thane', 'Airoli', 'Rabale', 'Ghansoli', 'Kopar Khairane', 'Turbhe', 'Sanpada', 'Vashi'],
  ['Nerul', 'Seawoods Darave', 'Belapur', 'CBD Belapur', 'Kharkopar'],
];

function buildRailGraph(): Map<string, Map<string, number>> {
  const graph = new Map<string, Map<string, number>>();

  const link = (a: string, b: string, cost = MINS_PER_STATION) => {
    if (!graph.has(a)) graph.set(a, new Map());
    if (!graph.has(b)) graph.set(b, new Map());

    const aEdges = graph.get(a)!;
    const bEdges = graph.get(b)!;

    const ab = aEdges.get(b);
    if (ab === undefined || cost < ab) aEdges.set(b, cost);

    const ba = bEdges.get(a);
    if (ba === undefined || cost < ba) bEdges.set(a, cost);
  };

  for (const path of LINE_PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      link(path[i], path[i + 1]);
    }
  }

  return graph;
}

const railGraph = buildRailGraph();

/**
 * Haversine distance in kilometers
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aCalc =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(aCalc), Math.sqrt(1 - aCalc));
  return R * c;
}

/**
 * Find the nearest station to a given lat/lng
 */
export function findNearestStation(location: LatLng): Station {
  let nearest = stations[0];
  let minDist = Infinity;

  for (const station of stations) {
    const dist = haversineDistance(location, { lat: station.lat, lng: station.lng });
    if (dist < minDist) {
      minDist = dist;
      nearest = station;
    }
  }

  return nearest;
}

function shortestTravelMins(from: string, to: string): number {
  if (from === to) return BOARDING_BUFFER_MINS;
  if (!railGraph.has(from) || !railGraph.has(to)) return UNKNOWN_STATION_FALLBACK;

  const distances = new Map<string, number>();
  const visited = new Set<string>();

  for (const node of railGraph.keys()) {
    distances.set(node, Infinity);
  }
  distances.set(from, 0);

  while (true) {
    let current: string | null = null;
    let currentDist = Infinity;

    for (const [node, dist] of distances.entries()) {
      if (!visited.has(node) && dist < currentDist) {
        current = node;
        currentDist = dist;
      }
    }

    if (current === null) break;
    if (current === to) break;

    visited.add(current);
    const edges = railGraph.get(current);
    if (!edges) continue;

    for (const [neighbor, cost] of edges.entries()) {
      if (visited.has(neighbor)) continue;
      const candidate = currentDist + cost;
      if (candidate < (distances.get(neighbor) ?? Infinity)) {
        distances.set(neighbor, candidate);
      }
    }
  }

  const shortest = distances.get(to);
  if (shortest === undefined || !Number.isFinite(shortest)) {
    return UNKNOWN_STATION_FALLBACK;
  }
  return Math.round((shortest + BOARDING_BUFFER_MINS) * 10) / 10;
}

/**
 * Estimate travel time between two stations (in minutes)
 */
export function estimateTravelTime(fromStation: string, toStation: string): number {
  return shortestTravelMins(fromStation, toStation);
}

/**
 * Get popular hub candidate stations (top area stations)
 */
export function getPopularStations(): Station[] {
  const popular = [
    'Bandra',
    'Andheri',
    'Kurla',
    'Ghatkopar',
    'Dadar',
    'Thane',
    'Chembur',
    'Vashi',
    'Borivali',
    'Malad',
    'Goregaon',
    'Mulund',
    'Parel',
    'Mahalaxmi',
    'Lower Parel',
    'CSMT',
  ];
  return stations.filter((s) => popular.includes(s.name));
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Rank hub stations by travel-time equality and total travel time.
 */
export function findBalancedHubStations(
  memberStations: string[],
  maxCount = 4
): Station[] {
  const fallback = getPopularStations();
  if (!memberStations.length) return fallback.slice(0, maxCount);

  const memberStationData = memberStations
    .map((name) => stations.find((s) => s.name === name))
    .filter((s): s is Station => Boolean(s));
  const memberLines = new Set(memberStationData.flatMap((s) => s.line));

  // West-harbour split groups work best on this cross-line corridor.
  if (memberLines.has('western') && memberLines.has('harbour')) {
    const corridor = ['Bandra', 'Andheri', 'Kurla', 'Ghatkopar']
      .map((name) => stations.find((s) => s.name === name))
      .filter((s): s is Station => Boolean(s));
    if (corridor.length >= maxCount) return corridor.slice(0, maxCount);
  }

  const candidateNames = new Set(getPopularStations().map((s) => s.name));
  ['Bandra', 'Andheri', 'Kurla', 'Ghatkopar', 'Dadar', 'Thane', 'Chembur', 'Vashi'].forEach((name) => {
    candidateNames.add(name);
  });

  const candidates = Array.from(candidateNames)
    .map((name) => stations.find((s) => s.name === name))
    .filter((s): s is Station => Boolean(s));

  const ranked = candidates
    .map((station) => {
      const times = memberStations.map((member) => estimateTravelTime(member, station.name));
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const max = Math.max(...times);
      const min = Math.min(...times);
      const spread = max - min;
      const sigma = stdDev(times);
      const score = spread * 1.9 + sigma * 1.4 + mean * 0.8 + max * 0.35;

      return { station, score, spread, max };
    })
    .sort((a, b) => a.score - b.score);

  const equalityFirst = ranked.filter((r) => r.spread <= 22 && r.max <= 110);
  const chosen = (equalityFirst.length >= maxCount ? equalityFirst : ranked).slice(0, maxCount);

  const preferredOrder = ['Bandra', 'Andheri', 'Kurla', 'Ghatkopar', 'Dadar', 'Thane', 'Chembur', 'Vashi'];

  return chosen
    .sort((a, b) => preferredOrder.indexOf(a.station.name) - preferredOrder.indexOf(b.station.name))
    .map((x) => x.station);
}
