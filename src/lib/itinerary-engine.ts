import type { AIItineraryResponse, HubCandidate, ItineraryProfile, Mood, Place } from '@/types';
import { haversineDistance } from './transit';
import { scorePlaceBreakdown } from './scoring';
import { midpointCostRange } from './cost-model';

interface RankedPlace {
  place: Place;
  score: number;
  vibeScore: number;
}

interface MixState {
  foodStops: number;
  heavyMealStops: number;
}

interface BudgetTotals {
  stopCostTotal: number;
  contingencyBuffer: number;
  totalWithContingency: number;
}

const HUB_RADIUS_KM = 3.2;
const STEP_RADIUS_KM = 3.0;
const MAX_FLOW_SPREAD_KM = 3.4;
const MAX_FOOD_STOPS = 1;
const MAX_HEAVY_MEAL_STOPS = 1;
const MUMBAI_AVG_SPEED_KMH = 18;
const MAX_STEP_TRAVEL_MINS = 25;
const MAX_TOTAL_TRAVEL_MINS = 55;

// Strong activity keywords for forced injection
const STRONG_ACTIVITY_KEYWORDS_ENGINE = [
  'bowling', 'arcade', 'gaming', 'trampoline', 'escape', 'vr',
  'go kart', 'go-kart', 'gokart', 'laser tag', 'laser-tag',
  'board game', 'paintball', 'rock climbing', 'bouldering',
  'smaaash', 'timezone', 'fun city', 'bounce', 'mystery rooms',
  'breakout', 'lock n escape', 'game palacio', 'pvr', 'inox',
  'cinema', 'movie', 'theatre', 'theater', 'museum', 'zoo',
  'comedy', 'concert', 'live music', 'snow world', 'water park',
];

type DayPhase = 'morning' | 'afternoon' | 'evening';
type DominantVibe = 'calm' | 'social' | 'explore';

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSpecificRealPlace(place: Place): boolean {
  if (!place.name || place.name.trim().length < 3) return false;
  if (typeof place.lat !== 'number' || typeof place.lng !== 'number') return false;

  const text = normalizeText(`${place.name} ${place.description}`);
  const blocked = [
    'best places',
    'top places',
    'things to do',
    'places to visit',
    'near me',
    'guide to',
    'list of',
  ];

  return !blocked.some((term) => text.includes(term));
}

/** Checks if a place is a non-hangout activity (sports association, gymkhana, generic ground, etc.) */
function isWeakNonHangoutActivity(place: Place): boolean {
  if (place.type !== 'activity') return false;

  const text = normalizeText(`${place.name} ${place.description}`);
  const weakSignals =
    /\b(sports association|sports club|gymkhana|gymnasium|swimming pool|wrestling|akhada|stadium|athletic|sports complex|recreation ground|sports ground|playground|talim|vyayamshala|cricket ground|football ground|tennis court|badminton court|association|committee|mandal|sabha)\b/.test(text);

  if (weakSignals) {
    // Allow if it has strong entertainment sub-signals
    const hasEntertainment =
      /\b(arcade|bowling|trampoline|escape room|gaming|cinema|movie|theatre|theater|pvr|inox|museum|board game|comedy|event|ticketed|food court|timezone|smaaash|go.?kart|laser.?tag)\b/.test(text);
    return !hasEntertainment;
  }

  return false;
}

function inferCategoryLabel(place: Place): string {
  const text = normalizeText(`${place.name} ${place.description}`);

  if (/(ice cream|dessert|gelato|bakery|patisserie|sweet)/.test(text)) return 'dessert';
  if (/(cinema|theatre|theater|imax|movie|pvr|inox)/.test(text)) return 'movie';
  if (/(park|garden|promenade|seaface|seaside|beach|viewpoint|outdoor)/.test(text)) return 'park';
  if (place.type === 'cafe') return 'cafe';
  if (place.type === 'restaurant') return 'restaurant';
  if (place.type === 'outdoor') return 'park';
  return 'activity';
}

function blockedForMoodByName(place: Place, mood: Mood): boolean {
  const text = normalizeText(place.name);
  const padded = ` ${text} `;

  const alwaysBlocked = [
    'wine shop',
    'liquor',
    'permit room',
    'beer shop',
    'alcohol shop',
    'wine and more',
  ];

  if (alwaysBlocked.some((token) => text.includes(token))) {
    return true;
  }

  if (padded.includes(' wine ') || padded.includes(' wines ')) {
    return true;
  }

  const nonHangoutLandmarks = [
    ' shrine ',
    ' oratory ',
    ' bungalow ',
    ' memorial ',
    ' cemetery ',
    ' dargah ',
    ' fort gate ',
  ];
  if (nonHangoutLandmarks.some((token) => padded.includes(token))) {
    return true;
  }

  if (padded.includes(' house ') && !padded.includes(' coffee house ')) {
    return true;
  }

  if (mood === 'chill') {
    const chillBlocked = [
      ' bar ',
      ' pub ',
      ' nightclub',
      ' night club',
      ' lounge',
      ' taproom',
      ' brewery',
    ];
    if (chillBlocked.some((token) => padded.includes(token))) {
      return true;
    }
  }

  // Block generic non-hangout places regardless of mood
  const nonHangoutGeneric = [
    ' sports association ',
    ' sports club ',
    ' gymkhana ',
    ' recreation ground ',
    ' sports ground ',
    ' cricket ground ',
    ' football ground ',
  ];
  if (nonHangoutGeneric.some((token) => padded.includes(token))) {
    return true;
  }

  return false;
}

