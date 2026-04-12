import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function loadLocalEnvFile() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

const PREFS_FILE = resolve(process.cwd(), ".cache/ola-itinerary-preferences.json");

function loadPreferenceMemory() {
  try {
    if (!existsSync(PREFS_FILE)) return { moods: {} };
    const parsed = JSON.parse(readFileSync(PREFS_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : { moods: {} };
  } catch {
    return { moods: {} };
  }
}

function savePreferenceMemory(memory) {
  try {
    mkdirSync(resolve(process.cwd(), ".cache"), { recursive: true });
    writeFileSync(PREFS_FILE, JSON.stringify(memory, null, 2), "utf-8");
  } catch {
    // best effort only
  }
}

function getPreferenceBoost(memory, mood, place) {
  const moodStats = memory?.moods?.[mood];
  if (!moodStats) return 0;

  const bucketKey = place.isDessert ? "dessert" : place.normalized_bucket;
  const bucketCount = Number(moodStats.bucketCounts?.[bucketKey] || 0);
  const total = Number(moodStats.totalSelections || 0);
  if (total <= 0 || bucketCount <= 0) return 0;

  const ratio = bucketCount / total;
  // Cap memory influence; keep it subtle so fresh context still dominates.
  return Math.min(0.08, ratio * 0.08);
}

function updatePreferenceMemory(memory, mood, itinerary, budget = 0) {
  if (!memory.moods) memory.moods = {};
  if (!memory.moods[mood]) {
    memory.moods[mood] = { totalSelections: 0, bucketCounts: {} };
  }

  const moodStats = memory.moods[mood];
  for (const place of itinerary) {
    const bucketKey = place.isDessert ? "dessert" : place.normalized_bucket;
    moodStats.bucketCounts[bucketKey] = (moodStats.bucketCounts[bucketKey] || 0) + 1;
    moodStats.totalSelections += 1;
  }

  if (!memory.profile_stats) {
    memory.profile_stats = {
      runs: 0,
      utilization_sum: 0,
      tag_sums: { quiet: 0, crowded: 0, scenic: 0, aesthetic: 0, cozy: 0, lively: 0 },
      tag_count: 0,
    };
  }

  const totalCost = itinerary.reduce((sum, place) => sum + (place.estimated_cost || 0), 0);
  if (budget > 0) {
    memory.profile_stats.runs += 1;
    memory.profile_stats.utilization_sum += totalCost / budget;
  }

  for (const place of itinerary) {
    const tags = place.semantic_tags || {};
    for (const key of Object.keys(memory.profile_stats.tag_sums)) {
      memory.profile_stats.tag_sums[key] += getTagScore(tags, key);
    }
    memory.profile_stats.tag_count += 1;
  }
}

function getUserProfile(memory) {
  const stats = memory?.profile_stats;
  if (!stats || !stats.tag_count) {
    return {
      prefers_quiet: false,
      dislikes_crowds: false,
      prefers_scenic: false,
      budget_style: "balanced",
    };
  }

  const avgQuiet = stats.tag_sums.quiet / Math.max(stats.tag_count, 1);
  const avgCrowded = stats.tag_sums.crowded / Math.max(stats.tag_count, 1);
  const avgScenic = stats.tag_sums.scenic / Math.max(stats.tag_count, 1);
  const utilizationAvg = stats.runs > 0 ? stats.utilization_sum / stats.runs : 0.8;

  let budget_style = "balanced";
  if (utilizationAvg >= 0.9) budget_style = "premium";
  else if (utilizationAvg <= 0.72) budget_style = "value";

  return {
    prefers_quiet: avgQuiet >= 0.55,
    dislikes_crowds: avgCrowded <= 0.42,
    prefers_scenic: avgScenic >= 0.54,
    budget_style,
  };
}

const OLA_KEY = process.env.OLA_MAPS_API_KEY;

if (!OLA_KEY) {
  console.error("Missing OLA_MAPS_API_KEY");
  process.exit(1);
}

// Haversine distance in km
function getDistanceInKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function promptUser() {
  let AREA = process.argv[2];
  let MOOD = process.argv[3];
  let BUDGET = process.argv[4];
  let START_TIME = process.argv[5];

  const canPrompt = Boolean(stdin.isTTY && stdout.isTTY);
  let rl = null;

  if (canPrompt) {
    rl = createInterface({ input: stdin, output: stdout });
  } else if (!AREA || !MOOD || !BUDGET || !START_TIME) {
    console.log("ℹ️ Non-interactive shell detected, using defaults for missing inputs.");
  }

  try {
    if (!AREA && rl) AREA = await rl.question("\n📍 Enter Area (e.g., Bandra, Andheri, Colaba): ");
    if (!MOOD && rl) MOOD = await rl.question("🎭 Enter Mood (fun, chill, romantic, adventure): ");
    if (!BUDGET && rl) {
      const rawBudget = await rl.question("💰 Enter max budget per person in ₹ (e.g., 2000): ");
      BUDGET = parseInt(rawBudget, 10);
    }
    if (!START_TIME && rl) {
      while (true) {
        const rawTime = await rl.question("🕒 Enter Start Time (e.g., 5:00 PM, 14:00): ");
        const normalized = normalizeTimeInput(rawTime);
        if (normalized) {
          START_TIME = normalized.label24;
          break;
        }
        console.log("⚠️ Invalid time. Use formats like 12:0, 12:00, 5pm, 17:30.");
      }
    }
  } finally {
    if (rl) rl.close();
  }

  const normalizedTime = normalizeTimeInput(START_TIME || "5:00 PM");
  if (!normalizedTime) {
    if (canPrompt) {
      START_TIME = "17:00";
    } else {
      throw new Error(`Invalid start time: ${START_TIME}. Use HH:MM, H:M, or 12h formats like 5pm.`);
    }
  }

  const parsedBudget = parseInt(BUDGET, 10);

  return { 
    AREA: AREA || "Bandra", 
    MOOD: MOOD || "fun",
    BUDGET: Number.isFinite(parsedBudget) ? parsedBudget : 2000,
    START_TIME: normalizedTime ? normalizedTime.label24 : "17:00"
  };
}

// ── 1. Clean Name (limit words + parenthesis) ──
function isGenericDisplayName(value) {
  const n = normalizeText(value);
  return /^(desserts? and ice cream|restaurant|cafe|food court|eatery|bakery|coffee shop)$/.test(n);
}

function cleanName(name) {
  const raw = String(name || "").trim();
  let cleaned = raw.split("(")[0].trim();

  // If left-hand side is generic, try extracting a better label from parenthesis.
  if (isGenericDisplayName(cleaned)) {
    const inside = raw.match(/\(([^)]+)\)/)?.[1] || "";
    const candidate = inside.split(/[-,]/)[0].trim();
    if (candidate) cleaned = candidate;
  }

  cleaned = cleaned.split(/\s+/).slice(0, 8).join(" ");
  return cleaned || raw;
}

// ── 2. Buckets & Pricing Maps ──
const EXPERIENCE_BUCKETS = {
  arcade: ["arcade", "gaming", "ps", "vr", "game zone"],
  trampoline: ["trampoline", "jump", "bounce", "woop"],
  bowling: ["bowling", "strike"],
  escape: ["escape", "mystery room", "breakout"],
  cafe: ["cafe", "coffee", "roaster", "dessert", "lounge", "rooftop", "bakery"],
  outdoor: ["promenade", "park", "beach", "marine drive", "garden", "lake", "point"],
  restaurant: ["restaurant", "dining", "eatery", "bistro", "pub", "bar"]
};

const COST_MAP = {
  arcade: 300,
  bowling: 400,
  trampoline: 500,
  vr: 350,
  escape: 700,
  outdoor: 0,
  cafe: 250,
  restaurant: 600
};

const TRENDY_MUMBAI_SPOTS = [
  "foo", "bastian", "gigi", "olive", "bayroute", "koko", "opa", "social",
  "yauatcha", "hakkasan", "izumi", "masque", "nho saigon", "veronicas",
  "bombay canteen", "tolia", "smaaash", "timezone"
];

const FAMOUS_CHAINS = [
  "mcdonald", "kfc", "burger king", "subway", "dominos", "pizza hut",
  "starbucks", "chaayos", "tim hortons", "third wave", "blue tokai", "barbeque nation"
];

const DESSERT_KEYWORDS = [
  "dessert", "ice cream", "gelato", "frozen bottle", "baskin", "cream stone", "sweet"
];

const SCENIC_KEYWORDS = [
  "marine drive", "seaface", "sea face", "beach", "promenade", "sunset", "view point", "viewpoint"
];

const FAST_FOOD_BRANDS = [
  "burger king", "kfc", "mcdonald", "mcdonalds", "mc donald", "subway", "dominos", "pizza hut"
];

const LANDMARKS_BY_AREA = {
  churchgate: ["marine drive", "nariman point"],
  bandra: ["bandra fort", "carter road", "bandstand"],
  andheri: ["versova beach", "juhu beach"],
  colaba: ["gateway of india", "apollo bunder"],
};

const LANDMARK_FALLBACKS = {
  churchgate: { name: "Marine Drive Promenade", lat: 18.943, lng: 72.8238, address: "Marine Drive, Churchgate, Mumbai" },
  bandra: { name: "Carter Road Promenade", lat: 19.0678, lng: 72.8228, address: "Carter Road, Bandra West, Mumbai" },
  andheri: { name: "Juhu Beach Walk", lat: 19.101, lng: 72.8265, address: "Juhu Beach, Mumbai" },
  colaba: { name: "Gateway of India Waterfront", lat: 18.922, lng: 72.8347, address: "Gateway of India, Colaba, Mumbai" },
};

const CORPORATE_PATTERNS = [
  /\blimited\b/i,
  /\bprivate\s+limited\b/i,
  /\bpvt\.?\s*ltd\b/i,
  /\bllp\b/i,
  /\bformerly\s+known\s+as\b/i,
  /\bcorporation\b/i,
  /\bcompany\b/i,
  /\bbrands\s+asia\b/i,
];

const ACTIVITY_BUCKETS = new Set(["arcade", "trampoline", "bowling", "escape"]);

const SCORE_WEIGHTS = {
  budget: 0.14,
  quality: 0.16,
  distance: 0.08,
  flow: 0.07,
  mood: 0.1,
  role: 0.11,
  moment: 0.1,
  transition: 0.09,
  strategy: 0.07,
  narrative: 0.08,
  budgetAlignment: 0.04,
  activity: 0.04,
  firstStop: 0.02,
};

const MOOD_CONFIG = {
  romantic: {
    pace: "slow",
    layering: { enabled: true, role: "transition", insertIndex: 2 },
    bucketWeights: { activity: 0.12, cafe: 0.82, restaurant: 1.0, outdoor: 0.92, dessert: 0.95, fast_food: -1.0 },
    budgetSplit: { activity: 0.12, food: 0.54, dessert: 0.22, outdoor: 0.12 },
    rolePlan: {
      breakfast: ["arrival", "main_experience", "dessert"],
      lunch: ["main_experience", "transition", "dessert_finish"],
      snacks: ["arrival", "transition", "highlight"],
      dinner: ["arrival", "main_experience", "dessert_finish"],
    },
    tagWeights: {
      sea_view: 1.0,
      scenic: 0.92,
      rooftop: 0.8,
      quiet: 0.64,
      aesthetic: 0.74,
      cozy: 0.6,
      crowded: -0.78,
      fast_food: -0.85,
      lively: -0.16,
    },
  },
  fun: {
    pace: "fast",
    layering: { enabled: true, role: "snack_break", insertIndex: 2 },
    bucketWeights: { activity: 1.0, cafe: 0.5, restaurant: 0.42, outdoor: 0.35, dessert: 0.45, fast_food: 0.15 },
    budgetSplit: { activity: 0.42, food: 0.38, dessert: 0.14, outdoor: 0.06 },
    rolePlan: {
      breakfast: ["activity_burst", "food_anchor", "snack_break"],
      lunch: ["activity_burst", "food_anchor", "dessert_finish"],
      snacks: ["activity_burst", "snack_break", "dessert_finish"],
      dinner: ["activity_burst", "food_anchor", "dessert_finish"],
    },
    tagWeights: {
      activity: 0.94,
      lively: 0.82,
      unique: 0.56,
      group_friendly: 0.54,
      quiet: -0.2,
      crowded: -0.14,
      fast_food: -0.08,
    },
  },
  chill: {
    pace: "slow",
    layering: { enabled: true, role: "settle", insertIndex: 2 },
    bucketWeights: { activity: 0.26, cafe: 0.95, restaurant: 0.58, outdoor: 0.94, dessert: 0.62, fast_food: -0.12 },
    budgetSplit: { activity: 0.18, food: 0.42, dessert: 0.18, outdoor: 0.22 },
    rolePlan: {
      breakfast: ["settle", "arrival", "highlight"],
      lunch: ["settle", "transition", "highlight"],
      snacks: ["settle", "arrival", "dessert_finish"],
      dinner: ["settle", "transition", "highlight"],
    },
    tagWeights: {
      quiet: 0.96,
      cozy: 0.86,
      scenic: 0.62,
      aesthetic: 0.66,
      crowded: -0.58,
      lively: -0.3,
      fast_food: -0.24,
    },
  },
  adventure: {
    pace: "medium",
    layering: { enabled: false, role: "transition", insertIndex: 1 },
    bucketWeights: { activity: 1.0, cafe: 0.3, restaurant: 0.36, outdoor: 0.78, dessert: 0.22, fast_food: 0.06 },
    budgetSplit: { activity: 0.58, food: 0.28, dessert: 0.08, outdoor: 0.06 },
    rolePlan: {
      breakfast: ["activity_burst", "arrival", "food_anchor"],
      lunch: ["activity_burst", "arrival", "food_anchor"],
      snacks: ["activity_burst", "transition", "dessert_finish"],
      dinner: ["activity_burst", "food_anchor", "highlight"],
    },
    tagWeights: {
      activity: 0.96,
      unique: 0.74,
      outdoor: 0.72,
      scenic: 0.34,
      cozy: -0.08,
      crowded: -0.18,
      fast_food: -0.08,
    },
  },
};

const MOOD_WEIGHTS = Object.fromEntries(
  Object.entries(MOOD_CONFIG).map(([mood, config]) => [mood, config.bucketWeights])
);

const BUDGET_SPLIT = Object.fromEntries(
  Object.entries(MOOD_CONFIG).map(([mood, config]) => [mood, config.budgetSplit])
);

const FLOW_PATTERNS = {
  romantic: ["low", "medium", "low"],
  fun: ["high", "medium", "low"],
  chill: ["low", "low", "medium"],
  adventure: ["high", "medium", "medium"],
};

const EVENING_START_MINS = 18 * 60;

const ENERGY_BY_BUCKET = {
  activity: "high",
  outdoor: "medium",
  restaurant: "medium",
  cafe: "low",
  dessert: "low",
};

const ROLE_RULES = {
  arrival: {
    buckets: ["outdoor", "cafe"],
    preferTags: ["scenic", "quiet", "aesthetic", "cozy"],
    avoidTags: ["crowded"],
  },
  settle: {
    buckets: ["cafe", "outdoor"],
    preferTags: ["quiet", "cozy", "aesthetic"],
    avoidTags: ["crowded", "lively"],
  },
  main_experience: {
    buckets: ["restaurant", "activity"],
    preferTags: ["aesthetic", "cozy", "group_friendly"],
    avoidTags: ["fast_food"],
  },
  transition: {
    buckets: ["cafe", "outdoor"],
    preferTags: ["quiet", "aesthetic", "scenic"],
    avoidTags: ["crowded"],
  },
  activity_burst: {
    buckets: ["activity", "outdoor"],
    preferTags: ["activity", "lively", "unique"],
    avoidTags: ["quiet"],
  },
  food_anchor: {
    buckets: ["restaurant", "cafe"],
    preferTags: ["cozy", "group_friendly", "aesthetic"],
    avoidTags: ["fast_food"],
  },
  snack_break: {
    buckets: ["cafe", "outdoor"],
    preferTags: ["dessert", "aesthetic", "cozy"],
    avoidTags: ["crowded"],
  },
  dessert_finish: {
    buckets: ["cafe", "restaurant"],
    preferDessert: true,
    preferTags: ["dessert", "cozy", "aesthetic"],
    avoidTags: ["crowded"],
  },
  highlight: {
    buckets: ["outdoor", "restaurant", "cafe"],
    preferTags: ["sea_view", "scenic", "rooftop", "aesthetic"],
    avoidTags: ["crowded", "fast_food"],
  },
};

function getMoodProfile(mood) {
  return MOOD_CONFIG[mood] || MOOD_CONFIG.fun;
}

function getMoodRoleSequence(mood, mealWindow) {
  const profile = getMoodProfile(mood);
  return profile.rolePlan[mealWindow] || profile.rolePlan.dinner;
}

function getMoodPaceMultiplier(mood) {
  const pace = getMoodProfile(mood).pace;
  if (pace === "slow") return 1.2;
  if (pace === "fast") return 0.88;
  return 1;
}

function getRoleFitScore(place, role) {
  const rule = ROLE_RULES[role];
  if (!rule) return 0.5;

  let score = 0.15;
  const tags = place.semantic_tags || {};
  const bucket = place.isDessert ? "cafe" : place.normalized_bucket;

  if (rule.buckets.includes(bucket)) score += 0.42;
  if (rule.preferDessert && place.isDessert) score += 0.28;

  for (const tag of rule.preferTags || []) {
    score += getTagScore(tags, tag) * 0.09;
  }
  for (const tag of rule.avoidTags || []) {
    score -= getTagScore(tags, tag) * 0.12;
  }

  return clamp01(score);
}

function scoreRoleSequence(combo, mood, mealWindow) {
  const roles = getMoodRoleSequence(mood, mealWindow);
  let total = 0;
  for (let i = 0; i < combo.length; i++) {
    const role = roles[Math.min(i, roles.length - 1)];
    total += getRoleFitScore(combo[i], role);
  }
  return clamp01(total / combo.length);
}

function estimateStayMinutes(place, mood) {
  const paceMul = getMoodPaceMultiplier(mood);
  let base = 70;
  if (place.normalized_bucket === "outdoor") base = 42;
  else if (place.normalized_bucket === "restaurant") base = 82;
  else if (place.normalized_bucket === "cafe") base = place.isDessert ? 46 : 58;
  return Math.max(28, Math.round(base * paceMul));
}

function estimateComboStartTimes(combo, startMins, hop1, hop2, mood) {
  const t1 = startMins;
  const t2 = t1 + estimateStayMinutes(combo[0], mood) + Math.max(5, Math.round((hop1 / 15) * 60));
  const t3 = t2 + estimateStayMinutes(combo[1], mood) + Math.max(5, Math.round((hop2 / 15) * 60));
  return [t1, t2, t3];
}

function isNearSunset(mins) {
  return mins >= 17 * 60 + 20 && mins <= 19 * 60 + 10;
}

function isPeakCrowdHour(mins) {
  const h = Math.floor(mins / 60) % 24;
  return (h >= 12 && h <= 14) || (h >= 19 && h <= 21);
}

function extractReviewKeywordSignals(rawText) {
  const text = normalizeText(rawText);
  if (!text) {
    return {
      romantic: 0,
      crowded: 0,
      peaceful: 0,
      view: 0,
      aesthetic: 0,
      noisy: 0,
      cozy: 0,
      lively: 0,
    };
  }

  function scoreFromKeywords(keywords, cap = 4) {
    let hits = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) hits += 1;
    }
    return clamp01(hits / cap);
  }

  return {
    romantic: scoreFromKeywords(["romantic", "date", "couple", "candle", "intimate"], 3),
    crowded: scoreFromKeywords(["crowded", "packed", "rush", "busy", "queue", "line"], 4),
    peaceful: scoreFromKeywords(["peaceful", "calm", "serene", "quiet", "relax"], 3),
    view: scoreFromKeywords(["view", "sunset", "sea", "waterfront", "scenic"], 3),
    aesthetic: scoreFromKeywords(["aesthetic", "beautiful", "pretty", "ambience", "decor"], 4),
    noisy: scoreFromKeywords(["noisy", "loud", "chaotic", "blaring"], 3),
    cozy: scoreFromKeywords(["cozy", "comfy", "warm", "intimate", "snug"], 3),
    lively: scoreFromKeywords(["lively", "energetic", "vibrant", "party", "happening"], 4),
  };
}

