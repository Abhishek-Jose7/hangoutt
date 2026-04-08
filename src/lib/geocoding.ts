import type { LatLng } from '@/types';
import { cacheGet, cacheSet } from './redis';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_DELAY_MS = 1100; // 1 req/sec rate limit
const GEOCODE_TIMEOUT_MS = 6000;
const LOCAL_CACHE_TTL_MS = 2 * 60 * 1000;

let lastCallTime = 0;
const inflightForward = new Map<string, Promise<{ lat: number; lng: number; display_name: string } | null>>();
const inflightReverse = new Map<string, Promise<string | null>>();
const localForwardCache = new Map<string, { expiresAt: number; value: { lat: number; lng: number; display_name: string } }>();
const localReverseCache = new Map<string, { expiresAt: number; value: string }>();

function readLocalCache<T>(store: Map<string, { expiresAt: number; value: T }>, key: string): T | null {
  const found = store.get(key);
  if (!found) return null;
  if (found.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return found.value;
}

function writeLocalCache<T>(store: Map<string, { expiresAt: number; value: T }>, key: string, value: T): void {
  store.set(key, {
    value,
    expiresAt: Date.now() + LOCAL_CACHE_TTL_MS,
  });
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: { 'User-Agent': 'SmartHangoutPlanner/1.0' },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

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
  const local = readLocalCache(localForwardCache, cacheKey);
  if (local) return local;

  const inflight = inflightForward.get(cacheKey);
  if (inflight) return inflight;

  const task = (async () => {
    const cached = await cacheGet<{ lat: number; lng: number; display_name: string }>(cacheKey);
    if (cached) {
      writeLocalCache(localForwardCache, cacheKey, cached);
      return cached;
    }

    await throttle();

    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: '1',
        countrycodes: 'in',
      });

      const response = await fetchWithTimeout(`${NOMINATIM_BASE}/search?${params}`);
      if (!response?.ok) return null;

      const results = await response.json();
      if (!Array.isArray(results) || results.length === 0) return null;

      const result = {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
        display_name: results[0].display_name as string,
      };

      await cacheSet(cacheKey, result, 86400); // 24h
      writeLocalCache(localForwardCache, cacheKey, result);
      return result;
    } catch (err) {
      console.error('[Geocoding] Forward geocode error:', err);
      return null;
    }
  })();

  inflightForward.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflightForward.delete(cacheKey);
  }
}

/**
 * Reverse geocode: lat/lng → human-readable name
 */
export async function reverseGeocode(
  location: LatLng
): Promise<string | null> {
  const cacheKey = `geocode:rev:${location.lat.toFixed(4)}_${location.lng.toFixed(4)}`;
  const local = readLocalCache(localReverseCache, cacheKey);
  if (local) return local;

  const inflight = inflightReverse.get(cacheKey);
  if (inflight) return inflight;

  const task = (async () => {
    const cached = await cacheGet<string>(cacheKey);
    if (cached) {
      writeLocalCache(localReverseCache, cacheKey, cached);
      return cached;
    }

    await throttle();

    try {
      const params = new URLSearchParams({
        lat: location.lat.toString(),
        lon: location.lng.toString(),
        format: 'json',
        zoom: '14',
      });

      const response = await fetchWithTimeout(`${NOMINATIM_BASE}/reverse?${params}`);
      if (!response?.ok) return null;

      const result = await response.json();
      const name = result.display_name as string;

      await cacheSet(cacheKey, name, 86400);
      writeLocalCache(localReverseCache, cacheKey, name);
      return name;
    } catch (err) {
      console.error('[Geocoding] Reverse geocode error:', err);
      return null;
    }
  })();

  inflightReverse.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflightReverse.delete(cacheKey);
  }
}