function isWeakShoppingOnlyActivity(place: Place): boolean {
  if (place.type !== 'activity') return false;

  const text = normalizeText(`${place.name} ${place.description}`);
  const shoppingSignals = /\b(mall|shopping centre|shopping center|shopping complex|plaza|market)\b/.test(text);
  if (!shoppingSignals) return false;

  const engagementSignals =
    /\b(arcade|bowling|trampoline|escape room|gaming|cinema|movie|theatre|theater|pvr|inox|food court|board game|event|comedy|concert|show|timezone|smaaash)\b/.test(
      text
    );

  return !engagementSignals;
}

function hasActionableMovieShowtime(place: Place): boolean {
  const text = `${place.name} ${place.description}`;
  return /\b([01]?\d|2[0-3]):[0-5]\d\b|\b(1[0-2]|[1-9])\s?(am|pm)\b/i.test(text);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(total: number): string {
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function estimateCost(place: Place, category: string, cap: number): number {
  if (place.cost_range) {
    const midpoint = midpointCostRange(place.cost_range);
    return Math.round(Math.max(60, Math.min(4000, midpoint)));
  }

  if (typeof place.estimated_cost === 'number' && Number.isFinite(place.estimated_cost) && place.estimated_cost > 0) {
    return Math.round(Math.max(60, Math.min(4000, place.estimated_cost)));
  }

  const ranges: Record<string, number> = {
    cafe: 300,
    activity: 520,
    restaurant: 640,
    dessert: 240,
    movie: 720,
    park: 90,
  };

  const fallback = ranges[category] ?? 350;
  const budgetAwareFallback = Math.min(Math.max(80, fallback), Math.max(250, Math.round(cap * 1.4)));
  return Math.round(Math.max(80, budgetAwareFallback));
}

function estimateStopCost(entry: RankedPlace, cap: number): number {
  return estimateCost(entry.place, inferCategoryLabel(entry.place), cap);
}

function computeBudgetTotals(entries: RankedPlace[], cap: number): BudgetTotals {
  const stopCostTotal = entries.reduce((sum, entry) => sum + estimateStopCost(entry, cap), 0);
  const contingencyBuffer = Math.round(stopCostTotal * 0.12);
  return {
    stopCostTotal,
    contingencyBuffer,
    totalWithContingency: stopCostTotal + contingencyBuffer,
  };
}

function hasConsecutiveFoodStops(entries: RankedPlace[]): boolean {
  for (let i = 1; i < entries.length; i += 1) {
    const prevIsFood = isFoodCategory(inferCategoryLabel(entries[i - 1].place));
    const currIsFood = isFoodCategory(inferCategoryLabel(entries[i].place));
    if (prevIsFood && currIsFood) return true;
  }

  return false;
}

function hasConsecutivePlaceTypes(entries: RankedPlace[]): boolean {
  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i - 1].place.type === entries[i].place.type) return true;
  }

  return false;
}

function outdoorTheme(place: Place): string {
  const text = normalizeText(`${place.name} ${place.description}`);
  if (/\b(promenade|seaface|beach|coast|waterfront|lake)\b/.test(text)) return 'waterfront';
  if (/\b(viewpoint|fort|museum|heritage)\b/.test(text)) return 'sightseeing';
  if (/\b(park|garden|udyan)\b/.test(text)) return 'park';
  return 'outdoor';
}

function activityTheme(place: Place): string {
  const text = normalizeText(`${place.name} ${place.description}`);
  if (/\b(arcade|gaming|bowling|trampoline|escape room|laser tag|kart)\b/.test(text)) return 'games';
  if (/\b(museum|fort|gallery|heritage|culture)\b/.test(text)) return 'culture';
  if (/\b(shopping|mall|market|plaza)\b/.test(text)) return 'shopping';
  return 'activity';
}

function repetitionTheme(entry: RankedPlace): string {
  const category = inferCategoryLabel(entry.place);
  if (category === 'park') return `park:${outdoorTheme(entry.place)}`;
  if (category === 'activity') return `activity:${activityTheme(entry.place)}`;
  return `category:${category}`;
}

function trimRepetitiveLeisureStops(entries: RankedPlace[], minStops: number): RankedPlace[] {
  let out = [...entries];

  while (out.length > 3 && out.length > minStops) {
    const counts = new Map<string, number>();
    for (const entry of out) {
      const theme = repetitionTheme(entry);
      counts.set(theme, (counts.get(theme) || 0) + 1);
    }

    const repeatedLeisureThemes = new Set(
      [...counts.entries()]
        .filter(([theme, count]) => count >= 2 && (theme.startsWith('park:') || theme.startsWith('activity:')))
        .map(([theme]) => theme)
    );

    if (repeatedLeisureThemes.size === 0) break;

    let removeIndex = -1;
    let lowestScore = Number.POSITIVE_INFINITY;
    for (let i = 1; i < out.length; i += 1) {
      const theme = repetitionTheme(out[i]);
      if (!repeatedLeisureThemes.has(theme)) continue;
      if (out[i].score < lowestScore) {
        lowestScore = out[i].score;
        removeIndex = i;
      }
    }

    if (removeIndex < 0) break;
    out = out.filter((_, idx) => idx !== removeIndex);
  }

  return out;
}

