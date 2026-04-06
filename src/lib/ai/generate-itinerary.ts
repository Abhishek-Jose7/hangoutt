import Groq from 'groq-sdk';
import { AIItineraryResponseSchema } from '@/types';
import type { AIItineraryResponse, Place, Mood, HubCandidate, ItineraryProfile } from '@/types';
import { buildItineraryPrompt, RETRY_SUFFIX } from './prompts';
import { buildFallbackItinerary } from './fallback';
import { selectTopCandidates } from '../scoring';
import { haversineDistance } from '../transit';

const MODEL = 'llama3-70b-8192';

type GroqKeyRole = 'generator' | 'retry' | 'overseer';

interface GroqRoleKeyPools {
  generator: string[];
  retry: string[];
  overseer: string[];
}

const roleCursor: Record<GroqKeyRole, number> = {
  generator: 0,
  retry: 0,
  overseer: 0,
};

function parseGroqKeysFromEnv(): string[] {
  const keysString = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY;
  if (!keysString) return [];
  return keysString
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function parseRoleVar(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function firstAvailablePool(pools: GroqRoleKeyPools): string[] {
  return pools.generator.length > 0
    ? pools.generator
    : pools.retry.length > 0
    ? pools.retry
    : pools.overseer;
}

function resolveGroqRoleKeyPools(): GroqRoleKeyPools {
  const explicitPools: GroqRoleKeyPools = {
    generator: parseRoleVar(process.env.GROQ_API_KEY_GENERATOR),
    retry: parseRoleVar(process.env.GROQ_API_KEY_RETRY),
    overseer: parseRoleVar(process.env.GROQ_API_KEY_OVERSEER),
  };

  const explicitCount =
    explicitPools.generator.length + explicitPools.retry.length + explicitPools.overseer.length;

  if (explicitCount > 0) {
    const fallbackPool = firstAvailablePool(explicitPools);
    return {
      generator: explicitPools.generator.length > 0 ? explicitPools.generator : fallbackPool,
      retry: explicitPools.retry.length > 0 ? explicitPools.retry : fallbackPool,
      overseer: explicitPools.overseer.length > 0 ? explicitPools.overseer : fallbackPool,
    };
  }

  const keys = parseGroqKeysFromEnv();
  if (keys.length === 0) {
    throw new Error(
      'Missing Groq keys. Set GROQ_API_KEY_GENERATOR/GROQ_API_KEY_RETRY/GROQ_API_KEY_OVERSEER or GROQ_API_KEYS'
    );
  }

  // Fallback distribution when only GROQ_API_KEYS is provided.
  const pools: GroqRoleKeyPools = { generator: [], retry: [], overseer: [] };
  keys.forEach((key, index) => {
    const slot = index % 3;
    if (slot === 0) pools.generator.push(key);
    else if (slot === 1) pools.retry.push(key);
    else pools.overseer.push(key);
  });

  const fallbackPool = firstAvailablePool(pools);
  return {
    generator: pools.generator.length > 0 ? pools.generator : fallbackPool,
    retry: pools.retry.length > 0 ? pools.retry : fallbackPool,
    overseer: pools.overseer.length > 0 ? pools.overseer : fallbackPool,
  };
}

function getGroqClient(role: GroqKeyRole): Groq {
  const rolePools = resolveGroqRoleKeyPools();
  const pool = rolePools[role];
  const key = pool[roleCursor[role] % pool.length];
  roleCursor[role] += 1;

  return new Groq({
    apiKey: key,
  });
}

/**
 * Generate itinerary for a single hub using Groq
 */
export async function generateItineraryForHub(
  hub: HubCandidate,
  places: Place[],
  memberCount: number,
  mood: Mood,
  perPersonCap: number,
  profile: ItineraryProfile
): Promise<{
  plan: AIItineraryResponse;
  method: 'ai' | 'rule_based_fallback';
  model: string | null;
}> {
  // Score and select top candidates
  const topCandidates = selectTopCandidates(places, perPersonCap, hub.lat, hub.lng, mood);

  const prompt = buildItineraryPrompt({
    hubName: hub.name,
    hubStation: hub.station,
    memberCount,
    mood,
    profile,
    perPersonCap,
    startTime: '11:00',
    endTime: '21:00',
    candidates: JSON.stringify(topCandidates, null, 2),
  });

  try {
    const generatorClient = getGroqClient('generator');

    // First attempt
    let response = await generatorClient.chat.completions.create({
      model: MODEL,
      temperature: 0.2, // lower temperature for more predictable structured output
      response_format: { type: 'json_object' }, // ensures Groq returns valid JSON
      messages: [{ role: 'user', content: prompt }],
    });

    let text = response.choices[0]?.message?.content || '';

    // Try to extract JSON from the response
    let parsed = tryParseItinerary(text);

    // Retry if first attempt fails
    if (!parsed) {
      const retryClient = getGroqClient('retry');
      response = await retryClient.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: `${prompt}\n\n${RETRY_SUFFIX}` }],
      });

      text = response.choices[0]?.message?.content || '';
      parsed = tryParseItinerary(text);
    }

    // Final recovery pass with overseer key to avoid dropping to fallback too early.
    if (!parsed) {
      const overseerClient = getGroqClient('overseer');
      response = await overseerClient.chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\n${RETRY_SUFFIX}\n\nReturn valid JSON only. Ensure stop names are specific real venues from candidate list.`,
          },
        ],
      });

      text = response.choices[0]?.message?.content || '';
      parsed = tryParseItinerary(text);
    }

    if (parsed) {
      parsed = postProcessItinerary(parsed, topCandidates, hub, perPersonCap, mood, profile);

      // Post-process: if over budget, adjust
      if (parsed.total_cost_per_person > perPersonCap) {
        parsed = adjustBudget(parsed, perPersonCap);
      }
      return { plan: parsed, method: 'ai', model: MODEL };
    }

    // Fallback
    console.warn(`[AI] All three attempts failed for hub ${hub.name}, using fallback`);
    return {
      plan: postProcessItinerary(
        buildFallbackItinerary(topCandidates, perPersonCap, mood),
        topCandidates,
        hub,
        perPersonCap,
        mood,
        profile
      ),
      method: 'rule_based_fallback',
      model: null,
    };
  } catch (err) {
    console.error(`[AI] Error generating for hub ${hub.name}:`, err);
    return {
      plan: postProcessItinerary(
        buildFallbackItinerary(topCandidates, perPersonCap, mood),
        topCandidates,
        hub,
        perPersonCap,
        mood,
        profile
      ),
      method: 'rule_based_fallback',
      model: null,
    };
  }
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function placeNameLooksGeneric(name: string): boolean {
  const lowered = normalizeText(name);
  const banned = [
    'best places',
    'top places',
    'places to visit',
    'things to do',
    'justdial',
    'tripadvisor',
    'zomato',
    'bookmyshow',
    'google maps',
    'near me',
    'review',
    'wanderlog',
    'thrillophilia',
    'in mumbai',
    'lounge bars',
    'best lounge',
    'top lounge',
    'best restaurants',
    'top restaurants',
    'best cafes',
    'top cafes',
    'guide to',
    'list of',
  ];
  return banned.some((term) => lowered.includes(term));
}

function moodTypePlan(mood: Mood): Array<AIItineraryResponse['stops'][number]['place_type']> {
  switch (mood) {
    case 'romantic':
      return ['restaurant', 'activity', 'outdoor'];
    case 'adventure':
      return ['activity', 'restaurant', 'outdoor'];
    case 'chill':
      return ['cafe', 'activity', 'outdoor'];
    case 'fun':
    default:
      return ['activity', 'restaurant', 'outdoor'];
  }
}

function profileTypePlan(profile: ItineraryProfile): Array<AIItineraryResponse['stops'][number]['place_type']> {
  switch (profile) {
    case 'chill_walk':
      return ['cafe', 'outdoor', 'restaurant'];
    case 'activity_food':
      return ['activity', 'restaurant', 'outdoor'];
    case 'premium_dining':
      return ['restaurant', 'activity', 'cafe'];
    case 'budget_bites':
      return ['restaurant', 'outdoor', 'cafe'];
    default:
      return ['activity', 'restaurant', 'outdoor'];
  }
}

function isEatery(placeType: Place['type']): boolean {
  return placeType === 'restaurant' || placeType === 'cafe';
}

function isTicketedAdventurePlace(place: Place): boolean {
  const text = `${place.name} ${place.description}`.toLowerCase();
  return /(bounce|bowling|escape room|trampoline|ticket|slot|session|go kart|arcade)/i.test(text);
}

function pickByType(
  preferredType: AIItineraryResponse['stops'][number]['place_type'],
  candidates: Place[],
  used: Set<string>
): Place | null {
  const exact = candidates.find((c) => c.type === preferredType && !used.has(c.name));
  if (exact) return exact;

  if (preferredType === 'restaurant' || preferredType === 'cafe') {
    const eatery = candidates.find((c) => (c.type === 'restaurant' || c.type === 'cafe') && !used.has(c.name));
    if (eatery) return eatery;
  }

  return candidates.find((c) => !used.has(c.name)) || null;
}

function closestCandidateByName(name: string, candidates: Place[], used: Set<string>): Place | null {
  const target = normalizeText(name);
  let best: Place | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    if (used.has(candidate.name)) continue;
    const c = normalizeText(candidate.name);
    if (c.length < 3) continue;

    let score = 0;
    if (target === c) score = 1;
    else if (target.includes(c) || c.includes(target)) score = 0.85;
    else {
      const targetWords = new Set(target.split(' '));
      const cWords = c.split(' ');
      const overlap = cWords.filter((w) => targetWords.has(w)).length;
      score = overlap / Math.max(cWords.length, 1);
    }

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 0.35 ? best : null;
}

function pickFallbackCandidate(candidates: Place[], used: Set<string>): Place | null {
  for (const candidate of candidates) {
    if (!used.has(candidate.name)) return candidate;
  }
  return null;
}

function walkMins(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const distKm = haversineDistance(from, to);
  const mins = Math.round((distKm / 4.5) * 60);
  return Math.min(Math.max(mins, 5), 35);
}

function summarizeFlow(stops: AIItineraryResponse['stops']): string {
  if (!stops.length) return '';
  if (stops.length === 1) return stops[0].place_name;

  const chunks: string[] = [stops[0].place_name];
  for (let i = 1; i < stops.length; i++) {
    const mode = stops[i].walk_from_previous_mins > 16 ? 'auto' : 'walk';
    chunks.push(`${mode} -> ${stops[i].place_name}`);
  }
  return chunks.join(' -> ');
}

function postProcessItinerary(
  itinerary: AIItineraryResponse,
  candidates: Place[],
  hub: HubCandidate,
  perPersonCap: number,
  mood: Mood,
  profile: ItineraryProfile
): AIItineraryResponse {
  const used = new Set<string>();
  let previousPoint: { lat: number; lng: number } = { lat: hub.lat, lng: hub.lng };
  const desiredTypes = profileTypePlan(profile) || moodTypePlan(mood);

  const affordablePlaces = candidates.filter((c) => c.estimated_cost === undefined || c.estimated_cost <= perPersonCap);
  const budgetFirst = profile === 'budget_bites';
  const premiumFirst = profile === 'premium_dining';

  const primaryActivity =
    mood === 'adventure'
      ? (budgetFirst ? affordablePlaces : candidates).find((c) => c.type === 'activity' && isTicketedAdventurePlace(c))
        || (budgetFirst ? affordablePlaces : candidates).find((c) => c.type === 'activity')
      : (budgetFirst ? affordablePlaces : candidates).find((c) => c.type === 'activity');
  const primaryEateryPool = budgetFirst
    ? affordablePlaces
    : candidates;
  const primaryEatery =
    (premiumFirst
      ? primaryEateryPool.find((c) => isEatery(c.type) && (c.inferred_rating ?? 0) >= 4.3)
      : primaryEateryPool.find((c) => isEatery(c.type) && (c.inferred_rating ?? 0) >= 4.0))
    || primaryEateryPool.find((c) => isEatery(c.type));

  const stops = itinerary.stops.map((stop, index) => {
    const preferredType = desiredTypes[index] || stop.place_type;
    let matched = closestCandidateByName(stop.place_name, candidates, used);

    if (!matched || placeNameLooksGeneric(stop.place_name)) {
      matched = pickByType(preferredType, candidates, used) || pickFallbackCandidate(candidates, used);
    }

    if (matched) {
      used.add(matched.name);
    }

    const finalCost = matched?.estimated_cost !== undefined
      ? Math.round(Math.min(perPersonCap, matched.estimated_cost))
      : 0;

    const hasCoords = matched?.lat !== undefined && matched?.lng !== undefined;
    const distanceKm =
      hasCoords
        ? Math.round(haversineDistance(previousPoint, { lat: Number(matched?.lat), lng: Number(matched?.lng) }) * 10) / 10
        : Math.round(((index === 0 ? 10 : stop.walk_from_previous_mins) * 4.5 / 60) * 10) / 10;

    const walk =
      hasCoords
        ? walkMins(previousPoint, { lat: Number(matched?.lat), lng: Number(matched?.lng) })
        : index === 0
        ? 10
        : stop.walk_from_previous_mins;

    if (hasCoords) {
      previousPoint = { lat: Number(matched?.lat), lng: Number(matched?.lng) };
    }

    return {
      ...stop,
      place_name: matched?.name || stop.place_name,
      place_type: matched?.type || preferredType,
      estimated_cost_per_person: finalCost,
      walk_from_previous_mins: walk,
      distance_from_previous_km: distanceKm,
      lat: hasCoords ? Number(matched?.lat) : undefined,
      lng: hasCoords ? Number(matched?.lng) : undefined,
      source_url: undefined,
    };
  });

  // Enforce exactly one primary activity + one primary eatery anchor per itinerary.
  if (stops.length >= 2) {
    const activitySlot = mood === 'romantic' ? 1 : 0;
    const eaterySlot = mood === 'romantic' ? 0 : 1;

    if (primaryActivity) {
      const activityCost = primaryActivity.estimated_cost !== undefined
        ? Math.min(perPersonCap, Math.round(primaryActivity.estimated_cost))
        : 0;
      stops[activitySlot] = {
        ...stops[activitySlot],
        place_name: primaryActivity.name,
        place_type: 'activity',
        estimated_cost_per_person: activityCost,
        vibe_note: stops[activitySlot].vibe_note || `Primary activity anchor for ${mood} mood`,
      };
    }

    if (primaryEatery) {
      const eateryType: Place['type'] = isEatery(primaryEatery.type) ? primaryEatery.type : 'restaurant';
      const eateryCost = primaryEatery.estimated_cost !== undefined
        ? Math.min(perPersonCap, Math.round(primaryEatery.estimated_cost))
        : 0;
      stops[eaterySlot] = {
        ...stops[eaterySlot],
        place_name: primaryEatery.name,
        place_type: eateryType,
        estimated_cost_per_person: eateryCost,
        vibe_note: stops[eaterySlot].vibe_note || `Primary eatery anchor for ${mood} mood`,
      };
    }
  }

  const total = stops.reduce((sum, s) => sum + s.estimated_cost_per_person, 0);
  const flowSummary = summarizeFlow(stops);
  const profileTitle: Record<ItineraryProfile, string> = {
    chill_walk: 'Chill Cafe and Walk Plan',
    activity_food: 'Action and Food Plan',
    premium_dining: 'Premium Dining Experience',
    budget_bites: 'Budget Bites and Hangout',
  };
  const vibeTagsMap: Record<ItineraryProfile, string[]> = {
    chill_walk: ['chill', 'walkable', 'low-stress'],
    activity_food: ['active', 'social', 'high-energy'],
    premium_dining: ['premium', 'date-night', 'curated'],
    budget_bites: ['budget', 'casual', 'value'],
  };

  return {
    ...itinerary,
    stops,
    total_cost_per_person: total,
    contingency_buffer: Math.round(total * 0.15),
    short_title: itinerary.short_title || profileTitle[profile],
    area: itinerary.area || hub.name,
    flow_summary: itinerary.flow_summary || flowSummary,
    vibe_tags: itinerary.vibe_tags?.length ? itinerary.vibe_tags : vibeTagsMap[profile],
    profile,
  };
}

/**
 * Try to parse and validate AI response as itinerary
 */
function tryParseItinerary(text: string): AIItineraryResponse | null {
  try {
    // Extract JSON from text (in case there's wrapping text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const raw = JSON.parse(jsonMatch[0]);
    const result = AIItineraryResponseSchema.safeParse(raw);

    if (result.success) return result.data;

    console.warn('[AI] Zod validation failed:', result.error.issues);
    return null;
  } catch {
    return null;
  }
}

/**
 * Post-process: adjust itinerary to fit within budget
 */
function adjustBudget(
  itinerary: AIItineraryResponse,
  cap: number
): AIItineraryResponse {
  const stops = [...itinerary.stops];

  let total = itinerary.total_cost_per_person;

  const foodStops = stops
    .filter((s) => (s.place_type === 'restaurant' || s.place_type === 'cafe') && s.estimated_cost_per_person > 0)
    .sort((a, b) => b.estimated_cost_per_person - a.estimated_cost_per_person);

  for (const stop of foodStops) {
    if (total <= cap) break;
    const excess = total - cap;
    const maxFoodReduction = stop.estimated_cost_per_person * 0.6;
    const reduction = Math.min(excess, maxFoodReduction);
    stop.estimated_cost_per_person = Math.max(80, Math.round(stop.estimated_cost_per_person - reduction));
    total -= reduction;
  }

  for (const stop of stops) {
    if (total <= cap) break;
    if (stop.estimated_cost_per_person <= 0) continue;
    const excess = total - cap;
    const maxReduction = stop.place_type === 'activity' ? stop.estimated_cost_per_person * 0.2 : stop.estimated_cost_per_person * 0.35;
    const reduction = Math.min(excess, maxReduction);
    stop.estimated_cost_per_person = Math.max(80, Math.round(stop.estimated_cost_per_person - reduction));
    total -= reduction;
  }

  return {
    ...itinerary,
    stops: stops.sort((a, b) => a.stop_number - b.stop_number),
    total_cost_per_person: stops.reduce(
      (sum, s) => sum + s.estimated_cost_per_person,
      0
    ),
    contingency_buffer: Math.round(total * 0.15),
  };
}