function getPersonalizationBoost(place, mood, memory) {
  const profile = getUserProfile(memory);
  const tags = place.semantic_tags || {};
  let boost = 0;

  if (profile.prefers_quiet) {
    boost += getTagScore(tags, "quiet") * 0.18;
    boost -= getTagScore(tags, "lively") * 0.08;
  }
  if (profile.dislikes_crowds) {
    boost -= getTagScore(tags, "crowded") * 0.2;
  }
  if (profile.prefers_scenic) {
    boost += getTagScore(tags, "scenic") * 0.14;
  }

  if (profile.budget_style === "premium") {
    boost += getTagScore(tags, "aesthetic") * 0.1 + (place.isTrendy ? 0.06 : 0);
  } else if (profile.budget_style === "value") {
    const expensive = (place.estimated_cost || 0) >= 0 ? clamp01((place.estimated_cost || 0) / 1800) : 0;
    boost -= expensive * 0.08;
  }

  if (mood === "romantic") {
    boost += getTagScore(tags, "romantic") * 0.12;
  }

  return boost;
}

function getTagScore(tags, key) {
  if (!tags) return 0;
  const score = tags.tag_scores?.[key];
  if (typeof score === "number") return clamp01(score);
  return tags[key] ? 1 : 0;
}

function isTagEnabled(tags, key, threshold = 0.5) {
  return getTagScore(tags, key) >= threshold;
}

function getRoleMomentScore(place, role, mood, timeMins) {
  const tags = place.semantic_tags || {};
  const scenic = getTagScore(tags, "scenic");
  const seaView = getTagScore(tags, "sea_view");
  const aesthetic = getTagScore(tags, "aesthetic");
  const cozy = getTagScore(tags, "cozy");
  const crowded = getTagScore(tags, "crowded");

  let score = 0.35;
  if (role === "highlight") {
    score += scenic * 0.34 + seaView * 0.24 + aesthetic * 0.16;
    if (mood === "romantic" && isNearSunset(timeMins)) {
      score += (scenic + seaView) * 0.28;
    }
  }
  if (role === "transition") {
    score += cozy * 0.22 + aesthetic * 0.12;
  }
  if (role === "main_experience" && mood === "romantic") {
    score += cozy * 0.16 + aesthetic * 0.14;
  }

  score -= crowded * 0.2;
  return clamp01(score);
}

function scoreTransitionContinuity(combo, mood, hop1, hop2, mealWindow) {
  const maxHop = 8;
  const distanceContinuity = clamp01(1 - ((hop1 + hop2) / 2) / maxHop);

  function vibeVector(place) {
    const tags = place.semantic_tags || {};
    return {
      scenic: getTagScore(tags, "scenic"),
      cozy: getTagScore(tags, "cozy"),
      lively: getTagScore(tags, "lively"),
      quiet: getTagScore(tags, "quiet"),
      aesthetic: getTagScore(tags, "aesthetic"),
      crowded: getTagScore(tags, "crowded"),
    };
  }

  function similarity(a, b) {
    const keys = Object.keys(a);
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (const k of keys) {
      dot += a[k] * b[k];
      aa += a[k] * a[k];
      bb += b[k] * b[k];
    }
    const denom = Math.sqrt(aa) * Math.sqrt(bb);
    if (denom <= 1e-6) return 0.5;
    return clamp01(dot / denom);
  }

  const v1 = vibeVector(combo[0]);
  const v2 = vibeVector(combo[1]);
  const v3 = vibeVector(combo[2]);
  const vibeContinuity = (similarity(v1, v2) + similarity(v2, v3)) / 2;

  const energyTarget = FLOW_PATTERNS[mood] || FLOW_PATTERNS.fun;
  const energies = combo.map((place) => toEnergyBand(place));
  let pacingMatches = 0;
  for (let i = 0; i < 3; i++) {
    if (energies[i] === energyTarget[i]) pacingMatches += 1;
  }
  let pacingContinuity = pacingMatches / 3;
  if (mealWindow === "snacks" && energies[0] === "high" && mood === "chill") pacingContinuity -= 0.15;
  pacingContinuity = clamp01(pacingContinuity);

  return clamp01(distanceContinuity * 0.34 + vibeContinuity * 0.4 + pacingContinuity * 0.26);
}

