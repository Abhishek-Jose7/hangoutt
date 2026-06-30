const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Load GOOGLE_MAPS_API_KEY from .env
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

// Helper to execute D1 commands
function runD1Query(query) {
  const cmd = `npx wrangler d1 execute hangout-dev --remote --command=${JSON.stringify(query)} --json`;
  const output = execSync(cmd, { encoding: 'utf8' });
  const data = JSON.parse(output);
  return data[0]?.results || [];
}

async function run() {
  console.log('Fetching places without cached images from remote D1...');
  const places = runD1Query(
    "SELECT id, image_url FROM places WHERE image_url LIKE '%/api/places/photo?ref=%' AND image_data IS NULL LIMIT 25;"
  );

  if (places.length === 0) {
    console.log('No places found needing image caching.');
    return;
  }

  console.log(`Processing ${places.length} places in this batch...`);
  const updates = [];

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    
    // Extract photo reference
    const urlParts = place.image_url.split('?ref=');
    if (urlParts.length < 2) continue;
    const ref = decodeURIComponent(urlParts[1]);

    const googleUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=300&photo_reference=${ref}&key=${apiKey}`;

    try {
      console.log(`[${i + 1}/${places.length}] Fetching image for ${place.id}...`);
      
      // Step 1: Follow redirect manually
      const res = await fetch(googleUrl, { redirect: 'manual' });
      const redirectUrl = res.headers.get('location');
      if (!redirectUrl) {
        console.warn(`Could not get redirect for ${place.id}`);
        continue;
      }

      // Step 2: Fetch actual image bytes
      const imgRes = await fetch(redirectUrl);
      if (!imgRes.ok) {
        console.warn(`Failed to fetch image bytes for ${place.id}: status ${imgRes.status}`);
        continue;
      }

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const base64 = buffer.toString('base64');

      updates.push({
        id: place.id,
        base64: base64
      });

      // Avoid hitting Google Maps API rate limits
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`Error processing place ${place.id}:`, err.message);
    }
  }

  if (updates.length === 0) {
    console.log('No updates to perform.');
    return;
  }

  console.log(`Applying ${updates.length} image cache updates to remote D1 individually...`);
  
  let successCount = 0;
  for (let i = 0; i < updates.length; i++) {
    const up = updates[i];
    const escapedBase64 = up.base64.replace(/'/g, "''");
    const query = `UPDATE places SET image_data = '${escapedBase64}' WHERE id = '${up.id}';`;
    const sqlFile = path.resolve(__dirname, `../temp_image_${up.id}.sql`);
    
    fs.writeFileSync(sqlFile, query, 'utf8');
    
    try {
      execSync(`npx wrangler d1 execute hangout-dev --remote --file=${JSON.stringify(sqlFile)}`, { stdio: 'ignore' });
      console.log(`[${i + 1}/${updates.length}] Successfully uploaded image for ${up.id} (${(up.base64.length / 1024).toFixed(1)} KB)`);
      successCount++;
    } catch (err) {
      console.error(`[${i + 1}/${updates.length}] Failed to upload image for ${up.id}:`, err.message);
    } finally {
      if (fs.existsSync(sqlFile)) {
        fs.unlinkSync(sqlFile);
      }
    }
  }
  console.log(`Successfully cached ${successCount} images on remote D1!`);
}

run().catch(console.error);
