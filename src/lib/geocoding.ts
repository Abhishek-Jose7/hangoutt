import type { LatLng } from '@/types';
import { cacheGet, cacheSet } from './redis';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_DELAY_MS = 1100; // 1 req/sec rate limit

let lastCallTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < NOMINATIM_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, NOMINATIM_DELAY_MS - elapsed));
  }
  lastCallTime = Date.now();
}

/**
 * Forward geocode: text → lat/lng
 */
export async function forwardGeocode(
  query: string
): Promise<{ lat: number; lng: number; display_name: string } | null> {
  const cacheKey = `geocode:fwd:${query.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = await cacheGet<{ lat: number; lng: number; display_name: string }>(cacheKey);
  if (cached) return cached;

  await throttle();

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      limit: '1',
      countrycodes: 'in',
    });

    const response = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
      headers: { 'User-Agent': 'SmartHangoutPlanner/1.0' },
    });

    if (!response.ok) return null;

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const result = {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
      display_name: results[0].display_name as string,
    };

    await cacheSet(cacheKey, result, 86400); // 24h
    return result;
  } catch (err) {
    console.error('[Geocoding] Forward geocode error:', err);
    return null;
  }
}

/**
 * Reverse geocode: lat/lng → human-readable name
 */
export async function reverseGeocode(
  location: LatLng
): Promise<string | null> {
  const cacheKey = `geocode:rev:${location.lat.toFixed(4)}_${location.lng.toFixed(4)}`;
  const cached = await cacheGet<string>(cacheKey);
  if (cached) return cached;

  await throttle();

  try {
    const params = new URLSearchParams({
      lat: location.lat.toString(),
      lon: location.lng.toString(),
      format: 'json',
      zoom: '14',
    });

    const response = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, {
      headers: { 'User-Agent': 'SmartHangoutPlanner/1.0' },
    });

    if (!response.ok) return null;

    const result = await response.json();
    const name = result.display_name as string;

    await cacheSet(cacheKey, name, 86400);
    return name;
  } catch (err) {
    console.error('[Geocoding] Reverse geocode error:', err);
    return null;
  }
}