function scoreAdaptiveBudgetStrategy(combo, mood, totalCost, mealWindow) {
  if (!totalCost) return { score: 0.5, softPenalty: 0 };

  const roles = getMoodRoleSequence(mood, mealWindow);
  let mainIdx = roles.findIndex((role) => role === "main_experience" || role === "food_anchor");
  if (mainIdx < 0) {
    mainIdx = combo.findIndex((place) => place.normalized_bucket === "restaurant");
  }
  if (mainIdx < 0) mainIdx = 0;

  const mainPlace = combo[Math.min(mainIdx, combo.length - 1)];
  const mainShare = clamp01((mainPlace?.estimated_cost || 0) / Math.max(totalCost, 1));
  const mainQuality = clamp01(mainPlace?.quality_score || 0.5);

  const profile = getMoodProfile(mood);
  const baselineMain = clamp01((profile.budgetSplit?.food || 0.45) * 0.82);
  const strategyTarget = mainQuality < 0.62 ? clamp01(baselineMain + 0.08) : baselineMain;
  const strategyScore = clamp01(1 - Math.abs(mainShare - strategyTarget) / Math.max(strategyTarget, 0.1));

  let softPenalty = 0;
  if (mainQuality < 0.56 && mainShare < strategyTarget - 0.05) softPenalty += 0.12;
  if (mood === "romantic" && mainPlace?.normalized_bucket !== "restaurant" && mealWindow !== "snacks") softPenalty += 0.08;

  return { score: strategyScore, softPenalty };
}

function scoreNarrativeArc(combo, mood, mealWindow, startMins, hop1, hop2) {
  const roles = getMoodRoleSequence(mood, mealWindow);
  const times = estimateComboStartTimes(combo, startMins, hop1, hop2, mood);

  let roleProgression = 0;
  for (let i = 0; i < combo.length; i++) {
    const role = roles[Math.min(i, roles.length - 1)] || "transition";
    roleProgression += getRoleFitScore(combo[i], role);
  }
  roleProgression = clamp01(roleProgression / combo.length);

  const highlightIdx = combo.length - 1;
  const highlightRole = roles[Math.min(highlightIdx, roles.length - 1)] || "highlight";
  const climaxStrength = getRoleMomentScore(combo[highlightIdx], highlightRole, mood, times[highlightIdx]);

  const travelBalance = clamp01(1 - Math.abs(hop1 - hop2) / Math.max(1, hop1 + hop2));
  const energy = combo.map((place) => toEnergyBand(place));
  const target = FLOW_PATTERNS[mood] || FLOW_PATTERNS.fun;
  let pacingMatch = 0;
  for (let i = 0; i < 3; i++) {
    if (energy[i] === target[i]) pacingMatch += 1;
  }
  const pacingBalance = clamp01((pacingMatch / 3) * 0.7 + travelBalance * 0.3);

  return clamp01(roleProgression * 0.38 + climaxStrength * 0.38 + pacingBalance * 0.24);
}

function isValidForMood(place, mood, mealWindow, role = "") {
  const tags = place.semantic_tags || {};

  if (mood === "romantic") {
    if (isTagEnabled(tags, "fast_food", 0.45)) return false;
    if (isTagEnabled(tags, "crowded", 0.72) && !isTagEnabled(tags, "scenic", 0.6) && role !== "main_experience") return false;
    if (role === "transition" && place.normalized_bucket === "restaurant") return false;
    if (role === "dessert_finish" && !(place.isDessert || place.normalized_bucket === "cafe")) return false;
    if (role === "highlight") {
      const momentDriven = isTagEnabled(tags, "scenic", 0.62) || isTagEnabled(tags, "sea_view", 0.58) || isTagEnabled(tags, "rooftop", 0.6);
      if (!momentDriven) return false;
    }
  }

  if (mood === "chill") {
    if (role === "settle" && place.normalized_bucket === "activity") return false;
    if (isTagEnabled(tags, "lively", 0.72) && isTagEnabled(tags, "crowded", 0.72)) return false;
  }

  if (mood === "adventure") {
    if (role === "activity_burst" && place.normalized_bucket === "cafe" && !place.isDessert) return false;
  }

  if (mealWindow === "snacks" && role === "main_experience" && place.normalized_bucket === "activity") {
    return false;
  }

  return true;
}

function getBucket(name) {
  const n = name.toLowerCase();
  for (const [bucket, keywords] of Object.entries(EXPERIENCE_BUCKETS)) {
    if (keywords.some(k => n.includes(k))) return bucket;
  }
  return "other";
}

function isActivityBucket(bucket) {
  return ACTIVITY_BUCKETS.has(bucket);
}

function isDessertName(name) {
  const lower = name.toLowerCase();
  return DESSERT_KEYWORDS.some((token) => lower.includes(token));
}

function getMealWindow(startMins) {
  if (startMins >= 6 * 60 && startMins < 11 * 60) return "breakfast";
  if (startMins >= 11 * 60 && startMins < 16 * 60) return "lunch";
  if (startMins >= 16 * 60 && startMins < 19 * 60) return "snacks";
  return "dinner";
}

function estimatePlaceCosts(bucket, flags, budget, placeName = "", mood = "fun") {
  const varietyFactor = 0.82 + deterministicHash01(`${placeName}|${bucket}|${mood}`) * 0.42;
  let spendBase = COST_MAP[bucket] ?? 400;
  let entryCost = 0;

  if (bucket === "restaurant") {
    const target = mood === "romantic" ? budget * 0.54 : budget * 0.46;
    spendBase = Math.max(spendBase, Math.round(target));
  }

  if (bucket === "cafe") {
    const cafeBase = mood === "romantic" ? budget * 0.24 : budget * 0.2;
    spendBase = Math.max(spendBase, Math.round(cafeBase));
  }

  if (flags.isDessert) spendBase = Math.max(spendBase, 220);
  if (flags.isCheapChain && (bucket === "restaurant" || bucket === "cafe")) {
    spendBase = Math.round(Math.max(220, Math.min(340, budget * 0.24)));
  }

  if (flags.isTrendy && (bucket === "restaurant" || bucket === "cafe")) {
    spendBase = Math.round(Math.max(spendBase, budget * 0.48));
  }

  if (bucket !== "outdoor") {
    spendBase = Math.round(spendBase * varietyFactor);
  }

  if (isActivityBucket(bucket)) {
    const activityFloor = budget >= 1200
      ? budget * (0.22 + deterministicHash01(`${placeName}|activity_floor`) * 0.16)
      : budget * (0.18 + deterministicHash01(`${placeName}|activity_floor`) * 0.12);
    const targetTotal = Math.round(Math.max(spendBase, activityFloor));
    entryCost = Math.round(targetTotal * 0.65);
    spendBase = Math.max(80, targetTotal - entryCost);
  }

  // Outdoor is always free in core itinerary pricing.
  if (bucket === "outdoor") {
    entryCost = 0;
    spendBase = 0;
  }

  const spend_cost = Math.max(0, Math.min(spendBase, budget));
  const entry_cost = Math.max(0, Math.min(entryCost, budget));
  const estimated_cost = Math.max(0, Math.min(entry_cost + spend_cost, budget));

  return {
    entry_cost,
    spend_cost,
    estimated_cost,
  };
}

function getOutdoorOptionalAddOns(budget, mood) {
  const moodMul = mood === "romantic" ? 1.1 : mood === "adventure" ? 1.05 : 1;
  const snacks = Math.max(60, Math.min(180, Math.round(budget * 0.06 * moodMul)));
  const parking = Math.max(30, Math.min(120, Math.round(budget * 0.04)));
  const transport = Math.max(70, Math.min(220, Math.round(budget * 0.08)));
  return { snacks, parking, transport };
}

function formatOptionalAddOns(addOns) {
  if (!addOns) return "";
  const snacks = Number(addOns.snacks || 0);
  const parking = Number(addOns.parking || 0);
  const transport = Number(addOns.transport || 0);
  return `snacks ₹${snacks}, parking ₹${parking}, transport ₹${transport}`;
}

function buildTimelineExtensions({
  mood,
  area,
  areaKey,
  budget,
  budgetRemaining,
  endTimeMins,
  itinerary,
  allValid,
}) {
  if (budgetRemaining <= budget * 0.2) return [];
  if (endTimeMins >= EVENING_START_MINS) return [];

  const extensions = [];
  let extensionBudget = Math.max(0, budgetRemaining);

  const lastOutdoor = [...itinerary].reverse().find((p) => p.normalized_bucket === "outdoor" || p.isScenic || p.isLandmark);
  const fallbackLandmark = areaKey ? LANDMARK_FALLBACKS[areaKey] : null;
  const sunsetSpot = lastOutdoor || (fallbackLandmark
    ? {
        name: fallbackLandmark.name,
        bucket: "outdoor",
        normalized_bucket: "outdoor",
        address: fallbackLandmark.address,
        lat: fallbackLandmark.lat,
        lng: fallbackLandmark.lng,
      }
    : null);

  if (sunsetSpot) {
    extensions.push({
      name: `Sunset at ${sunsetSpot.name} (intentional revisit)`,
      bucket: "outdoor",
      normalized_bucket: "outdoor",
      estimated_cost: 0,
      entry_cost: 0,
      spend_cost: 0,
      optional_costs: getOutdoorOptionalAddOns(budget, mood),
      address: sunsetSpot.address || `${area}, Mumbai`,
      lat: sunsetSpot.lat,
      lng: sunsetSpot.lng,
      duration: 40,
      earliest_start_mins: 17 * 60 + 30,
      is_extension: true,
    });
  }

  const existingNames = new Set(itinerary.map((p) => normalizeText(p.name)));
  const cafeBreak = allValid
    .filter((p) => p.normalized_bucket === "cafe" && !existingNames.has(normalizeText(p.name)))
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))[0];

  if (cafeBreak && extensionBudget >= 150) {
    const spendCap = Math.max(140, Math.min(260, Math.round(extensionBudget * 0.35)));
    const cafeCost = Math.min(
      cafeBreak.spend_cost || cafeBreak.estimated_cost || 220,
      spendCap,
      extensionBudget
    );

    extensions.push({
      ...cafeBreak,
      name: `Short cafe break: ${cafeBreak.name}`,
      estimated_cost: Math.max(0, Math.round(cafeCost)),
      entry_cost: 0,
      spend_cost: Math.max(0, Math.round(cafeCost)),
      duration: 35,
      is_extension: true,
    });

    extensionBudget -= Math.max(0, Math.round(cafeCost));
  }

  const chaiCost = Math.max(40, Math.min(100, Math.round(budget * 0.04)));
  if (extensionBudget >= chaiCost) {
    extensions.push({
      name: `Street-side chai + walk`,
      bucket: "cafe",
      normalized_bucket: "cafe",
      estimated_cost: chaiCost,
      entry_cost: 0,
      spend_cost: chaiCost,
      address: `Near ${area}, Mumbai`,
      duration: 25,
      is_extension: true,
    });
  }

  return extensions.slice(0, 3);
}

function pickWeightedPlanVariant(variants) {
  if (!variants.length) return null;
  const bestScore = variants[0].score;
  const weights = variants.map((variant) => Math.exp((variant.score - bestScore) / 0.08));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return variants[0];

  let roll = Math.random() * total;
  for (let i = 0; i < variants.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return variants[i];
  }
  return variants[variants.length - 1];
}

function applyLivePriceVariation(itinerary, budget) {
  const varied = itinerary.map((place) => {
    if (place.normalized_bucket === "outdoor") {
      return { ...place, estimated_cost: 0, entry_cost: 0, spend_cost: 0 };
    }

    const base = Math.max(0, Number(place.estimated_cost || 0));
    if (base === 0) return place;

    const quality = clamp01(place.quality_score || 0.5);
    const deterministic = 0.95 + deterministicHash01(`${place.name}|${place.bucket}|price`) * 0.08;
    const qualityLift = 0.95 + quality * 0.1;
    const marketNoise = 0.98 + Math.random() * 0.04;
    const factor = deterministic * qualityLift * marketNoise;
    const next = Math.max(60, Math.round(base * factor));
    const entryRatio = base > 0 ? (place.entry_cost || 0) / base : 0;
    const entry = Math.max(0, Math.round(next * entryRatio));
    const spend = Math.max(0, next - entry);
    return {
      ...place,
      estimated_cost: next,
      entry_cost: entry,
      spend_cost: spend,
    };
  });

  const total = varied.reduce((sum, place) => sum + (place.estimated_cost || 0), 0);
  if (total <= budget) return varied;

  const paidTotal = varied
    .filter((place) => place.normalized_bucket !== "outdoor")
    .reduce((sum, place) => sum + (place.estimated_cost || 0), 0);
  if (paidTotal <= 0) return varied;

  const overflow = total - budget;
  const scale = Math.max(0.78, (paidTotal - overflow) / paidTotal);

  return varied.map((place) => {
    if (place.normalized_bucket === "outdoor") return place;
    const scaled = Math.max(60, Math.round((place.estimated_cost || 0) * scale));
    const entryRatio = (place.estimated_cost || 0) > 0 ? (place.entry_cost || 0) / place.estimated_cost : 0;
    const entry = Math.max(0, Math.round(scaled * entryRatio));
    const spend = Math.max(0, scaled - entry);
    return {
      ...place,
      estimated_cost: scaled,
      entry_cost: entry,
      spend_cost: spend,
    };
  });
}

