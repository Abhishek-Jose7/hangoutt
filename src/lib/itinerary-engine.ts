import type { AIItineraryResponse, HubCandidate, ItineraryProfile, Mood, Place } from '@/types';
import { haversineDistance } from './transit';
import { scorePlaceBreakdown } from './scoring';

interface RankedPlace {
  place: Place;
  score: number;
  vibeScore: number;
}

const HUB_RADIUS_KM = 3.4;
const STEP_RADIUS_KM = 2.6;

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

function inferCategoryLabel(place: Place): string {
  const text = normalizeText(`${place.name} ${place.description}`);

  if (/(ice cream|dessert|gelato|bakery|patisserie|sweet)/.test(text)) return 'dessert';
  if (/(cinema|imax|movie|pvr|inox)/.test(text)) return 'movie';
  if (/(park|garden|promenade|seaface|seaside|beach|viewpoint|outdoor)/.test(text)) return 'park';
  if (place.type === 'cafe') return 'cafe';
  if (place.type === 'restaurant') return 'restaurant';
  if (place.type === 'outdoor') return 'park';
  return 'activity';
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
  if (typeof place.estimated_cost === 'number' && Number.isFinite(place.estimated_cost) && place.estimated_cost > 0) {
    return Math.round(Math.min(place.estimated_cost, cap));
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
  return Math.round(Math.min(Math.max(80, fallback), cap));
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
  context: { meetupStartTime: string; perPersonCap: number; dominantVibe: DominantVibe }
): string[] {
  const phase = getDayPhase(context.meetupStartTime);
  const budgetTight = context.perPersonCap <= 500;

  const byMood: Record<Mood, string[]> = {
    fun: ['activity', 'cafe', 'dessert', 'park'],
    chill: ['cafe', 'park', 'dessert', 'activity'],
    romantic: ['cafe', 'restaurant', 'park', 'dessert'],
    adventure: ['activity', 'park', 'cafe', 'restaurant'],
  };

  if (family === 'engage') {
    if (context.dominantVibe === 'calm') return ['cafe', 'park', 'activity', 'dessert'];
    return byMood[mood];
  }

  if (family === 'activity') {
    if (budgetTight) return ['park', 'activity', 'movie'];
    return ['activity', 'park', 'movie'];
  }

  if (family === 'food') {
    if (budgetTight) return ['cafe', 'dessert', 'restaurant'];
    if (phase === 'evening') return ['restaurant', 'dessert', 'cafe'];
    return ['restaurant', 'cafe', 'dessert'];
  }

  if (phase === 'evening') return ['dessert', 'cafe', 'park'];
  return ['park', 'dessert', 'cafe'];
}

function isFoodCategory(category: string): boolean {
  return category === 'restaurant' || category === 'cafe' || category === 'dessert';
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

    const distFromHub = haversineDistance({ lat: hub.lat, lng: hub.lng }, { lat: Number(place.lat), lng: Number(place.lng) });
    if (distFromHub > HUB_RADIUS_KM) continue;

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
      score: breakdown.total_score,
      vibeScore: breakdown.vibe_match,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

function pickForSlot(
  ranked: RankedPlace[],
  categories: string[],
  usedKeys: Set<string>,
  previousPoint?: { lat: number; lng: number },
  previousCategory?: string
): RankedPlace | null {
  let best: RankedPlace | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const category of categories) {
    for (const entry of ranked) {
      const key = normalizeText(entry.place.name);
      if (usedKeys.has(key)) continue;

      const entryCategory = inferCategoryLabel(entry.place);
      if (entryCategory !== category) continue;

      if (previousCategory && isFoodCategory(previousCategory) && isFoodCategory(entryCategory)) {
        continue;
      }

      if (previousPoint) {
        const dist = haversineDistance(previousPoint, { lat: Number(entry.place.lat), lng: Number(entry.place.lng) });
        if (dist > STEP_RADIUS_KM) continue;

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
}): {
  plan: AIItineraryResponse;
  method: 'rule_based_fallback';
  model: null;
} {
  const ranked = enrichAndRankPlaces(params.places, params.hub, params.mood, params.perPersonCap);
  if (ranked.length < 3) {
    throw new Error(`Insufficient verified places in ${params.hub.name} for grounded itinerary`);
  }

  const dominantVibe = inferDominantVibe(ranked, params.mood);
  const families = slotFamilies(params.profile, {
    meetupStartTime: params.meetupStartTime,
    perPersonCap: params.perPersonCap,
    dominantVibe,
  });
  const used = new Set<string>();
  const selected: RankedPlace[] = [];

  let chainingPoint: { lat: number; lng: number } | undefined;
  let previousCategory: string | undefined;

  for (const family of families) {
    const categories = familyCategoryMap(family, params.mood, {
      meetupStartTime: params.meetupStartTime,
      perPersonCap: params.perPersonCap,
      dominantVibe,
    });
    const picked = pickForSlot(ranked, categories, used, chainingPoint, previousCategory);
    if (!picked) continue;

    selected.push(picked);
    used.add(normalizeText(picked.place.name));

    chainingPoint = { lat: Number(picked.place.lat), lng: Number(picked.place.lng) };
    previousCategory = inferCategoryLabel(picked.place);
  }

  // Ensure minimum 3 stops.
  if (selected.length < 3) {
    for (const entry of ranked) {
      const key = normalizeText(entry.place.name);
      if (used.has(key)) continue;
      if (selected.length >= 4) break;

      const category = inferCategoryLabel(entry.place);
      const last = selected[selected.length - 1];
      const lastCategory = last ? inferCategoryLabel(last.place) : undefined;
      if (lastCategory && isFoodCategory(lastCategory) && isFoodCategory(category)) continue;

      if (chainingPoint) {
        const dist = haversineDistance(chainingPoint, { lat: Number(entry.place.lat), lng: Number(entry.place.lng) });
        if (dist > STEP_RADIUS_KM) continue;
      }

      selected.push(entry);
      used.add(key);
      chainingPoint = { lat: Number(entry.place.lat), lng: Number(entry.place.lng) };
    }
  }

  const trimmed = selected.slice(0, 4);
  if (trimmed.length < 3) {
    throw new Error(`Unable to construct 3-stop grounded flow in ${params.hub.name}`);
  }

  let cursorMins = toMinutes(params.meetupStartTime);
  let previousPoint: { lat: number; lng: number } = { lat: params.hub.lat, lng: params.hub.lng };

  const stops = trimmed.map((entry, index) => {
    const place = entry.place;
    const lat = Number(place.lat);
    const lng = Number(place.lng);
    const category = inferCategoryLabel(place);
    const distKm = haversineDistance(previousPoint, { lat, lng });
    const walkMins = index === 0 ? Math.max(5, Math.round(distKm / 0.45 * 6)) : Math.max(4, Math.round((distKm / 4.6) * 60));
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
    day_summary: `Grounded ${stops.length}-stop itinerary in ${params.hub.name} with verified nearby venues only.`,
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
      within_cap: stopCostTotal <= params.perPersonCap,
    },
    score_breakdown: {
      distance_score: Math.min(1, Math.max(0.2, 1 - (params.hub.avgTravelTime / 60))),
      budget_match: stopCostTotal <= params.perPersonCap ? 0.95 : 0.4,
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
    method: 'rule_based_fallback',
    model: null,
  };
}
