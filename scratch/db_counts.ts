import { db } from '../src/lib/db/client';
import { places, experiences, placeCategories, experienceCategories, experienceSources } from '../src/lib/db/schema';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    const placesRes = await db.select({ count: sql`COUNT(*)` }).from(places);
    console.log('Places count:', placesRes[0]?.count);

    const experiencesRes = await db.select({ count: sql`COUNT(*)` }).from(experiences);
    console.log('Experiences count:', experiencesRes[0]?.count);

    const categoriesRes = await db.select({
      category: placeCategories.category,
      count: sql`COUNT(*)`
    }).from(placeCategories).groupBy(placeCategories.category);
    console.log('Categories:', categoriesRes);

    const expCategoriesRes = await db.select().from(experienceCategories);
    console.log('Experience Categories:', expCategoriesRes);

    const expSourcesRes = await db.select().from(experienceSources);
    console.log('Experience Sources:', expSourcesRes);
  } catch (err) {
    console.error('Error:', err);
  }
}
main();