function applyAdaptiveBudgetReallocation(itinerary, mood, mealWindow, budget) {
  if (!itinerary.length) return itinerary;

  const roles = getMoodRoleSequence(mood, mealWindow);
  let mainIdx = roles.findIndex((role) => role === "main_experience" || role === "food_anchor");
  if (mainIdx < 0) mainIdx = itinerary.findIndex((place) => place.normalized_bucket === "restaurant");
  if (mainIdx < 0) mainIdx = 0;
  if (mainIdx >= itinerary.length) mainIdx = itinerary.length - 1;

  const adjusted = itinerary.map((place) => ({ ...place }));
  const main = adjusted[mainIdx];
  const mainQuality = clamp01(main.quality_score || 0.5);
  if (mainQuality >= 0.62) return adjusted;

  const total = adjusted.reduce((sum, place) => sum + (place.estimated_cost || 0), 0);
  if (total <= 0) return adjusted;

  const baseTarget = clamp01((getMoodProfile(mood).budgetSplit?.food || 0.45) * 0.82);
  const targetShare = clamp01(baseTarget + 0.08);
  const currentMain = main.estimated_cost || 0;
  const targetMain = Math.min(budget, Math.round(total * targetShare));

  if (currentMain >= targetMain) return adjusted;

  let needed = targetMain - currentMain;
  const remainingBudget = Math.max(0, budget - total);
  if (remainingBudget > 0) {
    const topUp = Math.min(needed, remainingBudget);
    main.estimated_cost += topUp;
    main.spend_cost = Math.max(0, (main.spend_cost || 0) + topUp);
    needed -= topUp;
  }

  if (needed <= 0) return adjusted;

  function minFloor(place) {
    if (place.normalized_bucket === "restaurant") return 220;
    if (place.normalized_bucket === "activity") return 260;
    if (place.normalized_bucket === "cafe") return place.isDessert ? 120 : 140;
    return 0;
  }

  for (let i = 0; i < adjusted.length; i++) {
    if (i === mainIdx) continue;
    const donor = adjusted[i];
    if (donor.normalized_bucket === "outdoor") continue;

    const floor = minFloor(donor);
    const available = Math.max(0, (donor.estimated_cost || 0) - floor);
    if (available <= 0) continue;

    const transfer = Math.min(available, needed);
    donor.estimated_cost -= transfer;

    const donorEntryRatio = (donor.entry_cost || 0) > 0 && donor.estimated_cost + transfer > 0
      ? (donor.entry_cost || 0) / (donor.estimated_cost + transfer)
      : 0;
    donor.entry_cost = Math.max(0, Math.round(donor.estimated_cost * donorEntryRatio));
    donor.spend_cost = Math.max(0, donor.estimated_cost - donor.entry_cost);

    main.estimated_cost += transfer;
    main.spend_cost = Math.max(0, (main.spend_cost || 0) + transfer);
    needed -= transfer;

    if (needed <= 0) break;
  }

  return adjusted;
}

function getComboShape(combo) {
  return combo
    .map((place) => (place.isDessert ? "dessert" : place.normalized_bucket))
    .join("->");
}

function getFlowShapeBonus(combo, mood, mealWindow) {
  const shape = getComboShape(combo);
  const key = `${mood}:${mealWindow}`;
  const templates = {
    "romantic:lunch": ["restaurant->dessert->outdoor", "outdoor->restaurant->dessert", "cafe->outdoor->dessert"],
    "romantic:dinner": ["outdoor->restaurant->dessert", "restaurant->dessert->outdoor"],
    "fun:lunch": ["activity->restaurant->dessert", "outdoor->restaurant->dessert", "activity->cafe->dessert"],
    "fun:snacks": ["activity->cafe->dessert", "outdoor->cafe->dessert", "activity->outdoor->dessert"],
    "chill:lunch": ["outdoor->cafe->dessert", "cafe->outdoor->dessert", "restaurant->outdoor->dessert"],
    "adventure:lunch": ["activity->restaurant->dessert", "activity->outdoor->restaurant", "outdoor->restaurant->dessert"],
  };

  const preferred = templates[key] || templates[`${mood}:dinner`] || [];
  const roleScore = scoreRoleSequence(combo, mood, mealWindow);

  if (!preferred.length) {
    return roleScore * 0.05;
  }

  const idx = preferred.indexOf(shape);
  if (idx === 0) return 0.05 + roleScore * 0.04;
  if (idx > 0) return 0.02 + roleScore * 0.03;
  return roleScore * 0.02;
}

function scoreFlow(combo, mealWindow) {
  const [first, second, third] = combo;
  let score = 0;

  const firstIsActive = first.normalized_bucket === "activity" || first.normalized_bucket === "outdoor";
  const secondIsMeal = second.normalized_bucket === "restaurant" || second.normalized_bucket === "cafe";
  const thirdIsDessertish = third.isDessert || third.normalized_bucket === "cafe";

  if (mealWindow === "breakfast") {
    if (first.normalized_bucket === "cafe") score += 120;
    if (second.normalized_bucket === "activity" || second.normalized_bucket === "outdoor") score += 90;
    if (thirdIsDessertish) score += 80;
  } else if (mealWindow === "lunch") {
    if (firstIsActive) score += 140;
    if (secondIsMeal) score += 140;
    if (thirdIsDessertish) score += 120;
    if (first.normalized_bucket === "outdoor" && secondIsMeal && thirdIsDessertish) score += 180;
  } else {
    if (firstIsActive) score += 100;
    if (second.normalized_bucket === "restaurant") score += 150;
    if (thirdIsDessertish) score += 110;
  }

  if (first.isDessert) score -= 200;
  if ((mealWindow === "lunch" || mealWindow === "dinner") && second.isDessert) score -= 140;
  if (third.normalized_bucket === "outdoor") score -= 180;
  if (second.normalized_bucket === "outdoor") score -= 80;

  return score;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function deterministicHash01(value) {
  let hash = 2166136261;
  const input = String(value || "");
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000000) / 1000000;
}

function normalizeFromRange(value, min, max) {
  if (max <= min) return 0;
  return clamp01((value - min) / (max - min));
}

function toEnergyBand(place) {
  if (place.isDessert) return "low";
  return ENERGY_BY_BUCKET[place.normalized_bucket] || "medium";
}

function flowScoreNormalized(combo, mood, mealWindow) {
  const target = FLOW_PATTERNS[mood] || FLOW_PATTERNS.fun;
  const energies = combo.map((place) => toEnergyBand(place));
  let match = 0;
  for (let i = 0; i < 3; i++) {
    if (energies[i] === target[i]) match += 1;
  }

  // Keep existing directional logic as a supporting signal, but normalize it.
  const heuristicFlow = scoreFlow(combo, mealWindow);
  const heuristicNorm = normalizeFromRange(heuristicFlow, -260, 420);
  const patternNorm = match / 3;
  return clamp01(patternNorm * 0.65 + heuristicNorm * 0.35);
}

function desiredActivityCount(mood, budget) {
  if (mood === "adventure") return budget >= 1800 ? 2 : 1;
  if (mood === "fun") return budget >= 2200 ? 2 : budget >= 1200 ? 1 : 0;
  if (mood === "romantic") return budget >= 2400 ? 1 : 0;
  if (mood === "chill") return budget >= 2000 ? 1 : 0;
  return 0;
}

function placeMoodScore(place, mood, memory) {
  const profile = getMoodProfile(mood);
  const weights = MOOD_WEIGHTS[mood] || MOOD_WEIGHTS.fun;
  const bucketKey = place.isDessert ? "dessert" : place.normalized_bucket;
  let score = weights[bucketKey] ?? 0;
  if (place.isFastFood) score += weights.fast_food ?? 0;
  const semantic = place.semantic_tags || inferSemanticTags(place);
  for (const [tag, weight] of Object.entries(profile.tagWeights || {})) {
    score += getTagScore(semantic, tag) * weight * 0.42;
  }
  score += getPersonalizationBoost(place, mood, memory);
  score += getPreferenceBoost(memory, mood, place);
  return Math.max(-1.8, Math.min(1.8, score));
}

function budgetCategoryForPlace(place) {
  if (place.isDessert) return "dessert";
  if (place.normalized_bucket === "activity") return "activity";
  if (place.normalized_bucket === "outdoor") return "outdoor";
  return "food";
}

function budgetAlignmentScore(combo, mood, totalCost) {
  if (!totalCost || totalCost <= 0) return 0.4;
  const target = getMoodProfile(mood).budgetSplit || BUDGET_SPLIT[mood] || BUDGET_SPLIT.fun;
  const actual = { activity: 0, food: 0, dessert: 0, outdoor: 0 };

  for (const place of combo) {
    const category = budgetCategoryForPlace(place);
    actual[category] += place.estimated_cost;
  }

  const normActual = {};
  for (const key of Object.keys(actual)) {
    normActual[key] = actual[key] / totalCost;
  }

  const keys = new Set([...Object.keys(target), ...Object.keys(normActual)]);
  let totalError = 0;
  for (const key of keys) {
    totalError += Math.abs((normActual[key] || 0) - (target[key] || 0));
  }

  return clamp01(1 - totalError / 2);
}

function getAreaKey(area) {
  const normalized = normalizeText(area);
  for (const key of Object.keys(LANDMARKS_BY_AREA)) {
    if (normalized.includes(key)) return key;
  }
  return null;
}

function getAreaLandmarks(area) {
  const key = getAreaKey(area);
  return key ? LANDMARKS_BY_AREA[key] || [] : [];
}

function hasCorporatePattern(name) {
  return CORPORATE_PATTERNS.some((pattern) => pattern.test(name));
}

function isScenicName(name) {
  const lower = normalizeText(name);
  return SCENIC_KEYWORDS.some((token) => lower.includes(token));
}

