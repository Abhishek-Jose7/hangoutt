import { db } from '../src/lib/db/client';
import { locations } from '../src/lib/db/schema';

async function check() {
  const result = await db.select().from(locations);
  console.log('LOCATIONS:', result);
  process.exit(0);
}

check();
