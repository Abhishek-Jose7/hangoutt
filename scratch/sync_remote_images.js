#!/usr/bin/env node
/**
 * Bulk-cache images for all places in the remote D1 database.
 * 
 * This script:
 * 1. Fetches all places that have image_url but no image_data from remote D1
 * 2. Calls the worker's /api/places/photo endpoint for each
 * 3. The worker fetches from Google, caches base64 in D1, and returns the image
 * 
 * Usage: node scratch/sync_remote_images.js
 */

const WORKER_BASE = 'https://hangout-api.hangoutt.workers.dev';
const BATCH_SIZE = 5;       // concurrent requests per batch
const DELAY_MS = 2000;      // delay between batches to avoid rate limits
const MAX_RETRIES = 2;

async function main() {
  // Step 1: Get all uncached places via wrangler CLI
  console.log('📦 Fetching uncached places from remote D1...');
  
  const { execSync } = require('child_process');
  
  let rawOutput;
  try {
    rawOutput = execSync(
      `npx wrangler d1 execute hangout-dev --remote --json --command "SELECT id, image_url FROM places WHERE image_url IS NOT NULL AND image_data IS NULL ORDER BY rating DESC NULLS LAST LIMIT 200;"`,
      { cwd: process.cwd(), encoding: 'utf-8', timeout: 30000 }
    );
  } catch (err) {
    console.error('❌ Failed to query remote D1:', err.message);
    process.exit(1);
  }

  let places;
  try {
    const parsed = JSON.parse(rawOutput);
    places = parsed[0]?.results || [];
  } catch (err) {
    // wrangler sometimes wraps output with extra text; try to find JSON array
    const jsonStart = rawOutput.indexOf('[');
    const jsonEnd = rawOutput.lastIndexOf(']');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(rawOutput.substring(jsonStart, jsonEnd + 1));
      places = parsed[0]?.results || [];
    } else {
      console.error('❌ Failed to parse wrangler output');
      process.exit(1);
    }
  }

  console.log(`📍 Found ${places.length} places with uncached images`);

  if (places.length === 0) {
    console.log('✅ All images are already cached!');
    return;
  }

  // Step 2: Extract photo refs and call worker endpoint
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(places.length / BATCH_SIZE);
    
    console.log(`\n🔄 Batch ${batchNum}/${totalBatches} (${batch.length} places)...`);
    
    const promises = batch.map(async (place) => {
      const imageUrl = place.image_url;
      if (!imageUrl) {
        skipCount++;
        return;
      }

      // Extract ref from "/api/places/photo?ref=..."
      const match = imageUrl.match(/ref=([^&]+)/);
      if (!match) {
        console.log(`  ⏭️  ${place.id}: No photo ref found in image_url`);
        skipCount++;
        return;
      }

      const ref = match[1];
      const workerUrl = `${WORKER_BASE}/api/places/photo?ref=${ref}&maxwidth=400`;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetch(workerUrl, { 
            signal: AbortSignal.timeout(15000) 
          });
          
          if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            const contentLength = res.headers.get('content-length') || '?';
            if (contentType.includes('image')) {
              // Consume the body to complete the request
              await res.arrayBuffer();
              console.log(`  ✅ ${place.id}: Cached (${contentLength} bytes)`);
              successCount++;
              return;
            } else {
              const text = await res.text();
              console.log(`  ⚠️  ${place.id}: Non-image response: ${text.substring(0, 100)}`);
              failCount++;
              return;
            }
          } else {
            const text = await res.text();
            if (attempt < MAX_RETRIES) {
              console.log(`  ⏳ ${place.id}: ${res.status} (retry ${attempt}/${MAX_RETRIES})`);
              await sleep(1000);
              continue;
            }
            console.log(`  ❌ ${place.id}: ${res.status} - ${text.substring(0, 100)}`);
            failCount++;
            return;
          }
        } catch (err) {
          if (attempt < MAX_RETRIES) {
            console.log(`  ⏳ ${place.id}: ${err.message} (retry ${attempt}/${MAX_RETRIES})`);
            await sleep(1000);
            continue;
          }
          console.log(`  ❌ ${place.id}: ${err.message}`);
          failCount++;
          return;
        }
      }
    });

    await Promise.all(promises);
    
    // Progress
    const processed = Math.min(i + BATCH_SIZE, places.length);
    console.log(`  📊 Progress: ${processed}/${places.length} | ✅ ${successCount} | ❌ ${failCount} | ⏭️ ${skipCount}`);

    // Delay between batches
    if (i + BATCH_SIZE < places.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`🏁 Done! ✅ ${successCount} cached | ❌ ${failCount} failed | ⏭️ ${skipCount} skipped`);
  console.log('═'.repeat(60));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
