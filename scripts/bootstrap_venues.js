/**
 * Bootstrap venue discovery for all major Mumbai areas — writes to D1 (remote).
 *
 * REQUIRES: worker already deployed with updated DISCOVERY_ZONES (run npm run worker:deploy first)
 *
 * Usage:
 *   node scripts/bootstrap_venues.js              # all 53 zones
 *   node scripts/bootstrap_venues.js --start 20   # resume from zone index 20
 *   node scripts/bootstrap_venues.js --zone Andheri
 */
'use strict';

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch (_) {}

const WORKER_URL = (process.env.HANGOUT_API_URL || '').replace(/\/$/, '');
const API_SECRET = process.env.HANGOUT_API_SECRET || '';

if (!WORKER_URL) { console.error('ERROR: HANGOUT_API_URL not set in .env'); process.exit(1); }
if (!API_SECRET) { console.error('ERROR: HANGOUT_API_SECRET not set in .env'); process.exit(1); }

// Ensure URL has protocol
const BASE = WORKER_URL.startsWith('http') ? WORKER_URL : `https://${WORKER_URL}`;

const ALL_ZONES = [
  // South Mumbai
  'Colaba', 'Fort', 'Churchgate', 'Marine Lines', 'Girgaon', 'Grant Road',
  'Mumbai Central', 'Mahalakshmi',
  // Central Mumbai
  'Byculla', 'Worli', 'Lower Parel', 'Prabhadevi', 'Parel', 'Dadar',
  'Matunga', 'Sewri', 'Wadala', 'Sion',
  // Western Suburbs
  'Mahim', 'Bandra', 'BKC', 'Khar', 'Santacruz', 'Juhu', 'Vile Parle',
  'Andheri', 'Versova', 'Jogeshwari', 'Goregaon', 'Malad', 'Kandivali',
  'Borivali', 'Dahisar',
  // Eastern Suburbs (Central Line)
  'Kurla', 'Chunabhatti', 'Chembur', 'Ghatkopar', 'Vikhroli', 'Powai',
  'Bhandup', 'Mulund', 'Thane', 'Dombivli',
  // Harbour Line / Navi Mumbai
  'Mankhurd', 'Vashi', 'Sanpada', 'Juinagar', 'Nerul', 'Seawoods',
  'Belapur', 'Kharghar', 'Airoli', 'Panvel',
];

async function discoverZone(zoneName, attempt = 1) {
  const url = `${BASE}/api/admin/discover-zone`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000); // 90s per zone

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_SECRET}`,
      },
      body: JSON.stringify({ zoneName }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      if (body?.error?.message?.includes('not supported')) {
        return { ok: false, reason: 'zone_not_in_deployed_worker' };
      }
      return { ok: false, reason: body?.error?.message || `HTTP 400` };
    }

    // 503/429 = Ola rate limit — back off and retry
    if ((res.status === 503 || res.status === 429) && attempt <= 3) {
      const wait = attempt * 45000; // 45s, 90s, 135s
      process.stdout.write(`  rate-limited, waiting ${wait / 1000}s (attempt ${attempt}/3)...\n`);
      await sleep(wait);
      return discoverZone(zoneName, attempt + 1);
    }

    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, count: data.count ?? 0 };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError' && attempt <= 3) {
      process.stdout.write(`  timeout, retrying (attempt ${attempt}/3)...\n`);
      await sleep(30000);
      return discoverZone(zoneName, attempt + 1);
    }
    if (err.name === 'AbortError') return { ok: false, reason: 'timeout after 3 attempts' };
    return { ok: false, reason: err.message };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const args = process.argv.slice(2);

  // Single zone mode
  const zoneFlag = args.indexOf('--zone');
  if (zoneFlag !== -1) {
    const name = args[zoneFlag + 1];
    if (!name) { console.error('--zone requires a zone name'); process.exit(1); }
    console.log(`Discovering ${name} on ${BASE}...`);
    const r = await discoverZone(name);
    if (r.ok) console.log(`Done: ${r.count} venues added/updated in D1`);
    else if (r.reason === 'zone_not_in_deployed_worker') {
      console.error(`Zone "${name}" not in deployed worker. Run: npm run worker:deploy first.`);
    } else {
      console.error(`Failed: ${r.reason}`);
    }
    return;
  }

  const startIdx = args.includes('--start')
    ? parseInt(args[args.indexOf('--start') + 1] || '0')
    : 0;

  const zones = ALL_ZONES.slice(startIdx);
  let deployWarned = false;
  let grandTotal = 0;
  const failed = [];

  console.log(`\nBootstrapping ${zones.length} zones → ${BASE}`);
  console.log('(5s delay between zones to stay within Ola API limits)\n');

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const globalIdx = startIdx + i;
    process.stdout.write(`[${globalIdx + 1}/${ALL_ZONES.length}] ${zone.padEnd(16)} `);

    const r = await discoverZone(zone);

    if (r.ok) {
      process.stdout.write(`+${r.count} venues\n`);
      grandTotal += r.count;
    } else if (r.reason === 'zone_not_in_deployed_worker') {
      if (!deployWarned) {
        console.log('\n⚠  Worker not deployed with new zones yet.');
        console.log('   Run: npm run worker:deploy   then re-run this script.\n');
        deployWarned = true;
      }
      process.stdout.write(`SKIP (not in deployed worker)\n`);
      failed.push(zone);
    } else {
      process.stdout.write(`FAILED: ${r.reason}\n`);
      failed.push(zone);
    }

    if (i < zones.length - 1) await sleep(5000);
  }

  console.log(`\nDone. ${grandTotal} venues added/updated in D1.`);
  if (failed.length > 0) {
    console.log(`Failed zones (${failed.length}): ${failed.join(', ')}`);
    console.log(`Retry with: node scripts/bootstrap_venues.js --zone "<name>"`);
  }
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