function computeStopBounds(ranked: RankedPlace[], profile: ItineraryProfile): {
  minStops: number;
  maxStops: number;
} {
  const baseMax = profile === 'activity_food' ? 4 : 3;
  const top = ranked.slice(0, 10);
  const categories = top.map((entry) => inferCategoryLabel(entry.place));
  const uniqueCategories = new Set(categories);
  const uniqueNonFood = new Set(categories.filter((category) => !isFoodCategory(category)));

  const lowDiversity = uniqueCategories.size <= 2 || uniqueNonFood.size === 0;
  if (lowDiversity) {
    return {
      minStops: 2,
      maxStops: Math.min(3, baseMax),
    };
  }

  return {
    minStops: 3,
    maxStops: baseMax,
  };
}

function canReplaceEntryForBudget(
  current: RankedPlace[],
  index: number,
  candidate: RankedPlace,
  perPersonCap: number
): boolean {
  const candidatePoint = {
    lat: Number(candidate.place.lat),
    lng: Number(candidate.place.lng),
  };

  if (index > 0) {
    const prevPoint = {
      lat: Number(current[index - 1].place.lat),
      lng: Number(current[index - 1].place.lng),
    };
    if (haversineDistance(prevPoint, candidatePoint) > STEP_RADIUS_KM * 1.15) return false;
  }

  if (index < current.length - 1) {
    const nextPoint = {
      lat: Number(current[index + 1].place.lat),
      lng: Number(current[index + 1].place.lng),
    };
    if (haversineDistance(candidatePoint, nextPoint) > STEP_RADIUS_KM * 1.15) return false;
  }

  const anchorPoint = {
    lat: Number(current[0].place.lat),
    lng: Number(current[0].place.lng),
  };
  if (haversineDistance(anchorPoint, candidatePoint) > MAX_FLOW_SPREAD_KM + 0.35) return false;

  const tentative = current.map((entry, idx) => (idx === index ? candidate : entry));
  if (hasConsecutiveFoodStops(tentative)) return false;
  if (hasConsecutivePlaceTypes(tentative)) return false;

  const currentCost = estimateStopCost(current[index], perPersonCap);
  const candidateCost = estimateStopCost(candidate, perPersonCap);
  if (candidateCost >= currentCost - 40) return false;

  const removingAnchor = isStrongSocialAnchor(current[index].place);
  if (removingAnchor) {
    const hasOtherAnchor = current.some((entry, idx) => idx !== index && isStrongSocialAnchor(entry.place));
    if (!hasOtherAnchor && !isStrongSocialAnchor(candidate.place)) return false;
  }

  return true;
}

function fitSelectionWithinBudget(
  selected: RankedPlace[],
  ranked: RankedPlace[],
  perPersonCap: number,
  minStops: number
): RankedPlace[] {
  let current = [...selected];

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const totals = computeBudgetTotals(current, perPersonCap);
    if (totals.totalWithContingency <= perPersonCap) return current;

    const expensiveIndices = current
      .map((entry, index) => ({ index, cost: estimateStopCost(entry, perPersonCap) }))
      .sort((a, b) => b.cost - a.cost);

    const usedKeys = new Set(current.map((entry) => normalizeText(entry.place.name)));
    let replaced = false;

    for (const target of expensiveIndices) {
      const targetCategory = inferCategoryLabel(current[target.index].place);
      const targetIsFood = isFoodCategory(targetCategory);

      const candidate = ranked
        .filter((entry) => !usedKeys.has(normalizeText(entry.place.name)))
        .filter((entry) => {
          const category = inferCategoryLabel(entry.place);
          if (category === targetCategory) return true;
          return isFoodCategory(category) && targetIsFood;
        })
        .filter((entry) => canReplaceEntryForBudget(current, target.index, entry, perPersonCap))
        .sort((a, b) => {
          const aCost = estimateStopCost(a, perPersonCap);
          const bCost = estimateStopCost(b, perPersonCap);
          if (aCost !== bCost) return aCost - bCost;
          return b.score - a.score;
        })[0];

      if (!candidate) continue;

      current = current.map((entry, idx) => (idx === target.index ? candidate : entry));
      replaced = true;
      break;
    }

    if (!replaced) break;
  }

  while (current.length > minStops) {
    const totals = computeBudgetTotals(current, perPersonCap);
    if (totals.totalWithContingency <= perPersonCap) return current;

    const removable = current
      .map((entry, index) => ({ index, cost: estimateStopCost(entry, perPersonCap), entry }))
      .sort((a, b) => b.cost - a.cost)
      .find((candidate) => {
        const tentative = current.filter((_, idx) => idx !== candidate.index);
        if (tentative.length < minStops) return false;
        if (!tentative.some((item) => isStrongSocialAnchor(item.place))) return false;
        if (hasConsecutiveFoodStops(tentative)) return false;
        if (hasConsecutivePlaceTypes(tentative)) return false;
        return true;
      });

    if (!removable) break;
    current = current.filter((_, idx) => idx !== removable.index);
  }

  return current;
}

function durationByCategory(category: string): number {
  const map: Record<string, number> = {
    cafe: 70,
    activity: 95,
    restaurant: 85,
    dessert: 45,
    movie: 140,
    park: 60,
  };
  return map[category] ?? 75;
}

