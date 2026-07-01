import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { GET } from '../src/app/api/places/photo/route';
import { NextRequest } from 'next/server';
import { db } from '../src/lib/db/client';
import { places } from '../src/lib/db/schema';
import { isNotNull, eq } from 'drizzle-orm';

async function run() {
  console.log('--- Photo Route Caching Test ---');
  
  // Find a place that has an image_url but NO image_data
  const place = await db
    .select()
    .from(places)
    .where(isNotNull(places.imageUrl))
    .limit(50)
    .then(rows => rows.find(r => !r.imageData));

  if (!place || !place.imageUrl) {
    console.log('No places found with imageUrl but no imageData.');
    return;
  }

  console.log(`Found candidate place: "${place.name}"`);
  console.log(`imageUrl in DB: "${place.imageUrl}"`);

  // Extract reference from the imageUrl
  const url = new URL(place.imageUrl, 'http://localhost:3000');
  const ref = url.searchParams.get('ref');

  if (!ref) {
    console.error('Failed to extract ref parameter from imageUrl');
    return;
  }

  console.log(`Extracted photo reference: "${ref.substring(0, 30)}..."`);

  // Mock a NextRequest to the proxy route
  const requestUrl = `http://localhost:3000/api/places/photo?ref=${encodeURIComponent(ref)}`;
  console.log(`Simulating request to: "${requestUrl}"`);
  const req = new NextRequest(requestUrl);

  // Temporarily disable Hangout API config to force local DB caching path execution
  const originalUrl = process.env.HANGOUT_API_URL;
  delete process.env.HANGOUT_API_URL;

  console.log('Invoking GET handler...');
  const res = await GET(req);

  // Restore
  if (originalUrl) process.env.HANGOUT_API_URL = originalUrl;

  console.log(`Response status: ${res.status}`);
  console.log(`Response headers:`, Object.fromEntries(res.headers.entries()));

  if (res.ok) {
    console.log('Waiting 3 seconds for async DB cache write...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify if the DB now contains the cached image data
    const updatedPlace = await db
      .select()
      .from(places)
      .where(eq(places.id, place.id))
      .limit(1)
      .then(rows => rows[0]);

    if (updatedPlace && updatedPlace.imageData) {
      console.log('SUCCESS: Image data has been cached in the DB!');
      console.log(`Cached image data size: ${Math.round(updatedPlace.imageData.length / 1024)} KB`);
    } else {
      console.error('FAILURE: Image data was NOT cached in the DB.');
    }
  } else {
    const text = await res.text();
    console.error(`Request failed with body: ${text}`);
  }
}

run().catch(console.error);