function isFastFoodName(name) {
  const lower = normalizeText(name);
  if (/\bmc\s*donald'?s?\b/.test(lower)) return true;
  return FAST_FOOD_BRANDS.some((token) => lower.includes(token));
}

function inferSemanticTags(place) {
  const name = normalizeText(place.name);
  const address = normalizeText(place.address || "");
  const rating = Number(place.rating || 0);
  const reviews = Number(place.review_count || 0);
  const reviewSignals = place.review_keyword_scores || {};

  const ratingNorm = rating > 0 ? clamp01((rating - 3.1) / 1.9) : 0.45;
  const reviewNorm = normalizeFromRange(Math.log10(reviews + 1), 0, 4.5);

  function fuse(nameSignal, typeSignal = 0, ratingSignal = 0, reviewSignal = 0) {
    return clamp01(nameSignal + typeSignal + ratingSignal + reviewSignal);
  }

  const seaName = /\b(sea|beach|seaface|seaside|coast|bay|marine|waterfront)\b/.test(name);
  const scenicName = /\b(view|sunset|promenade|waterfront|garden|fort|point)\b/.test(name);
  const rooftopName = /\brooftop\b/.test(name);
  const livelyName = /\b(bar|pub|club|social|arcade|gaming|lounge)\b/.test(name);
  const cozyName = /\b(cafe|bistro|dessert|patisserie|bakery|coffee|tea|brasserie)\b/.test(name);
  const uniqueName = /\b(art|museum|gallery|theme|vr|escape|trampoline|bowling|atelier|immersive)\b/.test(name);
  const likelyCrowdedName = /\b(mall|market|station|junction|metro|terminal|hub)\b/.test(name) || /\b(mall|station|junction|terminal)\b/.test(address);

  const seaViewScore = fuse(seaName ? 0.62 : 0, place.normalized_bucket === "outdoor" ? 0.14 : 0, ratingNorm * 0.08, reviewNorm * 0.06 + (reviewSignals.view || 0) * 0.18);
  const rooftopScore = fuse(rooftopName ? 0.72 : 0, place.normalized_bucket === "restaurant" || place.normalized_bucket === "cafe" ? 0.14 : 0, ratingNorm * 0.08, reviewNorm * 0.04 + (reviewSignals.aesthetic || 0) * 0.12);
  const scenicScore = clamp01(Math.max(seaViewScore, fuse(scenicName ? 0.56 : 0, place.normalized_bucket === "outdoor" ? 0.18 : 0, ratingNorm * 0.12, reviewNorm * 0.06 + (reviewSignals.view || 0) * 0.18), place.isLandmark ? 0.74 : 0, place.isScenic ? 0.7 : 0));
  const livelyScore = fuse(livelyName ? 0.58 : 0, place.normalized_bucket === "activity" ? 0.2 : 0, ratingNorm * 0.08, reviewNorm * 0.12 + (reviewSignals.lively || 0) * 0.16);
  const cozyScore = fuse(cozyName ? 0.52 : 0, place.normalized_bucket === "cafe" ? 0.18 : 0, ratingNorm * 0.14, reviewNorm * 0.06 + (reviewSignals.cozy || 0) * 0.18);
  const uniqueScore = fuse((place.isTrendy || uniqueName) ? 0.5 : 0, place.normalized_bucket === "activity" ? 0.2 : 0, ratingNorm * 0.12, reviewNorm * 0.06);
  const crowdedScore = clamp01((likelyCrowdedName ? 0.56 : 0.12) + reviewNorm * 0.34 + (place.distance_from_area_km < 1.1 ? 0.08 : 0) + (reviewSignals.crowded || 0) * 0.22 + (reviewSignals.noisy || 0) * 0.16);
  const quietScore = clamp01((cozyScore * 0.24) + (scenicScore * 0.2) + (ratingNorm * 0.22) - crowdedScore * 0.44 - livelyScore * 0.2 + (place.normalized_bucket === "outdoor" ? 0.06 : 0) + (reviewSignals.peaceful || 0) * 0.24);
  const aestheticScore = clamp01((place.isTrendy ? 0.3 : 0) + (rooftopScore * 0.34) + (scenicScore * 0.2) + (cozyScore * 0.14) + ratingNorm * 0.18 + (reviewSignals.aesthetic || 0) * 0.22);
  const groupFriendlyScore = clamp01((place.normalized_bucket === "activity" ? 0.42 : 0.18) + livelyScore * 0.24 + reviewNorm * 0.12 + (/\b(plaza|social|republic|gaming)\b/.test(name) ? 0.1 : 0));
  const dessertScore = clamp01((place.isDessert ? 0.62 : 0) + (/\b(ice cream|dessert|gelato|pastry|sweet)\b/.test(name) ? 0.28 : 0) + (place.normalized_bucket === "cafe" ? 0.08 : 0));
  const fastFoodScore = clamp01((place.isFastFood ? 0.72 : 0) + (/\b(burger|pizza|fried chicken|subway|fries)\b/.test(name) ? 0.2 : 0));
  const romanticScore = clamp01((reviewSignals.romantic || 0) * 0.55 + scenicScore * 0.2 + cozyScore * 0.16 + (place.normalized_bucket === "restaurant" ? 0.12 : 0));

  const tag_scores = {
    sea_view: seaViewScore,
    rooftop: rooftopScore,
    scenic: scenicScore,
    quiet: quietScore,
    aesthetic: aestheticScore,
    lively: livelyScore,
    cozy: cozyScore,
    unique: uniqueScore,
    group_friendly: groupFriendlyScore,
    crowded: crowdedScore,
    activity: place.normalized_bucket === "activity" ? 1 : 0,
    outdoor: place.normalized_bucket === "outdoor" ? 1 : 0,
    dessert: dessertScore,
    fast_food: fastFoodScore,
    romantic: romanticScore,
  };

  return {
    tag_scores,
    sea_view: tag_scores.sea_view >= 0.58,
    rooftop: tag_scores.rooftop >= 0.6,
    scenic: tag_scores.scenic >= 0.56,
    quiet: tag_scores.quiet >= 0.52,
    aesthetic: tag_scores.aesthetic >= 0.56,
    lively: tag_scores.lively >= 0.56,
    cozy: tag_scores.cozy >= 0.52,
    unique: tag_scores.unique >= 0.56,
    group_friendly: tag_scores.group_friendly >= 0.54,
    crowded: tag_scores.crowded >= 0.66,
    activity: tag_scores.activity >= 0.5,
    outdoor: tag_scores.outdoor >= 0.5,
    dessert: tag_scores.dessert >= 0.58,
    fast_food: tag_scores.fast_food >= 0.62,
    romantic: tag_scores.romantic >= 0.54,
  };
}

function computePlaceQuality(place, mood) {
  const name = place.name || "";
  const lowered = normalizeText(name);
  const words = lowered.split(" ").filter(Boolean);
  const semantic = place.semantic_tags || inferSemanticTags(place);
  const rating = Number(place.rating || 0);
  const reviewCount = Number(place.review_count || 0);
  const ratingNorm = rating > 0 ? clamp01((rating - 3.2) / 1.8) : 0.52;
  const reviewNorm = normalizeFromRange(Math.log10(reviewCount + 1), 0, 4.2);
  const distanceNorm = clamp01(1 - Number(place.distance_from_area_km || 0) / 5);

  const hasCorporate = hasCorporatePattern(name);
  const hasVenueCue = /\b(cafe|restaurant|kitchen|bistro|bar|dessert|bakery|lounge|arcade|trampoline|bowling|escape|park|beach|promenade)\b/i.test(name);
  const hardCorporateListing = /\b(brands\s+asia|corporate\s+office|head\s+office|registered\s+office)\b/i.test(name);
  const likelyCorporateListing = hasCorporate && !hasVenueCue;
  const longNamePenalty = words.length > 8 ? 0.25 : 0;
  const weakOutdoorPenalty = place.normalized_bucket === "outdoor" && !place.isScenic && !place.isLandmark ? 0.2 : 0;
  const fastFoodIntensity = getTagScore(semantic, "fast_food");
  const fastFoodPenalty = mood === "romantic" ? fastFoodIntensity * 0.45 : fastFoodIntensity * 0.2;

  const nameCleanliness = clamp01(1 - longNamePenalty - (hasCorporate ? 0.2 : 0) - (likelyCorporateListing ? 0.25 : 0));

  let categoryRelevance = 0.55;
  if (mood === "romantic") {
    if (place.normalized_bucket === "restaurant" || place.normalized_bucket === "cafe") categoryRelevance += 0.25;
    if (place.isScenic || place.isLandmark) categoryRelevance += 0.2;
  } else if (mood === "fun") {
    if (place.normalized_bucket === "activity") categoryRelevance += 0.3;
  } else if (mood === "adventure") {
    if (place.normalized_bucket === "activity") categoryRelevance += 0.35;
  } else if (mood === "chill") {
    if (place.normalized_bucket === "outdoor" || place.normalized_bucket === "cafe") categoryRelevance += 0.2;
  }

  const landmarkBonus = place.isLandmark ? 0.2 : 0;
  const uniqueness = getTagScore(semantic, "unique") * 0.14 + getTagScore(semantic, "dessert") * 0.07 + (place.isCheapChain ? 0.03 : 0);
  const scenicBonus = getTagScore(semantic, "scenic") * 0.14;
  const ambienceProxy = clamp01(
    getTagScore(semantic, "scenic") * 0.28 +
    getTagScore(semantic, "aesthetic") * 0.26 +
    getTagScore(semantic, "cozy") * 0.2 +
    getTagScore(semantic, "quiet") * 0.18
  );

  const qualityScore =
    nameCleanliness * 0.2 +
    clamp01(categoryRelevance) * 0.22 +
    clamp01(0.45 + landmarkBonus + scenicBonus) * 0.12 +
    ambienceProxy * 0.18 +
    ratingNorm * 0.14 +
    reviewNorm * 0.07 +
    distanceNorm * 0.07 +
    clamp01(0.45 + uniqueness) * 0.08 -
    fastFoodPenalty -
    weakOutdoorPenalty;

  return {
    qualityScore: Math.max(0, qualityScore),
    reject: hardCorporateListing || likelyCorporateListing || (mood === "romantic" && place.isFastFood),
    reason: hardCorporateListing || likelyCorporateListing
      ? "corporate_name"
      : mood === "romantic" && place.isFastFood
      ? "romantic_fast_food"
      : "",
  };
}

function scoreMomentQuality(combo, mood, startMins, hop1, hop2) {
  const [t1, t2, t3] = estimateComboStartTimes(combo, startMins, hop1, hop2, mood);
  const times = [t1, t2, t3];

  let delta = 0;
  for (let i = 0; i < combo.length; i++) {
    const place = combo[i];
    const tags = place.semantic_tags || {};
    const t = times[i];

    if (mood === "romantic") {
      if ((tags.sea_view || tags.scenic) && isNearSunset(t)) delta += 0.24;
      if (i === 0 && t >= 11 * 60 && t < 15 * 60 && place.normalized_bucket === "restaurant") delta += 0.14;
      if (i === combo.length - 1 && (place.isDessert || place.normalized_bucket === "cafe") && t >= 17 * 60) delta += 0.08;
    } else if (mood === "fun") {
      if (tags.lively && t >= 17 * 60) delta += 0.16;
      if (place.normalized_bucket === "activity") delta += 0.09;
    } else if (mood === "chill") {
      if (tags.quiet && t < 18 * 60) delta += 0.16;
      if (tags.scenic) delta += 0.1;
    } else if (mood === "adventure") {
      if (place.normalized_bucket === "activity") delta += 0.16;
      if (place.normalized_bucket === "outdoor" && t < 16 * 60) delta += 0.08;
    }
  }

  return clamp01(0.5 + delta);
}

function scoreCrowdPenalty(combo, mood, startMins, hop1, hop2) {
  const [t1, t2, t3] = estimateComboStartTimes(combo, startMins, hop1, hop2, mood);
  const times = [t1, t2, t3];
  let penalty = 0;

  for (let i = 0; i < combo.length; i++) {
    const place = combo[i];
    const tags = place.semantic_tags || {};
    if (tags.crowded && isPeakCrowdHour(times[i])) penalty += 0.08;
    if (mood === "romantic" && tags.crowded) penalty += 0.06;
    if (mood === "chill" && tags.lively) penalty += 0.04;
  }

  return penalty;
}

function shortlistCandidates(candidates) {
  const groups = {
    activity: [],
    restaurant: [],
    cafe: [],
    outdoor: [],
  };

  for (const candidate of candidates) {
    if (groups[candidate.normalized_bucket]) {
      groups[candidate.normalized_bucket].push(candidate);
    }
  }

  const limits = { activity: 16, restaurant: 14, cafe: 14, outdoor: 8 };
  const out = [];
  for (const key of Object.keys(groups)) {
    groups[key]
      .sort((a, b) => {
        const left = (b.quality_score || 0) + (b.isLandmark ? 0.2 : 0) + (b.isTrendy ? 0.08 : 0);
        const right = (a.quality_score || 0) + (a.isLandmark ? 0.2 : 0) + (a.isTrendy ? 0.08 : 0);
        return left - right;
      })
      .slice(0, limits[key])
      .forEach((item) => out.push(item));
  }

  const landmarkBoost = candidates
    .filter((item) => item.isLandmark)
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))
    .slice(0, 4);

  const merged = [...landmarkBoost, ...out]
    .filter((item, idx, arr) => arr.findIndex((v) => v.name.toLowerCase() === item.name.toLowerCase()) === idx)
    .slice(0, 42);

  return merged;
}

function isGoodFirstStop(place) {
  if (!place) return false;
  if (place.isLandmark || place.isScenic) return true;
  if (place.normalized_bucket === "activity") return true;
  if (place.normalized_bucket === "restaurant" || place.normalized_bucket === "cafe") {
    return !place.isFastFood || place.isTrendy;
  }
  return false;
}

// ── 3. Time Helpers ──
function parseTime(tStr) {
  const normalized = normalizeTimeInput(tStr);
  return normalized ? normalized.minutes : 17 * 60;
}

