import { db } from './src/lib/db/client';
import { venuesCache } from './src/lib/db/schema';

async function clearCache() {
  try {
    console.log('Clearing venues cache...');
    const result = await db.delete(venuesCache);
    console.log('Cache cleared successfully.', result);
  } catch (err) {
    console.error('Error clearing cache:', err);
  }
}

clearCache();
