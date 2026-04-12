#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  Tavily + Groq Discovery Pipeline                          ║
 * ║  Smart venue discovery → rule filter → Groq validation     ║
 * ║  → geocoding → Typesense store                             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Pipeline:
 *   Tavily (broad recall) → Hard filters (free) → Groq Pass 1 (validate)
 *   → Groq Pass 2 (re-validate with different key) → Geocode → Store
 *
 * Usage:
 *   node scripts/tavily-groq-discover.mjs "Andheri"
 *   node scripts/tavily-groq-discover.mjs "Bandra" --mood fun
 *   node scripts/tavily-groq-discover.mjs "Malad" --dry-run
 *   node scripts/tavily-groq-discover.mjs --all           # Run for ALL areas
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TAVILY_KEY = process.env.TAVILY_API_KEY;
const GROQ_KEY_1 = process.env.GROQ_API_KEY_GENERATOR;   // Pass 1
const GROQ_KEY_2 = process.env.GROQ_API_KEY_RETRY;       // Pass 2
const TS_HOST = process.env.TYPESENSE_HOST;
const TS_KEY = process.env.TYPESENSE_ADMIN_API_KEY || process.env.TYPESENSE_API_KEY;
const TS_PROTO = process.env.TYPESENSE_PROTOCOL || 'https';
const TS_PORT = process.env.TYPESENSE_PORT || '443';
const TS_COLLECTION = process.env.TYPESENSE_COLLECTION || 'venues';
const TS_BASE = TS_HOST ? `${TS_PROTO}://${TS_HOST}:${TS_PORT}` : null;
const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_TOKEN;

const DRY_RUN = process.argv.includes('--dry-run');
const RUN_ALL = process.argv.includes('--all');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const stationsData = JSON.parse(readFileSync(join(__dirname, '../src/lib/stations.json'), 'utf-8'));
const MUMBAI_AREAS = stationsData.map(s => s.name);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tavily queries — biased towards REAL venues
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildTavilyQueries(area, mood = 'fun') {
  const base = [
    // Activity-heavy (brand-anchored → much better Tavily results)
    `Timezone Smaaash arcade bowling gaming zone near ${area} Mumbai`,
    `escape room mystery rooms breakout ${area} Mumbai`,
    `trampoline park go karting VR gaming ${area} Mumbai`,
    // Emerging / Trendy activities
    `VR arenas rage rooms break room smash room ${area} Mumbai`,
    `mini golf hybrid interactive games workshops ${area} Mumbai`,
    // Cafes / social / niche
    `popular trendy cafes for groups ${area} Mumbai with prices`,
    `best rated hangout spots ${area} Mumbai young crowd`,
    `aesthetic rooftop cafes themed pet cafes ${area} Mumbai`,
    // Comedy / events
    `comedy shows live music events ${area} Mumbai`,
    `night markets pop ups flea markets ${area} Mumbai`,
  ];

  if (mood === 'romantic') {
    base.push(`date night restaurants dessert cafes ${area} Mumbai`);
  } else if (mood === 'chill') {
    base.push(`quiet bookstore cafes board game spots ${area} Mumbai`);
    base.push(`pottery painting art workshops ${area} Mumbai`);
  } else if (mood === 'adventure') {
    base.push(`adventure activities paintball laser tag ${area} Mumbai`);
    base.push(`rock climbing bouldering ${area} Mumbai`);
  }

  return base;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Step 1: Tavily fetch
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function tavilySearch(query) {
  const { tavily } = await import('@tavily/core');
  const client = tavily({ apiKey: TAVILY_KEY });

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await client.search(query, { maxResults: 8, searchDepth: 'basic' });
      return res.results || [];
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
  return [];
}

function extractRawNames(results) {
  const names = new Map(); // normalized → best entry
  const out = [];

  // ── PASS A: Titles first (highest signal) ──
  for (const r of results) {
    const titleName = r.title.split(/[|:\-–—]/)[0].trim();
    if (titleName.length >= 4 && titleName.length <= 60) {
      const key = titleName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!names.has(key)) {
        names.set(key, true);
        out.push({ name: titleName, context: `${r.title} ${r.content}`.slice(0, 300), url: r.url, source: 'title' });
      }
    }
  }

  // ── PASS B: Content — quoted names and "Visit X" patterns ──
  for (const r of results) {
    const patterns = r.content.match(/(?:"([^"]{4,40})")|(?:(?:visit|try|check out)\s+([A-Z][A-Za-z\s&']{3,30}))/gi) || [];
    for (const m of patterns) {
      const clean = m.replace(/^["']|["']$/g, '').replace(/^(?:visit|try|check out)\s+/i, '').trim();
      if (clean.length < 4 || clean.length > 50) continue;
      if (clean.split(/\s+/).length < 2) continue; // Must be 2+ words
      const key = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!names.has(key)) {
        names.set(key, true);
        out.push({ name: clean, context: r.content.slice(0, 300), url: r.url, source: 'pattern' });
      }
    }
  }

  // ── PASS C: Content — title-case multi-word phrases (2+ words required) ──
  for (const r of results) {
    const matches = r.content.match(/([A-Z][a-zA-Z0-9&'.\-]+(?:\s+[A-Z][a-zA-Z0-9&'.\-]+){1,4})/g) || [];
    for (const m of matches) {
      const clean = m.trim();
      if (clean.length < 6 || clean.length > 50) continue;
      const key = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!names.has(key)) {
        names.set(key, true);
        out.push({ name: clean, context: r.content.slice(0, 200), url: r.url, source: 'titlecase' });
      }
    }
  }

  return out;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Step 2: HARD FILTER (rule-based, free, kills ~70% junk)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BAD_PATTERNS = [
  'best', 'top', 'places', 'things', 'near me', 'guide', 'list',
  'mumbai', 'india', 'maharashtra', 'review', 'rating', 'tripadvisor',
  'zomato', 'justdial', 'bookmyshow', 'location', 'direction',
  'contact', 'phone', 'address', 'menu', 'google', 'facebook',
  'instagram', 'blog', 'article', 'wikipedia', 'per person',
];

