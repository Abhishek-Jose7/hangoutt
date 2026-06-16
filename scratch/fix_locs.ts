import { db } from '../src/lib/db/client';
import { locations } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';

async function fix() {
  console.log('Updating out-of-bounds coordinates to valid Mumbai coordinates...');
  
  // Update all instances of Bangalore coordinates (12.9348, 77.6189) to Dadar (19.0178, 72.8478)
  const result = await db
    .update(locations)
    .set({
      lat: 19.0178,
      lng: 72.8478,
      locationName: 'Dadar, Mumbai'
    })
    .where(eq(locations.lat, 12.9348));
  
  console.log('Updated locations result:', result);
  process.exit(0);
}

fix();
