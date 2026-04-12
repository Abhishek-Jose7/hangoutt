import Typesense from "typesense";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OLA_KEY = process.env.OLA_MAPS_API_KEY;
if (!OLA_KEY) {
  console.error("Missing process.env.OLA_MAPS_API_KEY");
  process.exit(1);
}

const client = new Typesense.Client({
  nodes: [{
    host: process.env.TYPESENSE_HOST,
    port: 443,
    protocol: "https"
  }],
  apiKey: process.env.TYPESENSE_API_KEY
});

// Load areas dynamically from stations.json as requested in the workflow
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const stationsData = JSON.parse(readFileSync(join(__dirname, '../src/lib/stations.json'), 'utf-8'));
const AREAS = stationsData.map(s => s.name);

const TRENDY_MUMBAI_SPOTS = [
  "foo", "bastian", "gigi", "olive", "bayroute", "koko", "opa", "social",
  "yauatcha", "hakkasan", "izumi", "masque", "veronicas", "bombay canteen",
  "smaaash", "timezone"
];

const FAMOUS_CHAINS = [
  "mcdonald", "kfc", "burger king", "subway", "dominos", "pizza hut",
  "starbucks", "chaayos", "tim hortons", "third wave", "blue tokai", "barbeque nation"
];

// Queries (VERY IMPORTANT)
const BASE_QUERIES = [
  // Activities
  "arcade gaming zone",
  "bowling alley",
  "escape room",
  "trampoline park",
  "vr gaming",
  "go karting",

  // Cafes
  "trendy cafe",
  "aesthetic cafe",
  "coffee roasters",
  "dessert cafe"
];

const QUERIES = [...new Set([
  ...BASE_QUERIES,
  ...TRENDY_MUMBAI_SPOTS,
  ...FAMOUS_CHAINS,
])];

// Ola Search
async function olaSearch(query) {
  try {
    const res = await fetch(`https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(query)}&api_key=${OLA_KEY}`);
    if (!res.ok) return [];
    
    const data = await res.json();
    return data.predictions || data.results || [];
  } catch (err) {
    return [];
  }
}

// Classification (simple + reliable)
function classify(name) {
  const n = name.toLowerCase();

  if (/(arcade|bowling|escape|vr|gaming|kart)/.test(n)) return "activity";
  if (/(cafe|coffee|dessert)/.test(n)) return "cafe";

  return "restaurant";
}

// Tags
function getTags(name) {
  const n = name.toLowerCase();
  const tags = [];

  if (n.includes("arcade")) tags.push("arcade");
  if (n.includes("bowling")) tags.push("bowling");
  if (n.includes("escape")) tags.push("escape_room");
  if (n.includes("vr")) tags.push("vr");
  if (n.includes("cafe")) tags.push("coffee");

  return tags;
}

// Filter (IMPORTANT)
function isValid(p) {
  if (!p.name) return false;

  // avoid junk
  if (p.name.length < 4) return false;
  if (p.name.split(" ").length < 2) return false;

  return true;
}

// Cost (fix previous bug)
function estimateCost(name) {
  const n = name.toLowerCase();

  if (n.includes("bowling")) return 500;
  if (n.includes("arcade")) return 400;
  if (n.includes("escape")) return 700;
  if (n.includes("cafe")) return 300;

  return 500;
}

// Normalize
function normalize(p, area) {
  return {
    id: (p.place_id || `${p.name}_${area}`).replace(/\s+/g, "_"),
    name: p.name,
    type: classify(p.name),
    tags: getTags(p.name),
    area,
    lat: p.geometry && p.geometry.location ? p.geometry.location.lat : 19.0,
    lng: p.geometry && p.geometry.location ? p.geometry.location.lng : 72.8,
    estimated_cost: estimateCost(p.name),
    popularity: Math.round((p.rating || 4) * 20),
    updated_at: Date.now()
  };
}

// Main Runner
async function run() {
  const all = [];
  const seen = new Set();

  for (const area of AREAS) {
    console.log(`\n📍 ${area}`);

    for (const q of QUERIES) {
      const results = await olaSearch(`${q} ${area} Mumbai`);

      for (const r of results) {
        const name = r.name || (r.structured_formatting && r.structured_formatting.main_text) || r.description;
        r.name = name;
        if (!isValid(r)) continue;

        const key = r.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const place = normalize(r, area);
        all.push(place);
      }

      await new Promise(r => setTimeout(r, 400)); // avoid rate limits
    }
  }

  console.log(`\n🚀 Inserting ${all.length} places...`);

  if (all.length > 0) {
    await client.collections("venues")
      .documents()
      .import(all, { action: "upsert" });
  }

  console.log("✅ Done");
}

run().catch(console.error);