function normalizeTimeInput(input) {
  const value = String(input || "").trim().toLowerCase();
  const match = value.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  const hourRaw = Number.parseInt(match[1], 10);
  const minuteRaw = Number.parseInt(match[2] ?? "0", 10);
  const ampm = (match[3] || "").toLowerCase();

  if (!Number.isFinite(hourRaw) || !Number.isFinite(minuteRaw)) return null;
  if (minuteRaw < 0 || minuteRaw > 59) return null;

  let hour24 = hourRaw;
  if (ampm) {
    if (hourRaw < 1 || hourRaw > 12) return null;
    if (ampm === "pm" && hourRaw < 12) hour24 = hourRaw + 12;
    if (ampm === "am" && hourRaw === 12) hour24 = 0;
  } else {
    if (hourRaw < 0 || hourRaw > 23) return null;
  }

  return {
    minutes: hour24 * 60 + minuteRaw,
    label24: `${String(hour24).padStart(2, "0")}:${String(minuteRaw).padStart(2, "0")}`,
  };
}

function formatTime(totalMins) {
  let h = Math.floor(totalMins / 60) % 24;
  let m = totalMins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

// ── 4. Queries Pipeline ──
function getQueries(mood, budget, mealWindow, area) {
  let base = [];
  if (mood === "chill") base = ["trendy aesthetic cafe", "bookstore cafe", "art cafe"];
  else if (mood === "romantic") base = ["fine dining", "trendy rooftop cafe", "dessert cafe", "sea view dessert", "premium cafe"];
  else if (mood === "adventure") base = ["go karting", "escape room", "paintball", "climbing"];
  else base = ["arcade", "bowling alley", "trampoline park"]; // fun

  if (mealWindow === "breakfast") {
    base.push("breakfast cafe", "morning walk garden", "coffee and bakery");
  } else if (mealWindow === "lunch") {
    base.push("lunch restaurant", "afternoon activity", "dessert cafe");
  } else if (mealWindow === "snacks") {
    base.push("sunset point", "tea cafe", "evening snacks", "street food and dessert");
  } else {
    base.push("dinner restaurant", "night activity", "late dessert cafe");
  }

  // Priority trendy spots and chain anchors.
  base.push(...TRENDY_MUMBAI_SPOTS);
  base.push(...FAMOUS_CHAINS);

  const landmarks = getAreaLandmarks(area);
  if (landmarks.length > 0) {
    base.push(...landmarks);
    if (mood === "romantic") {
      base.push(...landmarks.map((landmark) => `${landmark} romantic walk`));
    }
  }

  // Inject free places heavily if budget is low
  if (budget <= 1200) {
    base.push("promenade", "public garden", "beach", "marine drive", "sea link view");
  } else {
    // Add casual dining and standard activities to ensure padding
    base.push("cafe", "casual dining");
  }
  // Keep query count controlled for faster generation.
  return [...new Set(base)].slice(0, 24);
}

function getSecondaryQueries(mood, mealWindow, area) {
  const base = [
    `${area} hidden gems`,
    `${area} best rated spots`,
    `${area} local favorites`,
    `${area} top places near me`,
  ];

  if (mood === "romantic") {
    base.push(
      `${area} romantic restaurant`,
      `${area} date cafe`,
      `${area} scenic walk`,
      `${area} sunset viewpoint`
    );
  } else if (mood === "chill") {
    base.push(
      `${area} quiet cafe`,
      `${area} peaceful spot`,
      `${area} cozy coffee`
    );
  } else if (mood === "fun") {
    base.push(
      `${area} gaming arcade`,
      `${area} fun activity`,
      `${area} lively hangout`
    );
  } else if (mood === "adventure") {
    base.push(
      `${area} adventure activity`,
      `${area} escape room`,
      `${area} outdoor experience`
    );
  }

  if (mealWindow === "lunch") base.push(`${area} lunch specials`, `${area} dessert place`);
  if (mealWindow === "snacks") base.push(`${area} tea and snacks`, `${area} evening cafe`);
  if (mealWindow === "dinner") base.push(`${area} dinner place`, `${area} late night cafe`);

  return [...new Set(base)].slice(0, 16);
}

// ── 5. Ola API Interfaces ──
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

async function fetchOlaResultsForQueries(queries, area, concurrency = 4) {
  const collected = [];
  let cursor = 0;

  async function worker() {
    while (cursor < queries.length) {
      const index = cursor++;
      const q = queries[index];
      const results = await olaSearch(`${q} ${area} Mumbai`);
      collected.push(...results);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queries.length) }, () => worker());
  await Promise.all(workers);
  return collected;
}

async function getTravelStats(p1, p2) {
  if (!p1.lat || !p2.lat) return { minutes: 15, distance: "2 km" };
  try {
    const url = `https://api.olamaps.io/routing/v1/directions?origin=${p1.lat},${p1.lng}&destination=${p2.lat},${p2.lng}&api_key=${OLA_KEY}`;
    const res = await fetch(url, { method: "POST", headers: { "X-Request-Id": "ola-route" }});
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      const leg = data.routes[0].legs[0];
      return {
        minutes: Math.round(leg.duration / 60),
        distance: (leg.distance / 1000).toFixed(1) + " km"
      };
    }
  } catch (err) {}
  // estimate based on haversine (15 kmph in mumbai traffic avg)
  const distKm = getDistanceInKm(p1.lat, p1.lng, p2.lat, p2.lng);
  return { minutes: Math.round((distKm / 15) * 60) + 5, distance: distKm.toFixed(1) + " km" };
}