function buildMapLinks(lat: number, lng: number, name: string): {
  mapUrl: string;
  googleMapsUrl: string;
  osmMapsUrl: string;
} {
  const encoded = encodeURIComponent(name);
  return {
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}(${encoded})`,
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}(${encoded})`,
    osmMapsUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`,
  };
}

function getDayPhase(meetupStartTime: string): DayPhase {
  const hour = Number(meetupStartTime.split(':')[0] || 12);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function inferDominantVibe(ranked: RankedPlace[], mood: Mood): DominantVibe {
  const top = ranked.slice(0, 6);
  const avgVibe = top.length > 0 ? top.reduce((sum, item) => sum + item.vibeScore, 0) / top.length : 0.5;

  if (mood === 'chill' || mood === 'romantic') return avgVibe >= 0.62 ? 'calm' : 'social';
  if (mood === 'adventure') return 'explore';
  return avgVibe >= 0.58 ? 'social' : 'explore';
}

function slotFamilies(profile: ItineraryProfile, context: {
  meetupStartTime: string;
  perPersonCap: number;
  dominantVibe: DominantVibe;
}): string[] {
  let base: string[];

  switch (profile) {
    case 'activity_food':
      base = ['engage', 'activity', 'food', 'relax'];
      break;
    case 'premium_dining':
      base = ['engage', 'activity', 'food'];
      break;
    case 'budget_bites':
      base = ['engage', 'activity', 'food'];
      break;
    case 'chill_walk':
    default:
      base = ['engage', 'activity', 'relax'];
  }

  const phase = getDayPhase(context.meetupStartTime);
  const budgetTight = context.perPersonCap <= 500;

  if (phase === 'evening') {
    base = ['engage', 'food', 'relax', ...base.filter((item) => item !== 'engage' && item !== 'food' && item !== 'relax')];
  }

  if (context.dominantVibe === 'calm') {
    base = ['engage', 'relax', ...base.filter((item) => item !== 'engage' && item !== 'relax')];
  }

  if (budgetTight) {
    base = ['engage', 'food', ...base.filter((item) => item !== 'engage' && item !== 'food')];
  }

  return base;
}

function familyCategoryMap(
  family: string,
  mood: Mood,
  context: { meetupStartTime: string; perPersonCap: number; dominantVibe: DominantVibe; groupSize?: number }
): string[] {
  const phase = getDayPhase(context.meetupStartTime);
  const budgetTight = context.perPersonCap <= 500;
  const groupSize = context.groupSize ?? 3;

  // Group-size-aware category ordering
  const byMood: Record<Mood, string[]> = {
    fun: groupSize >= 4 ? ['activity', 'cafe', 'dessert', 'park'] : ['cafe', 'activity', 'dessert', 'park'],
    chill: ['cafe', 'park', 'dessert', 'activity'],
    romantic: ['cafe', 'restaurant', 'park', 'dessert'],
    adventure: ['activity', 'park', 'cafe', 'restaurant'],
  };

  if (family === 'engage') {
    if (context.dominantVibe === 'calm') return ['cafe', 'park', 'activity', 'dessert'];
    return byMood[mood];
  }

  if (family === 'activity') {
    // For groups >= 4, always prioritize strong activities
    if (groupSize >= 4) return ['activity', 'park', 'movie'];
    if (budgetTight) return ['park', 'activity', 'movie'];
    return ['activity', 'park', 'movie'];
  }

  if (family === 'food') {
    if (budgetTight) return ['cafe', 'dessert', 'restaurant'];
    if (phase === 'evening') return ['cafe', 'dessert', 'restaurant'];
    return ['cafe', 'restaurant', 'dessert'];
  }

  if (phase === 'evening') return ['dessert', 'cafe', 'park'];
  return ['park', 'dessert', 'cafe'];
}

function isFoodCategory(category: string): boolean {
  return category === 'restaurant' || category === 'cafe' || category === 'dessert';
}

function isHeavyMealCategory(category: string): boolean {
  return category === 'restaurant';
}

function canSelectCategory(category: string, mixState: MixState): boolean {
  if (!isFoodCategory(category)) return true;
  if (mixState.foodStops >= MAX_FOOD_STOPS) return false;
  if (isHeavyMealCategory(category) && mixState.heavyMealStops >= MAX_HEAVY_MEAL_STOPS) {
    return false;
  }
  return true;
}

function registerSelectedCategory(mixState: MixState, category: string): void {
  if (!isFoodCategory(category)) return;
  mixState.foodStops += 1;
  if (isHeavyMealCategory(category)) {
    mixState.heavyMealStops += 1;
  }
}

function youthHangoutScoreAdjustment(place: Place, category: string): number {
  const text = normalizeText(`${place.name} ${place.description}`);

  let adjustment = 0;

  // Category base adjustments
  if (category === 'activity' || category === 'park') adjustment += 0.08;
  if (category === 'cafe' || category === 'dessert') adjustment += 0.05;
  if (category === 'restaurant') adjustment -= 0.04;

  // Strong positive signals: real youth hangout experiences
  if (/(arcade|board game|bowling|trampoline|escape room|gaming|go.?kart|laser.?tag|vr|comedy|live music|concert)/.test(text)) {
    adjustment += 0.12;
  }
  if (/(promenade|seaface|beach|viewpoint|fort|museum)/.test(text)) {
    adjustment += 0.07;
  }

  // Boost known hangout chains
  const hangoutChains = [
    'starbucks', 'blue tokai', 'third wave', 'social', 'chaayos', 'theobroma',
    'candies', 'pvr', 'inox', 'smaaash', 'timezone', 'mystery rooms', 'breakout',
    'bounce', 'game palacio', 'fun city', 'wow momo', 'naturals ice cream',
    'baskin robbins', 'burger king', 'mcdonald',
  ];
  if (hangoutChains.some((chain) => text.includes(chain))) {
    adjustment += 0.18;
  }

  // Penalize boring/generic places
  if (/(udyan|nagar|colony|chawl|bhavan|bhawan|mandal|samaj|sangha|sanstha)/.test(text)) {
    adjustment -= 0.15;
  }

  // Hard penalties for non-hangout activities
  if (/(banquet|fine dining|lounge|club house|convention)/.test(text)) {
    adjustment -= 0.1;
  }
  if (isWeakShoppingOnlyActivity(place)) {
    adjustment -= 0.18;
  }
  if (isWeakNonHangoutActivity(place)) {
    adjustment -= 0.3;
  }

  return adjustment;
}

function isStrongSocialAnchor(place: Place): boolean {
  if (isWeakShoppingOnlyActivity(place)) return false;
  if (isWeakNonHangoutActivity(place)) return false;

  const text = normalizeText(`${place.name} ${place.description}`);
  const category = inferCategoryLabel(place);
  const hangout = place.hangout_score ?? 0.5;

  if (category === 'cafe') return true;
  if (category === 'activity' && hangout >= 0.6) return true;
  if (category === 'activity' && /\b(mall|arcade|bowling|escape room|trampoline|board game|museum|fort|gaming|go.?kart|pvr|inox|cinema|movie|theatre|theater|smaaash|timezone|fun city|comedy|concert)\b/.test(text)) {
    return true;
  }
  if (category === 'park' && /\b(promenade|beach|seaface|viewpoint)\b/.test(text) && hangout >= 0.62) {
    return true;
  }

  // Known chains are always strong anchors
  const knownAnchors = ['starbucks', 'blue tokai', 'social', 'chaayos', 'theobroma', 'candies', 'pvr', 'inox', 'smaaash', 'timezone'];
  if (knownAnchors.some((chain) => text.includes(chain))) return true;

  return false;
}

function fairnessIndicator(score: number): string {
  if (score >= 0.85) return 'high fairness';
  if (score >= 0.7) return 'balanced';
  return 'moderate fairness';
}

function enrichAndRankPlaces(
  places: Place[],
  hub: HubCandidate,
  mood: Mood,
  perPersonCap: number
): RankedPlace[] {
  const seen = new Set<string>();
  const out: RankedPlace[] = [];

  for (const place of places) {
    if (!isSpecificRealPlace(place)) continue;
    if (blockedForMoodByName(place, mood)) continue;
    if (isWeakShoppingOnlyActivity(place)) continue;
    if (isWeakNonHangoutActivity(place)) continue;

    const distFromHub = haversineDistance({ lat: hub.lat, lng: hub.lng }, { lat: Number(place.lat), lng: Number(place.lng) });
    // Travel-time-based filtering
    const travelMins = (distFromHub / MUMBAI_AVG_SPEED_KMH) * 60;
    if (travelMins > MAX_STEP_TRAVEL_MINS) continue;

    const category = inferCategoryLabel(place);
    if (category === 'movie' && !hasActionableMovieShowtime(place)) {
      continue;
    }

    const key = normalizeText(place.name);
    if (seen.has(key)) continue;
    seen.add(key);

    const breakdown = scorePlaceBreakdown(place, perPersonCap, hub.lat, hub.lng, mood);
    out.push({
      place,
      score: breakdown.total_score + youthHangoutScoreAdjustment(place, category),
      vibeScore: breakdown.vibe_match,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

function pickForSlot(
  ranked: RankedPlace[],
  categories: string[],
  usedKeys: Set<string>,
  mixState: MixState,
  previousPoint?: { lat: number; lng: number },
  previousCategory?: string,
  previousPlaceType?: Place['type'],
  anchorPoint?: { lat: number; lng: number }
): RankedPlace | null {
  let best: RankedPlace | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const category of categories) {
    for (const entry of ranked) {
      const key = normalizeText(entry.place.name);
      if (usedKeys.has(key)) continue;

      const entryCategory = inferCategoryLabel(entry.place);
      if (entryCategory !== category) continue;
      if (!canSelectCategory(entryCategory, mixState)) continue;
      if (previousPlaceType && entry.place.type === previousPlaceType) continue;

      if (previousCategory && isFoodCategory(previousCategory) && isFoodCategory(entryCategory)) {
        continue;
      }

      if (anchorPoint) {
        const spreadKm = haversineDistance(anchorPoint, {
          lat: Number(entry.place.lat),
          lng: Number(entry.place.lng),
        });
        if (spreadKm > MAX_FLOW_SPREAD_KM) continue;
      }

      if (previousPoint) {
        const dist = haversineDistance(previousPoint, { lat: Number(entry.place.lat), lng: Number(entry.place.lng) });
        // Travel-time check instead of pure distance
        const stepTravel = (dist / MUMBAI_AVG_SPEED_KMH) * 60;
        if (stepTravel > MAX_STEP_TRAVEL_MINS) continue;

        // Zone check: don't jump between Mumbai zones
        const sameZone = Math.abs(previousPoint.lat - Number(entry.place.lat)) < 0.05 &&
                         Math.abs(previousPoint.lng - Number(entry.place.lng)) < 0.05;
        if (!sameZone && stepTravel > 15) continue;

        if (dist < bestDistance) {
          best = entry;
          bestDistance = dist;
        }
        continue;
      }

      return entry;
    }

    if (best) return best;
  }

  return null;
}

export function generateGroundedItineraryForHub(params: {
  hub: HubCandidate;
  places: Place[];
  mood: Mood;
  perPersonCap: number;
  profile: ItineraryProfile;
  meetupStartTime: string;
  groupSize?: number;
}): {
  plan: AIItineraryResponse;
  method: 'ai';
  model: string;
} {
  const groupSize = params.groupSize ?? 3;
  const ranked = enrichAndRankPlaces(params.places, params.hub, params.mood, params.perPersonCap);
  if (ranked.length < 2) {
    throw new Error(`Insufficient verified places in ${params.hub.name} for grounded itinerary`);
  }

  const { minStops, maxStops } = computeStopBounds(ranked, params.profile);

  const dominantVibe = inferDominantVibe(ranked, params.mood);
  const families = slotFamilies(params.profile, {
    meetupStartTime: params.meetupStartTime,
    perPersonCap: params.perPersonCap,
    dominantVibe,
  });
  const used = new Set<string>();
  const selected: RankedPlace[] = [];
  const mixState: MixState = {
    foodStops: 0,
    heavyMealStops: 0,
  };

  let chainingPoint: { lat: number; lng: number } | undefined;
  let anchorPoint: { lat: number; lng: number } | undefined;
  let previousCategory: string | undefined;
  let previousPlaceType: Place['type'] | undefined;

  for (const family of families) {
    const categories = familyCategoryMap(family, params.mood, {
      meetupStartTime: params.meetupStartTime,
      perPersonCap: params.perPersonCap,
      dominantVibe,
      groupSize,
    });
    const picked = pickForSlot(
      ranked,
      categories,
      used,
      mixState,
      chainingPoint,
      previousCategory,
      previousPlaceType,
      anchorPoint
    );
    if (!picked) continue;

    selected.push(picked);
    used.add(normalizeText(picked.place.name));

    const pickedPoint = { lat: Number(picked.place.lat), lng: Number(picked.place.lng) };
    const pickedCategory = inferCategoryLabel(picked.place);
    const pickedType = picked.place.type;

    chainingPoint = pickedPoint;
    if (!anchorPoint) anchorPoint = pickedPoint;
    previousCategory = pickedCategory;
    previousPlaceType = pickedType;
    registerSelectedCategory(mixState, pickedCategory);
  }

  // Ensure minimum stops.
  if (selected.length < minStops) {
    for (const entry of ranked) {
      const key = normalizeText(entry.place.name);
      if (used.has(key)) continue;
      if (selected.length >= maxStops) break;

      const category = inferCategoryLabel(entry.place);
      if (!canSelectCategory(category, mixState)) continue;

      const last = selected[selected.length - 1];
      const lastCategory = last ? inferCategoryLabel(last.place) : undefined;
      if (lastCategory && isFoodCategory(lastCategory) && isFoodCategory(category)) continue;
      if (last && last.place.type === entry.place.type) continue;

      if (anchorPoint) {
        const spreadKm = haversineDistance(anchorPoint, {
          lat: Number(entry.place.lat),
          lng: Number(entry.place.lng),
        });
        if (spreadKm > MAX_FLOW_SPREAD_KM) continue;
      }

      if (chainingPoint) {
        const dist = haversineDistance(chainingPoint, { lat: Number(entry.place.lat), lng: Number(entry.place.lng) });
        if (dist > STEP_RADIUS_KM) continue;
      }

      selected.push(entry);
      used.add(key);
      const entryPoint = { lat: Number(entry.place.lat), lng: Number(entry.place.lng) };
      chainingPoint = entryPoint;
      if (!anchorPoint) anchorPoint = entryPoint;
      previousPlaceType = entry.place.type;
      registerSelectedCategory(mixState, category);
    }
  }

  // Final relaxed pass: prefer producing a grounded plan over hard-failing.
  if (selected.length < minStops) {
    for (const entry of ranked) {
      const key = normalizeText(entry.place.name);
      if (used.has(key)) continue;

      const category = inferCategoryLabel(entry.place);
      if (!canSelectCategory(category, mixState)) continue;

      const last = selected[selected.length - 1];
      const lastCategory = last ? inferCategoryLabel(last.place) : undefined;
      if (lastCategory && isFoodCategory(lastCategory) && isFoodCategory(category)) continue;
      if (last && last.place.type === entry.place.type) continue;

      if (anchorPoint) {
        const spreadKm = haversineDistance(anchorPoint, {
          lat: Number(entry.place.lat),
          lng: Number(entry.place.lng),
        });
        if (spreadKm > MAX_FLOW_SPREAD_KM) continue;
      }

      selected.push(entry);
      used.add(key);
      previousPlaceType = entry.place.type;
      registerSelectedCategory(mixState, category);
      if (selected.length >= minStops) break;
    }
  }

  let trimmed = selected.slice(0, maxStops);
  trimmed = trimRepetitiveLeisureStops(trimmed, minStops);
  if (!trimmed.some((entry) => isStrongSocialAnchor(entry.place))) {
    const currentFoodStops = trimmed.reduce((count, entry) => {
      const category = inferCategoryLabel(entry.place);
      return count + (isFoodCategory(category) ? 1 : 0);
    }, 0);

    for (const candidate of ranked) {
      const candidateKey = normalizeText(candidate.place.name);
      if (trimmed.some((entry) => normalizeText(entry.place.name) === candidateKey)) continue;
      if (!isStrongSocialAnchor(candidate.place)) continue;

      if (anchorPoint) {
        const spreadKm = haversineDistance(anchorPoint, {
          lat: Number(candidate.place.lat),
          lng: Number(candidate.place.lng),
        });
        if (spreadKm > MAX_FLOW_SPREAD_KM) continue;
      }

      const candidateCategory = inferCategoryLabel(candidate.place);
      const candidateIsFood = isFoodCategory(candidateCategory);
      const replaceIdx = candidateIsFood && currentFoodStops >= MAX_FOOD_STOPS
        ? trimmed.findIndex((entry) => isFoodCategory(inferCategoryLabel(entry.place)))
        : trimmed.length - 1;

      if (replaceIdx < 0) continue;

      const prevCategory = replaceIdx > 0 ? inferCategoryLabel(trimmed[replaceIdx - 1].place) : undefined;
      const nextCategory = replaceIdx < trimmed.length - 1 ? inferCategoryLabel(trimmed[replaceIdx + 1].place) : undefined;
      if (candidateIsFood && ((prevCategory && isFoodCategory(prevCategory)) || (nextCategory && isFoodCategory(nextCategory)))) {
        continue;
      }

      const prevType = replaceIdx > 0 ? trimmed[replaceIdx - 1].place.type : undefined;
      const nextType = replaceIdx < trimmed.length - 1 ? trimmed[replaceIdx + 1].place.type : undefined;
      if ((prevType && prevType === candidate.place.type) || (nextType && nextType === candidate.place.type)) {
        continue;
      }

      trimmed = [...trimmed.slice(0, replaceIdx), candidate, ...trimmed.slice(replaceIdx + 1)];
      break;
    }
  }

  if (!trimmed.some((entry) => isStrongSocialAnchor(entry.place))) {
    throw new Error(`Unable to construct social-anchor itinerary in ${params.hub.name}`);
  }

  // CRITICAL: Force at least one strong experiential activity (bowling, arcade, escape room, etc.)
  const hasStrongActivity = trimmed.some((entry) => {
    const text = normalizeText(`${entry.place.name} ${entry.place.description}`);
    return STRONG_ACTIVITY_KEYWORDS_ENGINE.some((kw) => text.includes(kw));
  });

  if (!hasStrongActivity) {
    // Find the best strong activity in the ranked pool
    const bestStrongActivity = ranked.find((entry) => {
      const text = normalizeText(`${entry.place.name} ${entry.place.description}`);
      const isStrong = STRONG_ACTIVITY_KEYWORDS_ENGINE.some((kw) => text.includes(kw));
      if (!isStrong) return false;
      if (trimmed.some((t) => normalizeText(t.place.name) === normalizeText(entry.place.name))) return false;
      // Check zone compatibility
      if (anchorPoint) {
        const spreadKm = haversineDistance(anchorPoint, {
          lat: Number(entry.place.lat),
          lng: Number(entry.place.lng),
        });
        if (spreadKm > MAX_FLOW_SPREAD_KM + 1) return false; // Slightly relaxed for strong activities
      }
      return true;
    });

    if (bestStrongActivity) {
      // Replace the weakest non-activity, non-anchor stop
      const replaceableIdx = [...trimmed]
        .map((entry, idx) => ({ idx, entry }))
        .filter(({ entry }) => !isStrongSocialAnchor(entry.place))
        .filter(({ entry }) => entry.place.type !== 'activity')
        .sort((a, b) => a.entry.score - b.entry.score)[0]?.idx;

      if (replaceableIdx !== undefined && replaceableIdx >= 0) {
        trimmed = [...trimmed.slice(0, replaceableIdx), bestStrongActivity, ...trimmed.slice(replaceableIdx + 1)];
      } else {
        // If all stops are anchors, append and trim later
        trimmed.push(bestStrongActivity);
      }
    }
  }

  // Total travel time constraint: ensure itinerary isn't too scattered
  {
    let totalTravelMins = 0;
    for (let i = 1; i < trimmed.length; i++) {
      const prevPt = { lat: Number(trimmed[i - 1].place.lat), lng: Number(trimmed[i - 1].place.lng) };
      const currPt = { lat: Number(trimmed[i].place.lat), lng: Number(trimmed[i].place.lng) };
      const stepKm = haversineDistance(prevPt, currPt);
      totalTravelMins += (stepKm / MUMBAI_AVG_SPEED_KMH) * 60;
    }
    // If total travel exceeds budget, trim from the end (but keep min stops)
    while (totalTravelMins > MAX_TOTAL_TRAVEL_MINS && trimmed.length > minStops) {
      trimmed = trimmed.slice(0, -1);
      totalTravelMins = 0;
      for (let i = 1; i < trimmed.length; i++) {
        const prevPt = { lat: Number(trimmed[i - 1].place.lat), lng: Number(trimmed[i - 1].place.lng) };
        const currPt = { lat: Number(trimmed[i].place.lat), lng: Number(trimmed[i].place.lng) };
        totalTravelMins += (haversineDistance(prevPt, currPt) / MUMBAI_AVG_SPEED_KMH) * 60;
      }
    }
  }

  trimmed = fitSelectionWithinBudget(trimmed, ranked, params.perPersonCap, minStops);

  if (!trimmed.some((entry) => isStrongSocialAnchor(entry.place))) {
    throw new Error(`Unable to preserve social-anchor itinerary within budget in ${params.hub.name}`);
  }

  if (trimmed.length < minStops) {
    throw new Error(`Unable to construct ${minStops}-stop grounded flow in ${params.hub.name}`);
  }

  if (hasConsecutivePlaceTypes(trimmed)) {
    throw new Error(`Unable to construct non-repetitive place-type flow in ${params.hub.name}`);
  }

  const fittedBudget = computeBudgetTotals(trimmed, params.perPersonCap);
  if (fittedBudget.totalWithContingency > params.perPersonCap) {
    throw new Error(`Unable to construct budget-safe itinerary in ${params.hub.name}`);
  }

  let cursorMins = toMinutes(params.meetupStartTime);
  let previousPoint: { lat: number; lng: number } = { lat: params.hub.lat, lng: params.hub.lng };

  const stops = trimmed.map((entry, index) => {
    const place = entry.place;
    const lat = Number(place.lat);
    const lng = Number(place.lng);
    const category = inferCategoryLabel(place);
    const distKm = haversineDistance(previousPoint, { lat, lng });
    const walkMins = index === 0
      ? Math.max(5, Math.min(22, Math.round((distKm / 0.45) * 6)))
      : Math.max(4, Math.min(30, Math.round((distKm / 4.6) * 60)));
    const duration = durationByCategory(category);
    const cost = estimateCost(place, category, params.perPersonCap);

    const links = buildMapLinks(lat, lng, place.name);
    const start = toHHMM(cursorMins);
    cursorMins += duration + walkMins;
    previousPoint = { lat, lng };

    return {
      stop_number: index + 1,
      place_name: place.name,
      place_type: place.type,
      category_label: category,
      lat,
      lng,
      start_time: start,
      duration_mins: duration,
      estimated_cost_per_person: cost,
      place_rating: place.inferred_rating,
      walk_from_previous_mins: walkMins,
      distance_from_previous_km: Math.round(distKm * 10) / 10,
      vibe_note: `${category} stop aligned for ${params.mood} mood`,
      map_url: links.mapUrl,
      google_maps_url: links.googleMapsUrl,
      osm_maps_url: links.osmMapsUrl,
      source_url: place.url,
    };
  });

  const stopCostTotal = stops.reduce((sum, stop) => sum + stop.estimated_cost_per_person, 0);
  const contingency = Math.round(stopCostTotal * 0.12);
  const totalWithContingency = stopCostTotal + contingency;

  const meanVibe = trimmed.reduce((sum, item) => sum + item.vibeScore, 0) / trimmed.length;
  const dominantVibeMatchPct = Math.round(Math.max(0.45, Math.min(1, meanVibe)) * 100);
  const durationTotal = stops.reduce((sum, stop) => sum + stop.duration_mins + stop.walk_from_previous_mins, 0);

  const flowSummary = stops.map((stop) => stop.place_name).join(' -> ');
  const shortTitle = `${params.hub.name} - ${params.mood[0].toUpperCase()}${params.mood.slice(1)} realistic hangout`;

  const plan: AIItineraryResponse = {
    stops,
    total_cost_per_person: stopCostTotal,
    contingency_buffer: contingency,
    day_summary: `Grounded ${stops.length}-stop itinerary inside ${params.hub.name} local hangout pockets with verified nearby venues only.`,
    short_title: shortTitle,
    area: params.hub.name,
    vibe_tags: [params.mood, 'grounded', 'real-places'],
    flow_summary: flowSummary,
    duration_total_mins: durationTotal,
    average_place_rating: (() => {
      const ratings = stops
        .map((stop) => stop.place_rating)
        .filter((rating): rating is number => typeof rating === 'number' && Number.isFinite(rating));
      if (!ratings.length) return 0;
      return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
    })(),
    why_this_option: `Best balance of area consistency, budget fit, and travel fairness (${fairnessIndicator(params.hub.fairnessScore)}).`,
    profile: params.profile,
    dominant_vibe_match_pct: dominantVibeMatchPct,
    budget_breakdown: {
      stop_cost_total: stopCostTotal,
      contingency_buffer: contingency,
      total_with_contingency: totalWithContingency,
      cap_per_person: params.perPersonCap,
      within_cap: totalWithContingency <= params.perPersonCap,
    },
    score_breakdown: {
      distance_score: Math.min(1, Math.max(0.2, 1 - (params.hub.avgTravelTime / 60))),
      budget_match: totalWithContingency <= params.perPersonCap ? 0.95 : 0.4,
      vibe_match: Math.round((dominantVibeMatchPct / 100) * 100) / 100,
      rating_score: Math.min(1, Math.max(0.2, ((stops.find((s) => typeof s.place_rating === 'number')?.place_rating || 3.6) - 3) / 2)),
      total_score: 0,
    },
    meetup_start_time: params.meetupStartTime,
  };

  const score =
    plan.score_breakdown!.distance_score +
    plan.score_breakdown!.budget_match +
    plan.score_breakdown!.vibe_match +
    plan.score_breakdown!.rating_score;
  plan.score_breakdown!.total_score = Math.round(score * 100) / 100;

  return {
    plan,
    method: 'ai',
    model: 'grounded-engine-v1',
  };
}
