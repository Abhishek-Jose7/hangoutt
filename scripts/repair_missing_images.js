const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Helper to load env
const envPath = path.resolve(__dirname, '../.env');
let apiKey = process.env.GOOGLE_MAPS_API_KEY;

if (!apiKey && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^GOOGLE_MAPS_API_KEY\s*=\s*(.+)$/m);
  if (match) {
    apiKey = match[1].trim();
  }
}

if (!apiKey) {
  console.error('Error: GOOGLE_MAPS_API_KEY is not defined in environment or .env file');
  process.exit(1);
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Parse limit from command line args (default: 200)
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 200;

async function run() {
  const dbPath = path.resolve(__dirname, '../local.db');
  console.log(`Connecting to local database: ${dbPath}`);
  const db = new Database(dbPath);

  // Find places with missing image_url
  const missingPlaces = db.prepare(
    "SELECT id, name, source_place_id FROM places WHERE source_name = 'GOOGLE' AND image_url IS NULL LIMIT ?"
  ).all(limit);

  if (missingPlaces.length === 0) {
    console.log('No places with missing image_url found.');
    db.close();
    return;
  }

  console.log(`Found ${missingPlaces.length} places with missing image_url. Querying Google Places API...`);

  const sqlLines = [];
  let successCount = 0;

  for (let i = 0; i < missingPlaces.length; i++) {
    const place = missingPlaces[i];
    console.log(`[${i + 1}/${missingPlaces.length}] Fetching photo for: ${place.name} (${place.id})...`);

    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${place.source_place_id}`, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,photos'
        }
      });

      if (!res.ok) {
        const body = await res.text();
        console.warn(`  Google API error (${res.status}): ${body.slice(0, 100)}`);
        continue;
      }

      const data = await res.json();
      const photo = data.photos?.[0];
      if (!photo || !photo.name) {
        console.log(`  No photos found for this place.`);
        // Mark as empty string or a placeholder so we don't keep querying it
        db.prepare("UPDATE places SET image_url = '' WHERE id = ?").run(place.id);
        continue;
      }

      const photoRef = photo.name.split('/photos/')[1] || photo.name.split('/').pop();
      const imageUrl = `/api/places/photo?ref=${encodeURIComponent(photoRef)}`;

      // Update local database
      db.prepare("UPDATE places SET image_url = ? WHERE id = ?").run(imageUrl, place.id);

      // Build SQL for remote sync
      sqlLines.push(`UPDATE places SET image_url = ${sqlString(imageUrl)} WHERE id = ${sqlString(place.id)};`);
      successCount++;

      // Small rate limiting pause
      await new Promise(r => setTimeout(r, 80));
    } catch (err) {
      console.error(`  Error processing ${place.name}:`, err.message);
    }
  }

  db.close();

  console.log(`\nLocal updates complete! Successfully found photos for ${successCount}/${missingPlaces.length} places.`);

  if (sqlLines.length > 0) {
    const sqlPath = path.resolve(__dirname, `repair_images_${Date.now()}.sql`);
    console.log(`Writing ${sqlLines.length} update queries to: ${sqlPath}`);
    fs.writeFileSync(sqlPath, sqlLines.join('\n'));

    console.log('Syncing updates to remote Cloudflare D1 database...');
    try {
      // Use --yes to bypass confirmation warnings
      execSync(`npx wrangler d1 execute hangout-dev --remote --file="${sqlPath}" --yes`, { stdio: 'inherit' });
      console.log('Remote D1 update complete!');
    } catch (err) {
      console.error('Error executing remote D1 update:', err.message);
    } finally {
      try {
        fs.unlinkSync(sqlPath);
      } catch {}
    }
  }
}

run().catch(console.error);