// ── 6. Main Execution ──
async function run() {
  const { AREA, MOOD, BUDGET, START_TIME } = await promptUser();
  const preferenceMemory = loadPreferenceMemory();
  console.log(`\n🎯 Generating Itinerary for ${AREA} (Mood: ${MOOD}, Budget: ₹${BUDGET}, Start: ${START_TIME})\n`);
  const startMins = parseTime(START_TIME);
  const mealWindow = getMealWindow(startMins);
  console.log(`🧭 Meal window detected: ${mealWindow}`);

  // Step 0: Get Geocenter for the search AREA to block geographic drift (> 5KM)
  let centerLat = null, centerLng = null;
  const areaMatch = await olaSearch(`${AREA} Mumbai`);
  if (areaMatch.length > 0 && areaMatch[0].geometry) {
     centerLat = areaMatch[0].geometry.location.lat;
     centerLng = areaMatch[0].geometry.location.lng;
  } else {
     console.log(`❌ Could not resolve coordinates for area: ${AREA}. Exiting.`);
     process.exit(1);
  }

  const landmarksForArea = getAreaLandmarks(AREA);
  const queries = getQueries(MOOD, BUDGET, mealWindow, AREA);
  const rawCandidates = [];
  const seenNames = new Set();
  const rejectedByQuality = {};

  console.log(`┌─ Fetching + Filtering tight geographic radius places from Ola Maps...`);
  const rawResults = await fetchOlaResultsForQueries(queries, AREA, 4);

  function ingestCandidateResult(r, maxRadiusKm) {
    if (!r.geometry || !r.geometry.location) return;
    const lat = r.geometry.location.lat;
    const lng = r.geometry.location.lng;

    const dist = getDistanceInKm(centerLat, centerLng, lat, lng);
    if (dist > maxRadiusKm) return;

    const rawName = r.name || (r.structured_formatting && r.structured_formatting.main_text) || r.description;
    if (!rawName) return;

    if (/(parking|car park|motor|garage)/i.test(rawName) || /(parking|car park)/i.test(r.description || "")) return;
    if (/\bveg\b/i.test(rawName) && !/non(\s|-)?veg/i.test(rawName)) return;

    const clean = cleanName(rawName);
    const key = normalizeText(clean);
    if (!key || seenNames.has(key)) return;

    const bucket = getBucket(clean);
    if (bucket === "other") return;

    seenNames.add(key);

    const isTrendy = TRENDY_MUMBAI_SPOTS.some((v) => key.includes(v));
    const isCheapChain = FAMOUS_CHAINS.some((v) => key.includes(v));
    const isDessert = isDessertName(clean);
    const isLandmark = landmarksForArea.some((token) => key.includes(normalizeText(token)));
    const isScenic = isScenicName(clean);
    const isFastFood = isFastFoodName(clean);

    const normalized_bucket = isActivityBucket(bucket) ? "activity" : bucket;
    const costs = estimatePlaceCosts(bucket, { isTrendy, isCheapChain, isDessert, isScenic }, BUDGET, clean, MOOD);
    if (costs.estimated_cost > BUDGET) return;

    const rating = Number.parseFloat(String(r.rating ?? r.user_rating ?? r.score ?? "0")) || 0;
    const review_count = Number.parseInt(String(r.user_ratings_total ?? r.review_count ?? r.num_reviews ?? "0"), 10) || 0;
    const reviewTextParts = [];
    if (Array.isArray(r.reviews)) {
      for (const reviewItem of r.reviews) {
        if (typeof reviewItem === "string") reviewTextParts.push(reviewItem);
        else if (reviewItem && typeof reviewItem === "object") {
          reviewTextParts.push(String(reviewItem.text || reviewItem.comment || reviewItem.snippet || ""));
        }
      }
    }
    if (typeof r.editorial_summary === "string") reviewTextParts.push(r.editorial_summary);
    if (r.editorial_summary && typeof r.editorial_summary === "object") {
      reviewTextParts.push(String(r.editorial_summary.overview || ""));
    }
    reviewTextParts.push(String(r.description || ""));
    const review_keyword_scores = extractReviewKeywordSignals(reviewTextParts.join(" "));

    const place = {
      name: clean,
      bucket,
      normalized_bucket,
      isTrendy,
      isCheapChain,
      isDessert,
      isLandmark,
      isScenic,
      isFastFood,
      estimated_cost: costs.estimated_cost,
      entry_cost: costs.entry_cost,
      spend_cost: costs.spend_cost,
      rating,
      review_count,
      review_keyword_scores,
      distance_from_area_km: dist,
      optional_costs: normalized_bucket === "outdoor" ? getOutdoorOptionalAddOns(BUDGET, MOOD) : null,
      address: (r.description || clean).replace(/,\s*Mumbai Suburban.*$/, ''),
      lat,
      lng,
    };
    place.semantic_tags = inferSemanticTags(place);

    if (!isValidForMood(place, MOOD, mealWindow)) {
      rejectedByQuality.mood_hard_filter = (rejectedByQuality.mood_hard_filter || 0) + 1;
      return;
    }

    const quality = computePlaceQuality(place, MOOD);
    if (quality.reject) {
      const reason = quality.reason || "low_quality";
      rejectedByQuality[reason] = (rejectedByQuality[reason] || 0) + 1;
      return;
    }

    const qualityPenalty = quality.qualityScore < 0.34
      ? clamp01((0.34 - quality.qualityScore) / 0.34)
      : 0;

    rawCandidates.push({
      ...place,
      quality_score: quality.qualityScore,
      quality_penalty: qualityPenalty,
    });
  }

  for (const r of rawResults) ingestCandidateResult(r, 5.0);

  if (rawCandidates.length < 9) {
    const secondaryQueries = getSecondaryQueries(MOOD, mealWindow, AREA);
    const secondaryResults = await fetchOlaResultsForQueries(secondaryQueries, AREA, 3);
    for (const r of secondaryResults) ingestCandidateResult(r, 8.0);
  }

  const hasLandmarkCandidate = rawCandidates.some((place) => place.isLandmark || place.isScenic);
  if (!hasLandmarkCandidate) {
    const areaKey = getAreaKey(AREA);
    const fallbackLandmark = areaKey ? LANDMARK_FALLBACKS[areaKey] : null;
    if (fallbackLandmark) {
      const dist = getDistanceInKm(centerLat, centerLng, fallbackLandmark.lat, fallbackLandmark.lng);
      if (dist <= 7.5) {
        rawCandidates.push({
          name: fallbackLandmark.name,
          bucket: "outdoor",
          normalized_bucket: "outdoor",
          isTrendy: false,
          isCheapChain: false,
          isDessert: false,
          isLandmark: true,
          isScenic: true,
          isFastFood: false,
          estimated_cost: 0,
          entry_cost: 0,
          spend_cost: 0,
          optional_costs: getOutdoorOptionalAddOns(BUDGET, MOOD),
          address: fallbackLandmark.address,
          lat: fallbackLandmark.lat,
          lng: fallbackLandmark.lng,
          rating: 4.5,
          review_count: 1200,
          distance_from_area_km: dist,
          semantic_tags: {
            sea_view: true,
            rooftop: false,
            scenic: true,
            quiet: true,
            aesthetic: true,
            lively: false,
            cozy: false,
            unique: true,
            group_friendly: true,
            crowded: false,
            activity: false,
            outdoor: true,
            dessert: false,
            fast_food: false,
          },
          quality_score: 0.92,
          quality_penalty: 0,
        });
      }
    }
  }

  console.log(`│  Queries: ${queries.length} | Raw hits: ${rawResults.length} | Candidates kept: ${rawCandidates.length}`);
  if (Object.keys(rejectedByQuality).length) {
    console.log(`│  Quality rejects: ${JSON.stringify(rejectedByQuality)}`);
  }

  const allValid = shortlistCandidates(rawCandidates);
  console.log(`│  Shortlisted for planning: ${allValid.length}`);

  let itinerary = [];

  const TARGET_UTILIZATION = (BUDGET >= 1500 ? 0.94 : BUDGET >= 1000 ? 0.9 : 0.85) * BUDGET;
  const MIN_UTILIZATION = BUDGET >= 1500 ? 0.88 : BUDGET >= 1000 ? 0.82 : 0.72;
  const MIN_ACTIVITY_COUNT = BUDGET >= 2200 ? 2 : BUDGET >= 1200 ? 1 : 0;
  const MAX_TRAVEL_PER_HOP_KM = 8;

  const distanceMatrix = Array.from({ length: allValid.length }, () => Array(allValid.length).fill(0));
  for (let i = 0; i < allValid.length; i++) {
    for (let j = i + 1; j < allValid.length; j++) {
      const d = getDistanceInKm(allValid[i].lat, allValid[i].lng, allValid[j].lat, allValid[j].lng);
      distanceMatrix[i][j] = d;
      distanceMatrix[j][i] = d;
    }
  }

  function hopDistance(placeA, placeB) {
    if (typeof placeA._idx !== "number" || typeof placeB._idx !== "number") {
      return getDistanceInKm(placeA.lat, placeA.lng, placeB.lat, placeB.lng);
    }
    return distanceMatrix[placeA._idx][placeB._idx];
  }

  allValid.forEach((item, idx) => {
    item._idx = idx;
  });

  function pickBestItinerary(minActivityCount, minUtilization) {
    const variants = [];

    for (let i = 0; i < allValid.length - 2; i++) {
      for (let j = i + 1; j < allValid.length - 1; j++) {
        for (let k = j + 1; k < allValid.length; k++) {
          const spot1 = allValid[i];
          const spot2 = allValid[j];
          const spot3 = allValid[k];

          const permutations = [
            [spot1, spot2, spot3], [spot1, spot3, spot2],
            [spot2, spot1, spot3], [spot2, spot3, spot1],
            [spot3, spot1, spot2], [spot3, spot2, spot1]
          ];

          for (const combo of permutations) {
            const [c1, c2, c3] = combo;
            const normalizedBuckets = [c1.normalized_bucket, c2.normalized_bucket, c3.normalized_bucket];
            const roles = getMoodRoleSequence(MOOD, mealWindow);

            let roleHardReject = false;
            for (let idx = 0; idx < combo.length; idx++) {
              const role = roles[Math.min(idx, roles.length - 1)] || "transition";
              if (!isValidForMood(combo[idx], MOOD, mealWindow, role)) {
                roleHardReject = true;
                break;
              }
            }
            if (roleHardReject) continue;

            const outdoorCount = normalizedBuckets.filter((b) => b === "outdoor").length;
            if (outdoorCount > 1) continue;

            const activityCount = normalizedBuckets.filter((b) => b === "activity").length;
            const restaurantCount = normalizedBuckets.filter((b) => b === "restaurant").length;
            const dessertLikeCount = [c1, c2, c3].filter((p) => p.isDessert || (p.normalized_bucket === "cafe" && p.semantic_tags?.dessert)).length;
            const desiredActivities = Math.max(minActivityCount, desiredActivityCount(MOOD, BUDGET));

            const totalCost = c1.estimated_cost + c2.estimated_cost + c3.estimated_cost;
            const utilization = totalCost / BUDGET;
            if (totalCost > BUDGET) continue;
            if (utilization < 0.55) continue;

            const hop1 = hopDistance(c1, c2);
            const hop2 = hopDistance(c2, c3);
            if (hop1 > MAX_TRAVEL_PER_HOP_KM || hop2 > MAX_TRAVEL_PER_HOP_KM) continue;

            const hasMeal = normalizedBuckets.includes("restaurant") || normalizedBuckets.includes("cafe");
            const hasProperMeal = [c1, c2, c3].some(
              (p) => p.normalized_bucket === "restaurant" || (p.normalized_bucket === "cafe" && !p.isDessert)
            );

            const firstStopScore = isGoodFirstStop(c1) ? 1 : 0;
            const qualityBase = (c1.quality_score + c2.quality_score + c3.quality_score) / 3;
            const qualityPenalty = ((c1.quality_penalty || 0) + (c2.quality_penalty || 0) + (c3.quality_penalty || 0)) / 3;
            const qualityScore = clamp01(qualityBase - qualityPenalty * 0.8);

            const avgHop = (hop1 + hop2) / 2;
            const distanceScore = clamp01(1 - avgHop / MAX_TRAVEL_PER_HOP_KM);

            const flowScore = flowScoreNormalized(combo, MOOD, mealWindow);

            const moodRaw = (
              placeMoodScore(c1, MOOD, preferenceMemory) +
              placeMoodScore(c2, MOOD, preferenceMemory) +
              placeMoodScore(c3, MOOD, preferenceMemory)
            ) / 3;
            const moodScore = clamp01((moodRaw + 1.8) / 3.6);

            const roleScore = scoreRoleSequence(combo, MOOD, mealWindow);
            const momentScore = scoreMomentQuality(combo, MOOD, startMins, hop1, hop2);
            const crowdPenalty = scoreCrowdPenalty(combo, MOOD, startMins, hop1, hop2);
            const transitionScore = scoreTransitionContinuity(combo, MOOD, hop1, hop2, mealWindow);
            const adaptiveBudget = scoreAdaptiveBudgetStrategy(combo, MOOD, totalCost, mealWindow);
            const narrativeScore = scoreNarrativeArc(combo, MOOD, mealWindow, startMins, hop1, hop2);

            const roleTimes = estimateComboStartTimes(combo, startMins, hop1, hop2, MOOD);
            let roleDominancePenalty = 0;
            let roleDominanceHardReject = false;
            for (let idx = 0; idx < combo.length; idx++) {
              const role = roles[Math.min(idx, roles.length - 1)] || "transition";
              const roleMoment = getRoleMomentScore(combo[idx], role, MOOD, roleTimes[idx]);

              if (role === "highlight" && roleMoment < 0.46) {
                roleDominanceHardReject = true;
                break;
              }
              if (role === "main_experience" && MOOD === "romantic" && roleMoment < 0.3) {
                roleDominancePenalty += 0.06;
              }
              if (role === "highlight") {
                roleDominancePenalty += (1 - roleMoment) * 0.06;
              }
            }
            if (roleDominanceHardReject) continue;

            const targetUtilRatio = TARGET_UTILIZATION / Math.max(BUDGET, 1);
            const budgetCloseness = clamp01(1 - Math.abs(utilization - targetUtilRatio) / Math.max(targetUtilRatio, 0.01));
            const underUtilPenalty = utilization < minUtilization ? (minUtilization - utilization) / Math.max(minUtilization, 0.01) : 0;
            const budgetScore = clamp01(budgetCloseness - underUtilPenalty * 0.7);

            const allocationScore = budgetAlignmentScore(combo, MOOD, totalCost);
            const activityScore = desiredActivities > 0
              ? clamp01(activityCount / desiredActivities)
              : clamp01(1 - Math.max(0, activityCount - 1) * 0.25);

            let softPenalty = 0;
            if (!hasMeal) softPenalty += 0.25;
            if ((mealWindow === "lunch" || mealWindow === "dinner") && !hasProperMeal) softPenalty += 0.22;
            if ((mealWindow === "lunch" || mealWindow === "dinner") && !(c2.normalized_bucket === "restaurant" || c2.normalized_bucket === "cafe")) {
              softPenalty += 0.12;
            }
            if (mealWindow === "snacks" && !(c2.normalized_bucket === "cafe" || c2.normalized_bucket === "outdoor" || c2.isDessert)) {
              softPenalty += 0.1;
            }
            if (activityCount < desiredActivities) {
              softPenalty += 0.18 * (desiredActivities - activityCount);
            }
            if ((MOOD === "romantic" || MOOD === "chill") && restaurantCount > 1) {
              softPenalty += 0.16 * (restaurantCount - 1);
            }
            if (MOOD === "romantic" && dessertLikeCount === 0) {
              softPenalty += 0.1;
            }
            if (MOOD === "romantic" && !(c1.isScenic || c2.isScenic || c3.isScenic || c1.isLandmark || c2.isLandmark || c3.isLandmark)) {
              softPenalty += 0.12;
            }
            if (MOOD === "chill" && c1.normalized_bucket === "activity") {
              softPenalty += 0.14;
            }
            if (MOOD === "chill" && activityCount > 1) {
              softPenalty += 0.18 * (activityCount - 1);
            }
            if (MOOD === "romantic" && (c1.isFastFood || c2.isFastFood || c3.isFastFood)) {
              softPenalty += 0.45;
            }
            if (c1.isDessert) softPenalty += 0.18;
            if (c1.normalized_bucket === "outdoor" && !c1.isScenic && !c1.isLandmark) softPenalty += 0.2;
            if (normalizedBuckets.filter((b) => b === "cafe").length === 3) softPenalty += 0.12;

            const weightedScore =
              SCORE_WEIGHTS.budget * budgetScore +
              SCORE_WEIGHTS.quality * qualityScore +
              SCORE_WEIGHTS.distance * distanceScore +
              SCORE_WEIGHTS.flow * flowScore +
              SCORE_WEIGHTS.mood * moodScore +
              SCORE_WEIGHTS.role * roleScore +
              SCORE_WEIGHTS.moment * momentScore +
              SCORE_WEIGHTS.transition * transitionScore +
              SCORE_WEIGHTS.strategy * adaptiveBudget.score +
              SCORE_WEIGHTS.narrative * narrativeScore +
              SCORE_WEIGHTS.budgetAlignment * allocationScore +
              SCORE_WEIGHTS.activity * activityScore +
              SCORE_WEIGHTS.firstStop * firstStopScore;

            const landmarkBoost = (c1.isLandmark || c2.isLandmark || c3.isLandmark) ? 0.06 : 0;
            const scenicBoost = (c1.isScenic || c2.isScenic || c3.isScenic) ? 0.04 : 0;
            const shapeBonus = getFlowShapeBonus(combo, MOOD, mealWindow);
            const score = weightedScore + landmarkBoost + (MOOD === "romantic" ? scenicBoost : 0) + shapeBonus - softPenalty - crowdPenalty - adaptiveBudget.softPenalty - roleDominancePenalty;

            variants.push({
              combo: [c1, c2, c3],
              score,
              shape: getComboShape(combo),
            });
          }
        }
      }
    }

    if (!variants.length) return [];
    variants.sort((a, b) => b.score - a.score);

    const bestScore = variants[0].score;
    const pool = [];
    const seenShapes = new Set();
    for (const variant of variants) {
      if (variant.score < bestScore - 0.2) break;
      if (pool.length >= 18) break;
      if (seenShapes.has(variant.shape) && pool.length >= 6) continue;
      seenShapes.add(variant.shape);
      pool.push(variant);
    }

    const picked = pickWeightedPlanVariant(pool);
    return picked ? picked.combo : variants[0].combo;
  }

  itinerary = pickBestItinerary(MIN_ACTIVITY_COUNT, MIN_UTILIZATION);
  if (itinerary.length === 0) {
    itinerary = pickBestItinerary(Math.max(0, MIN_ACTIVITY_COUNT - 1), 0.76);
  }
  if (itinerary.length === 0) {
    itinerary = pickBestItinerary(0, 0.72);
  }

  function applyRomanticLandmarkUpgrade(current) {
    if (MOOD !== "romantic" || current.length !== 3 || landmarksForArea.length === 0) {
      return current;
    }

    const alreadyHasLandmark = current.some((place) => place.isLandmark || place.isScenic);
    if (alreadyHasLandmark) return current;

    const candidates = allValid
      .filter((place) => place.isLandmark || place.isScenic)
      .filter((place) => !place.isFastFood)
      .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));

    if (!candidates.length) return current;

    const weakOutdoorIdx = current.findIndex((p) => p.normalized_bucket === "outdoor" && !p.isScenic && !p.isLandmark);
    const fallbackIdx = current
      .map((p, idx) => ({ idx, q: p.quality_score || 0, protected: p.isDessert }))
      .filter((p) => !p.protected)
      .sort((a, b) => a.q - b.q)[0]?.idx;

    const replaceIdx = weakOutdoorIdx >= 0 ? weakOutdoorIdx : (typeof fallbackIdx === "number" ? fallbackIdx : 0);

    for (const landmark of candidates) {
      if (current.some((p) => normalizeText(p.name) === normalizeText(landmark.name))) continue;

      const updated = [...current];
      updated[replaceIdx] = landmark;

      const cost = updated.reduce((sum, item) => sum + item.estimated_cost, 0);
      if (cost > BUDGET) continue;

      const d1 = hopDistance(updated[0], updated[1]);
      const d2 = hopDistance(updated[1], updated[2]);
      if (d1 > MAX_TRAVEL_PER_HOP_KM || d2 > MAX_TRAVEL_PER_HOP_KM) continue;

      if (!isGoodFirstStop(updated[0])) continue;
      return updated;
    }

    return current;
  }

  function maybeAddLayeredStop(current) {
    const profile = getMoodProfile(MOOD);
    const layering = profile.layering || { enabled: false };
    if (!layering.enabled || current.length !== 3) return current;

    const currentCost = current.reduce((sum, place) => sum + place.estimated_cost, 0);
    const remainingBudget = BUDGET - currentCost;
    if (remainingBudget < Math.max(130, Math.round(BUDGET * 0.12))) return current;

    const insertIndex = Math.max(1, Math.min(current.length - 1, Number(layering.insertIndex || 1)));
    const prev = current[insertIndex - 1];
    const next = current[insertIndex];
    if (!prev || !next) return current;

    const role = layering.role || "transition";
    const used = new Set(current.map((place) => normalizeText(place.name)));
    const candidates = allValid
      .filter((place) => !used.has(normalizeText(place.name)))
      .filter((place) => place.estimated_cost <= remainingBudget)
      .filter((place) => !(MOOD === "romantic" && place.isFastFood))
      .filter((place) => getRoleFitScore(place, role) >= 0.56)
      .map((place) => {
        const semantic = place.semantic_tags || inferSemanticTags(place);
        const semanticBoost =
          (semantic.scenic ? 0.14 : 0) +
          (semantic.aesthetic ? 0.1 : 0) +
          (semantic.cozy ? 0.08 : 0) +
          (semantic.quiet ? 0.06 : 0);
        const score =
          (place.quality_score || 0) * 0.56 +
          getRoleFitScore(place, role) * 0.24 +
          clamp01((placeMoodScore(place, MOOD, preferenceMemory) + 1.8) / 3.6) * 0.14 +
          semanticBoost;
        return { place, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    for (const candidate of candidates) {
      const place = candidate.place;
      const d1 = hopDistance(prev, place);
      const d2 = hopDistance(place, next);
      if (d1 > MAX_TRAVEL_PER_HOP_KM || d2 > MAX_TRAVEL_PER_HOP_KM) continue;

      const inserted = [...current.slice(0, insertIndex), place, ...current.slice(insertIndex)];
      const outdoorCount = inserted.filter((item) => item.normalized_bucket === "outdoor").length;
      if (outdoorCount > 1) continue;

      const insertedCost = inserted.reduce((sum, item) => sum + item.estimated_cost, 0);
      if (insertedCost > BUDGET) continue;
      return inserted;
    }

    return current;
  }

  function ensureMinimumCoreStops(current) {
    const out = [...current];
    const used = new Set(out.map((place) => normalizeText(place.name)));
    const targetRoles = getMoodRoleSequence(MOOD, mealWindow);

    function remainingBudget() {
      const spent = out.reduce((sum, place) => sum + place.estimated_cost, 0);
      return Math.max(0, BUDGET - spent);
    }

    const extras = [...allValid]
      .filter((place) => !used.has(normalizeText(place.name)))
      .sort((a, b) => {
        const roleA = targetRoles[Math.min(out.length, targetRoles.length - 1)] || "transition";
        const roleB = roleA;
        const aScore =
          (a.quality_score || 0) +
          clamp01((placeMoodScore(a, MOOD, preferenceMemory) + 1.8) / 3.6) * 0.25 +
          getRoleFitScore(a, roleA) * 0.35;
        const bScore =
          (b.quality_score || 0) +
          clamp01((placeMoodScore(b, MOOD, preferenceMemory) + 1.8) / 3.6) * 0.25 +
          getRoleFitScore(b, roleB) * 0.35;
        if (bScore !== aScore) return bScore - aScore;
        return a.estimated_cost - b.estimated_cost;
      });

    for (const place of extras) {
      if (out.length >= 3) break;
      const budgetLeft = remainingBudget();
      if (budgetLeft < 40) break;

      const expectedRole = targetRoles[Math.min(out.length, targetRoles.length - 1)] || "transition";
      if (getRoleFitScore(place, expectedRole) < 0.46) continue;
      if ((MOOD === "romantic" || MOOD === "chill") && place.normalized_bucket === "restaurant") {
        const existingRestaurants = out.filter((p) => p.normalized_bucket === "restaurant").length;
        if (existingRestaurants >= 1) continue;
      }

      let candidate = place;
      if (candidate.estimated_cost > budgetLeft) {
        if ((candidate.normalized_bucket === "cafe" || candidate.normalized_bucket === "restaurant") && budgetLeft >= 120) {
          candidate = {
            ...candidate,
            entry_cost: 0,
            spend_cost: budgetLeft,
            estimated_cost: budgetLeft,
          };
        } else if (candidate.normalized_bucket === "outdoor") {
          candidate = {
            ...candidate,
            entry_cost: 0,
            spend_cost: 0,
            estimated_cost: 0,
          };
        } else {
          continue;
        }
      }

      out.push(candidate);
      used.add(normalizeText(candidate.name));
    }

    return out.slice(0, 4);
  }

  itinerary = applyRomanticLandmarkUpgrade(itinerary);

  if (itinerary.length === 0) {
    // Graceful fallback: dynamically build a diverse list under budget
    const sorted = [...rawCandidates].sort((a, b) => {
      const aScore = (a.isTrendy ? 2 : 0) + (a.normalized_bucket === "activity" ? 2 : 0) + (a.isDessert ? 0.5 : 0);
      const bScore = (b.isTrendy ? 2 : 0) + (b.normalized_bucket === "activity" ? 2 : 0) + (b.isDessert ? 0.5 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return b.estimated_cost - a.estimated_cost;
    });
    
    // Assemble only what fits!
    let currentCost = 0;
    const fallbackBuckets = new Set();
    let outdoorCount = 0;
    
    for (const c of sorted) {
       if (c.normalized_bucket === "outdoor" && outdoorCount >= 1) continue;
       // Only allow duplicate cafes, max 1 of other buckets to force diversity.
       if (fallbackBuckets.has(c.normalized_bucket) && c.normalized_bucket !== "cafe") continue;
       
       if (currentCost + c.estimated_cost <= BUDGET && itinerary.length < 3) {
           itinerary.push(c);
           fallbackBuckets.add(c.normalized_bucket);
           if (c.normalized_bucket === "outdoor") outdoorCount += 1;
           currentCost += c.estimated_cost;
       }
    }
  }

  itinerary = applyRomanticLandmarkUpgrade(itinerary);
  itinerary = maybeAddLayeredStop(itinerary);
  itinerary = ensureMinimumCoreStops(itinerary);

  if (itinerary.length === 0) {
    console.log("❌ CRITICAL: Budget is too low or area has zero valid locations to even assemble a partial schedule.");
    return;
  }

  if (itinerary.length < 3) {
    console.log("⚠️ Limited real POIs found after expansion; returning best available real stops.");
  }

  itinerary = applyAdaptiveBudgetReallocation(itinerary, MOOD, mealWindow, BUDGET);
  itinerary = applyLivePriceVariation(itinerary, BUDGET);

  updatePreferenceMemory(preferenceMemory, MOOD, itinerary, BUDGET);
  savePreferenceMemory(preferenceMemory);

  // Render Out
  console.log(`└─ Compiled & Deduplicated Itinerary Blueprint.\n`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`# Final Plan Overview`);
  
  let totalComputedCost = itinerary.reduce((acc, curr) => acc + curr.estimated_cost, 0);
  console.log(`Total estimated cost: ₹${totalComputedCost}\n`);
  
  let currentTime = parseTime(START_TIME);
  
  for (let i = 0; i < itinerary.length; i++) {
    const place = itinerary[i];
    
    // Approx 1 hour at each location (VR/Arcade usually 1hr, cafes 1-1.5hr)
    const duration = place.bucket === "outdoor" ? 45 : 75;

    console.log(`🕒 ${formatTime(currentTime)} — ${place.name} (${place.bucket})`);
    console.log(`    💰 Price: ₹${place.estimated_cost}`);
    if (place.normalized_bucket === "outdoor" && place.optional_costs) {
      console.log(`    ➕ Optional: ${formatOptionalAddOns(place.optional_costs)}`);
    }
    console.log(`    📍 Location: ${place.address}`);
    
    currentTime += duration; 

    if (i < itinerary.length - 1) {
      const nextPlace = itinerary[i+1];
      const travel = await getTravelStats(place, nextPlace);
      
      // Secondary check: Ola Maps real-time API says > 25 mins hop -> Warn but don't break
      const trafficWarning = travel.minutes > 25 ? " ⚠️ (Heavy Traffic Route)" : "";

      console.log();
      console.log(`  🚕 Ola Map Route to next stop: ~${travel.minutes} mins (${travel.distance})${trafficWarning}`);
      console.log();
      currentTime += travel.minutes; 
    }
  }

  const budgetRemaining = Math.max(0, BUDGET - totalComputedCost);
  const areaKey = getAreaKey(AREA);
  const extensionStops = buildTimelineExtensions({
    mood: MOOD,
    area: AREA,
    areaKey,
    budget: BUDGET,
    budgetRemaining,
    endTimeMins: currentTime,
    itinerary,
    allValid,
  });

  if (extensionStops.length > 0) {
    console.log();
    console.log(`# Optional Timeline Extension`);
    console.log(`Budget remaining before extension: ₹${budgetRemaining}`);

    let extensionSpend = 0;
    let previousStop = itinerary[itinerary.length - 1] || null;

    for (let i = 0; i < extensionStops.length; i++) {
      const ext = extensionStops[i];

      if (typeof ext.earliest_start_mins === "number" && currentTime < ext.earliest_start_mins) {
        console.log(`⏳ Flex gap until ${formatTime(ext.earliest_start_mins)} for rest/refresh.`);
        currentTime = ext.earliest_start_mins;
      }

      if (previousStop && ext.lat && ext.lng) {
        const toExt = await getTravelStats(previousStop, ext);
        const trafficWarning = toExt.minutes > 25 ? " ⚠️ (Heavy Traffic Route)" : "";
        console.log(`  🚕 Ola Map Route to extension: ~${toExt.minutes} mins (${toExt.distance})${trafficWarning}`);
        console.log();
        currentTime += toExt.minutes;
      }

      console.log(`🕒 ${formatTime(currentTime)} — ${ext.name} (${ext.bucket})`);
      console.log(`    💰 Price: ₹${ext.estimated_cost}`);
      if (ext.normalized_bucket === "outdoor" && ext.optional_costs) {
        console.log(`    ➕ Optional: ${formatOptionalAddOns(ext.optional_costs)}`);
      }
      console.log(`    📍 Location: ${ext.address || `Near ${AREA}, Mumbai`}`);

      extensionSpend += ext.estimated_cost || 0;
      currentTime += ext.duration || 30;
      previousStop = ext;
      console.log();
    }

    if (extensionSpend > 0) {
      console.log(`Projected total with extension: ₹${totalComputedCost + extensionSpend}`);
    }
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

run().catch(console.error);