const VALID_NAME_RE = /^[A-Za-z0-9&'.\/\-\s()]{4,}$/;

const SINGLE_WORD_JUNK = new Set([
  'from', 'with', 'that', 'this', 'they', 'have', 'been', 'will',
  'also', 'more', 'some', 'just', 'only', 'when', 'what', 'your',
  'cafe', 'restaurant', 'bar', 'park', 'garden', 'mall', 'hotel',
  'shop', 'building', 'road', 'street', 'lane', 'floor', 'level',
  'gate', 'entry', 'exit', 'area', 'zone', 'sector', 'plot',
  'bowling', 'arcade', 'gaming', 'enjoy', 'experience', 'celebrate',
  'unlimited', 'included', 'available', 'apply', 'gear', 'embark',
]);

const AREA_NAMES = new Set([
  'bandra', 'andheri', 'juhu', 'kurla', 'dadar', 'powai', 'borivali',
  'worli', 'colaba', 'malad', 'goregaon', 'kandivali', 'mulund',
  'thane', 'vashi', 'ghatkopar', 'chembur', 'khar', 'versova',
  'santacruz', 'vile parle', 'lower parel', 'fort', 'churchgate',
  'mahalaxmi', 'byculla', 'sion', 'wadala', 'vikhroli', 'matunga',
  'parel', 'prabhadevi', 'mahim', 'lokhandwala', 'oshiwara',
  ,
]);

const AREA_SUFFIXES =
  /\s+(Bandra(\s*(West|East))?|Andheri(\s*(West|East))?|Juhu|Kurla|Dadar|Powai|Borivali|Worli|Lower\s*Parel|Colaba|Malad|Goregaon|Kandivali|Mulund|Thane|Vile\s*Parle(\s*(West|East))?|Santacruz(\s*(West|East))?|Khar(\s*(West|East))?|Versova|Lokhandwala|Mumbai|India)(\s*,.*)?$/i;

function hardFilter(candidates) {
  const passed = [];
  const rejected = [];

  for (const c of candidates) {
    let name = c.name
      .replace(/^[\d\.\)\(\*\-]+\s*/, '') // strip "1. " or "* "
      .replace(/\s*\|.*$/, '')
      .replace(/\s*\(.*\)\s*$/, '')
      .replace(AREA_SUFFIXES, '')
      .trim();

    // Must match valid pattern
    if (!VALID_NAME_RE.test(name)) {
      rejected.push({ name: c.name, reason: 'invalid_chars' });
      continue;
    }

    // Single word check
    if (name.split(/\s+/).length === 1) {
      if (SINGLE_WORD_JUNK.has(name.toLowerCase()) || name.length < 5) {
        rejected.push({ name, reason: 'single_word_junk' });
        continue;
      }
    }

    // Word count
    if (name.split(/\s+/).length > 5) {
      rejected.push({ name, reason: 'too_many_words' });
      continue;
    }

    // Length
    if (name.length < 4 || name.length > 50) {
      rejected.push({ name, reason: 'bad_length' });
      continue;
    }

    // Bad patterns
    const lower = name.toLowerCase();
    if (BAD_PATTERNS.some(p => lower.includes(p))) {
      rejected.push({ name, reason: 'bad_pattern' });
      continue;
    }

    // Area/city names as standalone
    if (AREA_NAMES.has(lower)) {
      rejected.push({ name, reason: 'area_name' });
      continue;
    }

    // Road/marg names
    if (/\b(marg|road|lane|chowk|nagar|wadi|gaon)\b/i.test(name)) {
      rejected.push({ name, reason: 'road_name' });
      continue;
    }

    passed.push({ ...c, name });
  }

  // Fuzzy dedup — collapse "Smaaash", "Smaaash Entertainment", "The Smaaash Entertainment Arcade"
  const deduped = [];
  const seenCores = new Set();
  for (const c of passed) {
    const core = c.name.toLowerCase()
      .replace(/^the\s+/i, '')
      .replace(/\s+(entertainment|arcade|centre|center|zone|park|complex|lounge|club|bar|cafe|restaurant)s?/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    if (core.length >= 3 && seenCores.has(core)) continue;
    if (core.length >= 3) seenCores.add(core);
    deduped.push(c);
  }

  return { passed: deduped, rejected };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Step 3: Groq validation (batched, 2-pass)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GROQ_VALIDATE_PROMPT = `You are validating venue names for a Mumbai hangout planning app.

For EACH place below, return a JSON array with one object per place:
{
  "name": "exact name from input",
  "valid": true or false,
  "type": "activity" | "cafe" | "restaurant" | "outdoor",
  "tags": ["tag1", "tag2"],
  "estimated_cost": number (INR per person),
  "confidence": 0.0 to 1.0,
  "reason": "short explanation of your decision"
}

RULES:
- ACCEPT only real, specific venues that people actually visit for hangouts
- ONLY accept venues located IN MUMBAI or its suburbs (Thane, Navi Mumbai, Kalyan etc). REJECT any venue in other cities (Delhi, Pune, Bangalore, Ludhiana etc).
- ACCEPT: arcades, bowling alleys, escape rooms, trampolines, cafes, restaurants, parks, cinemas, comedy clubs, board game cafes, museums
- REJECT: generic phrases ("Best cafes", "Top 10 places"), area names, neighborhoods, article titles
- REJECT: non-hangout places (offices, hospitals, schools, banks, government buildings)
- REJECT: vague names that aren't specific venues
- For "type": activity = ticketed/experiential, cafe = coffee/dessert, restaurant = dining, outdoor = park/promenade
- For "tags": use specific tags like ["arcade", "gaming"], ["escape_room"], ["bowling"], ["cafe", "dessert"], etc.
- For "estimated_cost": realistic INR per person (arcade=400-800, cafe=200-500, restaurant=500-1200, outdoor=50-200)
- "confidence": how confident you are this is a real, specific venue (0.9+ = definitely real, 0.5-0.7 = uncertain)

Return ONLY the JSON array, no other text.`;

async function groqValidate(candidates, apiKey, passLabel) {
  const batches = [];
  const batchSize = 10;
  for (let i = 0; i < candidates.length; i += batchSize) {
    batches.push(candidates.slice(i, i + batchSize));
  }

  const allResults = [];

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const placesText = batch.map((c, i) =>
      `${i + 1}. Name: "${c.name}"\n   Context: "${c.context.slice(0, 150)}"`
    ).join('\n\n');

    const messages = [
      { role: 'system', content: GROQ_VALIDATE_PROMPT },
      { role: 'user', content: `Validate these ${batch.length} places:\n\n${placesText}` },
    ];

    console.log(`  [${passLabel}] Batch ${bi + 1}/${batches.length} — ${batch.length} candidates`);

    for (let attempt = 0; attempt <= 5; attempt++) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages,
            temperature: 0.1,
            max_tokens: 4000,
          }),
        });

        if (!res.ok) {
          if (res.status === 429) {
            console.log(`  [${passLabel}] Rate limited, waiting 15s...`);
            await sleep(15000);
            if (attempt === 5) throw new Error("Rate limited on all attempts");
            continue;
          }
          const errText = await res.text();
          throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';

        // Extract JSON array from response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          console.log(`  [${passLabel}] ⚠ Could not parse JSON from Groq response`);
          console.log(`  [${passLabel}] Raw: ${content.slice(0, 300)}`);
          break;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) break;

        // Log Groq's thought process
        for (const item of parsed) {
          const emoji = item.valid ? '✅' : '❌';
          const conf = typeof item.confidence === 'number' ? item.confidence.toFixed(2) : '?';
          console.log(`    ${emoji} ${item.name} | type=${item.type || '?'} | conf=${conf} | ${item.reason || ''}`);
        }

        allResults.push(...parsed);
        break;
      } catch (err) {
        if (attempt === 5) {
          console.log(`  [${passLabel}] ❌ Failed after 6 attempts: ${err.message}`);
        } else {
          await sleep(2000);
        }
      }
    }

    // Respect rate limits between batches
    if (bi < batches.length - 1) await sleep(1500);
  }

  return allResults;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Step 4: Geocoding
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function geocode(name, area) {
  if (!MAPBOX_TOKEN) return null;
  const queries = [
    `${name}, ${area}, Mumbai`,
    `${name}, Mumbai`,
  ];

  for (const q of queries) {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=1&country=IN`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        // Mapbox returns coordinates as [lng, lat]
        const [lng, lat] = data.features[0].geometry.coordinates;
        return { lat, lng, display: data.features[0].place_name };
      }
    } catch { /* continue */ }
    await sleep(200); // Mapbox limit is much higher, so sleep less
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Step 5: Typesense store
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function storeInTypesense(doc) {
  if (!TS_BASE || !TS_KEY || DRY_RUN) return;
  try {
    const res = await fetch(`${TS_BASE}/collections/${TS_COLLECTION}/documents?action=upsert`, {
      method: 'POST',
      headers: { 'X-TYPESENSE-API-KEY': TS_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) {
      console.log(`    ⚠ Typesense upsert failed: ${res.status}`);
    }
  } catch (err) {
    console.log(`    ⚠ Typesense error: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Full pipeline for one area
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function discoverForArea(area, mood = 'fun') {
  const t0 = Date.now();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📍 Discovering: ${area} (mood: ${mood})`);
  console.log(`${'═'.repeat(60)}\n`);

  // ── STAGE 1: Tavily broad recall ──
  console.log('┌─ STAGE 1: Tavily Discovery');
  const queries = buildTavilyQueries(area, mood);
  const allTavilyResults = [];

  for (const q of queries) {
    console.log(`│  Query: "${q.slice(0, 70)}..."`);
    try {
      const results = await tavilySearch(q);
      console.log(`│  → ${results.length} results`);
      allTavilyResults.push(...results);
    } catch (err) {
      console.log(`│  → ❌ Failed: ${err.message}`);
    }
    await sleep(500);
  }

  const rawCandidates = extractRawNames(allTavilyResults);
  console.log(`└─ Total raw candidates extracted: ${rawCandidates.length}\n`);

  if (rawCandidates.length === 0) {
    console.log('  ⚠ No candidates found, skipping area.\n');
    return { area, stored: 0, rejected: 0 };
  }

  // ── STAGE 2: Hard filter ──
  console.log('┌─ STAGE 2: Hard Filter (rule-based)');
  const { passed: filtered, rejected: hardRejected } = hardFilter(rawCandidates);
  console.log(`│  Passed: ${filtered.length} / ${rawCandidates.length}`);
  console.log(`│  Rejected: ${hardRejected.length}`);

  // Show rejection breakdown
  const rejReasons = {};
  for (const r of hardRejected) {
    rejReasons[r.reason] = (rejReasons[r.reason] || 0) + 1;
  }
  if (Object.keys(rejReasons).length > 0) {
    console.log(`│  Rejection breakdown: ${JSON.stringify(rejReasons)}`);
  }
  console.log(`└─ ${filtered.length} candidates passed to Groq\n`);

  if (filtered.length === 0) {
    console.log('  ⚠ All candidates filtered, skipping area.\n');
    return { area, stored: 0, rejected: rawCandidates.length };
  }

  // Limit to avoid burning API credits
  const toValidate = filtered.slice(0, 30);

  // ── STAGE 3: Groq Pass 1 (primary validation) ──
  console.log('┌─ STAGE 3: Groq Pass 1 (Key: GENERATOR)');
  const pass1Results = await groqValidate(toValidate, GROQ_KEY_1, 'Pass 1');

  const pass1Accepted = pass1Results.filter(r => r.valid && (r.confidence || 0) >= 0.6);
  const pass1Rejected = pass1Results.filter(r => !r.valid || (r.confidence || 0) < 0.6);
  console.log(`└─ Pass 1: ${pass1Accepted.length} accepted, ${pass1Rejected.length} rejected\n`);

  if (pass1Accepted.length === 0) {
    console.log('  ⚠ Pass 1 rejected everything, skipping area.\n');
    return { area, stored: 0, rejected: rawCandidates.length };
  }

  // ── STAGE 4: Groq Pass 2 (re-validate with different key/perspective) ──
  console.log('┌─ STAGE 4: Groq Pass 2 (Key: RETRY — second opinion)');
  // Build pass 2 candidates from pass 1 accepted
  const pass2Input = pass1Accepted.map(item => ({
    name: item.name,
    context: `Validated as ${item.type} (${(item.tags || []).join(', ')}) with cost ₹${item.estimated_cost || '?'}. ${item.reason || ''}`,
  }));

  const pass2Results = await groqValidate(pass2Input, GROQ_KEY_2, 'Pass 2');

  const finalAccepted = pass2Results.filter(r => r.valid && (r.confidence || 0) >= 0.55);
  const pass2Rejected = pass2Results.filter(r => !r.valid || (r.confidence || 0) < 0.55);
  console.log(`└─ Pass 2: ${finalAccepted.length} accepted, ${pass2Rejected.length} rejected\n`);

  if (finalAccepted.length === 0) {
    console.log('  ⚠ Pass 2 rejected everything.\n');
    return { area, stored: 0, rejected: rawCandidates.length };
  }

  // Merge pass 1 + pass 2 data (pass 2 has final say on type/tags/cost)
  const mergedResults = finalAccepted.map(p2 => {
    const p1 = pass1Accepted.find(p => p.name.toLowerCase() === p2.name.toLowerCase());
    return {
      name: p2.name,
      type: p2.type || p1?.type || 'activity',
      tags: p2.tags?.length ? p2.tags : (p1?.tags || []),
      estimated_cost: p2.estimated_cost || p1?.estimated_cost || 500,
      confidence: Math.min(p2.confidence || 0, p1?.confidence || 0), // conservative
      reason_p1: p1?.reason || '',
      reason_p2: p2.reason || '',
    };
  });

  // ── STAGE 5: Geocoding ──
  console.log('┌─ STAGE 5: Geocoding validated places');
  const geocoded = [];

  for (const place of mergedResults) {
    const geo = await geocode(place.name, area);
    if (geo) {
      // Mumbai bounding box check — reject anything outside Greater Mumbai region
      // Greater Mumbai: lat 18.85-19.35, lng 72.75-73.20
      if (geo.lat < 18.85 || geo.lat > 19.35 || geo.lng < 72.75 || geo.lng > 73.20) {
        console.log(`│  🚫 ${place.name} → ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)} (OUTSIDE Mumbai bounds)`);
        continue;
      }
      console.log(`│  📍 ${place.name} → ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`);
      geocoded.push({ ...place, lat: geo.lat, lng: geo.lng });
    } else {
      console.log(`│  ⚠ ${place.name} → geocode failed`);
    }
  }
  console.log(`└─ Geocoded: ${geocoded.length} / ${mergedResults.length}\n`);

  // ── STAGE 6: Store in Typesense ──
  console.log('┌─ STAGE 6: Store in Typesense');
  let stored = 0;

  for (const place of geocoded) {
    const moodTags = inferMood(place.type, place.tags);
    const doc = {
      id: `tg_${place.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60)}`,
      name: place.name,
      type: place.type,
      description: `${(place.tags || []).join(', ')} in ${area}. ${place.reason_p2 || place.reason_p1 || ''}`.trim(),
      tags: place.tags || [],
      area,
      mood: moodTags,
      lat: place.lat,
      lng: place.lng,
      estimated_cost: place.estimated_cost,
      rating: Math.round(place.confidence * 5 * 10) / 10, // normalize to 5-star scale
      popularity: Math.round(place.confidence * 90),
      updated_at: Date.now(),
      url: `https://www.google.com/maps/search/?api=1&query=${place.lat}%2C${place.lng}%20(${encodeURIComponent(place.name)})`,
    };

    if (DRY_RUN) {
      console.log(`│  📝 Would store: ${doc.name} (${doc.type}) — ₹${doc.estimated_cost} — [${doc.tags.join(', ')}]`);
    } else {
      await storeInTypesense(doc);
      console.log(`│  ✅ Stored: ${doc.name} (${doc.type}) — ₹${doc.estimated_cost}`);
    }
    stored++;
  }
  console.log(`└─ Stored: ${stored}\n`);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`⏱  ${area} complete in ${elapsed}s — ${stored} venues stored\n`);

  return { area, stored, rejected: rawCandidates.length - stored, geocoded: geocoded.length };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function inferMood(type, tags) {
  const moods = new Set();
  const tagStr = (tags || []).join(' ').toLowerCase();

  if (/arcade|bowling|gaming|escape|trampoline|go.kart|laser|paintball|comedy/.test(tagStr)) {
    moods.add('fun');
    moods.add('adventure');
  }
  if (/cafe|coffee|dessert|bakery|book/.test(tagStr)) {
    moods.add('chill');
    moods.add('fun');
  }
  if (/restaurant|dining|fine/.test(tagStr)) {
    moods.add('fun');
    moods.add('romantic');
  }
  if (/park|beach|promenade|garden|lake/.test(tagStr)) {
    moods.add('chill');
    moods.add('romantic');
  }
  if (/cinema|movie|theatre/.test(tagStr)) {
    moods.add('fun');
    moods.add('chill');
    moods.add('romantic');
  }
  if (/museum|gallery|art/.test(tagStr)) {
    moods.add('chill');
    moods.add('romantic');
  }

  if (moods.size === 0) {
    if (type === 'activity') { moods.add('fun'); moods.add('adventure'); }
    else if (type === 'cafe') { moods.add('chill'); moods.add('fun'); }
    else if (type === 'restaurant') { moods.add('fun'); moods.add('romantic'); }
    else { moods.add('chill'); }
  }

  return [...moods];
}

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  const areas = [];
  let mood = 'fun';

  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--mood' && rawArgs[i + 1]) {
      mood = rawArgs[i + 1];
      i++; // skip next
    } else if (rawArgs[i].startsWith('--mood=')) {
      mood = rawArgs[i].split('=')[1];
    } else if (rawArgs[i].startsWith('--')) {
      // skip flags
    } else {
      areas.push(rawArgs[i]);
    }
  }

  return { areas, mood };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  // Validate keys
  if (!TAVILY_KEY) { console.error('❌ Missing TAVILY_API_KEY'); process.exit(1); }
  if (!GROQ_KEY_1) { console.error('❌ Missing GROQ_API_KEY_GENERATOR'); process.exit(1); }
  if (!GROQ_KEY_2) { console.error('❌ Missing GROQ_API_KEY_RETRY'); process.exit(1); }

  const { areas: inputAreas, mood } = parseArgs();
  const areas = RUN_ALL ? MUMBAI_AREAS : (inputAreas.length > 0 ? inputAreas : ['Andheri']);

  console.log(`\n${'╔' + '═'.repeat(58) + '╗'}`);
  console.log(`${'║'}  Tavily + Groq Discovery Pipeline                      ${'║'}`);
  console.log(`${'║'}  Areas: ${areas.slice(0, 5).join(', ')}${areas.length > 5 ? ` +${areas.length - 5} more` : ''}${' '.repeat(Math.max(0, 48 - areas.slice(0, 5).join(', ').length))}${'║'}`);
  console.log(`${'║'}  Mood: ${mood}   ${DRY_RUN ? '🔍 DRY RUN' : '🔥 LIVE'}${' '.repeat(Math.max(0, 40 - mood.length))}${'║'}`);
  console.log(`${'╚' + '═'.repeat(58) + '╝'}\n`);

  console.log('Pipeline: Tavily → Hard Filter → Groq Pass 1 → Groq Pass 2 → Geocode → Typesense\n');

  const t0 = Date.now();
  const results = [];

  for (const area of areas) {
    const result = await discoverForArea(area, mood);
    results.push(result);
  }

  // ── Summary ──
  const totalStored = results.reduce((s, r) => s + r.stored, 0);
  const totalRejected = results.reduce((s, r) => s + r.rejected, 0);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`${'═'.repeat(60)}`);
  console.log(`  📊 PIPELINE SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Areas processed: ${results.length}`);
  console.log(`  Total stored: ${totalStored}`);
  console.log(`  Total rejected: ${totalRejected}`);
  console.log(`  Time: ${elapsed}s`);
  console.log('');

  console.log('  Per-area breakdown:');
  for (const r of results) {
    console.log(`    ${r.area}: ${r.stored} stored, ${r.rejected} rejected`);
  }
  console.log('');

  // Save results log
  const logPath = 'scripts/discovery-log.json';
  writeFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), mood, results, totalStored, elapsed: `${elapsed}s` }, null, 2));
  console.log(`  Log saved to: ${logPath}\n`);

  if (DRY_RUN) {
    console.log('  🔍 Dry run — no changes were made to Typesense.\n');
  }
}

main().catch(err => {
  console.error(`\n❌ Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
