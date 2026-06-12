import 'server-only';
import { MapsApiError } from '../errors';

const BASE_URL = 'https://api.olamaps.io';

export async function fetchOlaMaps<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const apiKey = process.env.OLA_MAPS_API_KEY;
  if (!apiKey) {
    console.error('OLA_MAPS_API_KEY is missing.');
    throw new MapsApiError('Maps API is not properly configured.');
  }

  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${endpoint}${separator}api_key=${apiKey}`;
  const headers = {
    'Content-Type': 'application/json',
    'Referer': 'http://localhost:3000',
    'Origin': 'http://localhost:3000',
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
