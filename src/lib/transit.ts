import stationsData from './stations.json';
import type { Station, LatLng } from '@/types';

export const stations: Station[] = stationsData as Station[];

// Junction stations where line interchange is possible
const INTERCHANGE_STATIONS: Record<string, string[]> = {
  'Dadar': ['western', 'central'],
  'Kurla': ['central', 'harbour'],
  'CSMT': ['central', 'harbour'],
};

// Major interchange penalty in minutes for cross-line travel
const INTERCHANGE_PENALTY_MINS = 15;
const BOARDING_BUFFER_MINS = 5;
const MINS_PER_STATION = 2.5;

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

/**
 * Get all stations on a given line in order
 */
function getLineStations(line: string): Station[] {
  return stations.filter((s) => s.line.includes(line as 'western' | 'central' | 'harbour'));
}

/**
 * Find common line between two stations, if any
 */
function findCommonLine(a: Station, b: Station): string | null {
  for (const lineA of a.line) {
    if (b.line.includes(lineA)) return lineA;
  }
  return null;
}

/**
 * Estimate travel time between two stations (in minutes)
 * Uses stop-count approximation with interchange penalty
 */
export function estimateTravelTime(fromStation: string, toStation: string): number {
  if (fromStation === toStation) return BOARDING_BUFFER_MINS;

  const from = stations.find((s) => s.name === fromStation);
  const to = stations.find((s) => s.name === toStation);
  if (!from || !to) return 45; // fallback: 45 mins

  // Direct line?
  const commonLine = findCommonLine(from, to);
  if (commonLine) {
    const lineStations = getLineStations(commonLine);
    const fromIdx = lineStations.findIndex((s) => s.name === fromStation);
    const toIdx = lineStations.findIndex((s) => s.name === toStation);
    if (fromIdx === -1 || toIdx === -1) return 45;
    const stopCount = Math.abs(toIdx - fromIdx);
    return stopCount * MINS_PER_STATION + BOARDING_BUFFER_MINS;
  }

  // Need interchange — find best interchange station
  let bestTime = Infinity;

  for (const [interchangeName, lines] of Object.entries(INTERCHANGE_STATIONS)) {
    // Check if from can reach interchange and interchange can reach to
    for (const fromLine of from.line) {
      if (!lines.includes(fromLine)) continue;
      for (const toLine of to.line) {
        if (!lines.includes(toLine)) continue;
        if (fromLine === toLine) continue; // already handled above

        const fromLineStations = getLineStations(fromLine);
        const toLineStations = getLineStations(toLine);

        const fromIdx = fromLineStations.findIndex((s) => s.name === fromStation);
        const interIdx1 = fromLineStations.findIndex((s) => s.name === interchangeName);
        const interIdx2 = toLineStations.findIndex((s) => s.name === interchangeName);
        const toIdx = toLineStations.findIndex((s) => s.name === toStation);

        if (fromIdx === -1 || interIdx1 === -1 || interIdx2 === -1 || toIdx === -1) continue;

        const leg1 = Math.abs(interIdx1 - fromIdx) * MINS_PER_STATION;
        const leg2 = Math.abs(toIdx - interIdx2) * MINS_PER_STATION;
        const totalTime = leg1 + leg2 + INTERCHANGE_PENALTY_MINS + BOARDING_BUFFER_MINS;

        if (totalTime < bestTime) {
          bestTime = totalTime;
        }
      }
    }
  }

  return bestTime === Infinity ? 45 : bestTime;
}

/**
 * Get popular hub candidate stations (top area stations)
 */
export function getPopularStations(): Station[] {
  const popular = [
    'Dadar', 'Bandra', 'Andheri', 'Kurla', 'CSMT', 'Lower Parel',
    'Churchgate', 'Mahalaxmi', 'Goregaon', 'Thane', 'Borivali',
    'Ghatkopar', 'Vile Parle', 'Malad', 'Mulund', 'Sion',
    'Parel', 'Mahim', 'Santacruz', 'Chembur',
  ];
  return stations.filter((s) => popular.includes(s.name));
}
