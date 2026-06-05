import 'server-only';
import { MapsApiError } from '../errors';

const OLA_MAPS_API_KEY = process.env.OLA_MAPS_API_KEY;
const BASE_URL = 'https://api.olamaps.it';

export async function fetchOlaMaps<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  if (!OLA_MAPS_API_KEY) {
    console.error('OLA_MAPS_API_KEY is missing.');
    throw new MapsApiError('Maps API is not properly configured.');
  }

  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OLA_MAPS_API_KEY}`,
    ...(options.headers || {}),
  };

  try {
    const startTime = Date.now();
    const res = await fetch(url, {
      ...options,
      headers,
    });
    const duration = Date.now() - startTime;

    // Log request metrics safely (no private coordinates)
    console.log(`Ola Maps call to ${endpoint} returned status ${res.status} in ${duration}ms`);

    if (!res.ok) {
      throw new MapsApiError(`Ola Maps API responded with status ${res.status}`);
    }

    return await res.json() as T;
  } catch (err) {
    if (err instanceof MapsApiError) throw err;
    console.error(`Network error calling Ola Maps:`, err);
    throw new MapsApiError('Network connection failure calling maps service.');
  }
}
