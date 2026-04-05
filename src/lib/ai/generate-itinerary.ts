import Groq from 'groq-sdk';
import { AIItineraryResponseSchema } from '@/types';
import type { AIItineraryResponse, Place, Mood, HubCandidate } from '@/types';
import { buildItineraryPrompt, RETRY_SUFFIX } from './prompts';
import { buildFallbackItinerary } from './fallback';
import { selectTopCandidates } from '../scoring';
import { haversineDistance } from '../transit';

const MODEL = 'llama3-70b-8192';

let currentKeyIndex = 0;

function getGroqClient(): Groq {
  const keysString = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY;
  if (!keysString) {
    throw new Error('Missing GROQ_API_KEYS in environment');
  }
  
  // Split by comma and clean up whitespace
  const keys = keysString.split(',').map((k) => k.trim()).filter(Boolean);

  if (keys.length === 0) {
    throw new Error('No valid Groq API keys found');
  }

  // Round-robin selection for orchestration across multiple keys
  const key = keys[currentKeyIndex % keys.length];
  currentKeyIndex++;

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
  perPersonCap: number
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
    perPersonCap,
    startTime: '11:00',
    endTime: '21:00',
    candidates: JSON.stringify(topCandidates, null, 2),
  });

  try {
    const client = getGroqClient();

    // First attempt
    let response = await client.chat.completions.create({
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
      // Rotate client to potentially use another key seamlessly
      const retryClient = getGroqClient();
      response = await retryClient.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: `${prompt}\n\n${RETRY_SUFFIX}` }],
      });

      text = response.choices[0]?.message?.content || '';
      parsed = tryParseItinerary(text);
    }

    if (parsed) {
      parsed = postProcessItinerary(parsed, topCandidates, hub, perPersonCap);

      // Post-process: if over budget, adjust
      if (parsed.total_cost_per_person > perPersonCap) {
        parsed = adjustBudget(parsed, perPersonCap);
      }
      return { plan: parsed, method: 'ai', model: MODEL };
    }

    // Fallback
    console.warn(`[AI] Both attempts failed for hub ${hub.name}, using fallback`);
    return {
      plan: buildFallbackItinerary(topCandidates, perPersonCap),
      method: 'rule_based_fallback',
      model: null,
    };
  } catch (err) {
    console.error(`[AI] Error generating for hub ${hub.name}:`, err);
    return {
      plan: buildFallbackItinerary(topCandidates, perPersonCap),
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

function postProcessItinerary(
  itinerary: AIItineraryResponse,
  candidates: Place[],
  hub: HubCandidate,
  perPersonCap: number
): AIItineraryResponse {
  const used = new Set<string>();
  let previousPoint: { lat: number; lng: number } = { lat: hub.lat, lng: hub.lng };

  const stops = itinerary.stops.map((stop, index) => {
    let matched = closestCandidateByName(stop.place_name, candidates, used);

    if (!matched || placeNameLooksGeneric(stop.place_name)) {
      matched = pickFallbackCandidate(candidates, used);
    }

    if (matched) {
      used.add(matched.name);
    }

    const finalCost = Math.round(
      Math.min(
        perPersonCap,
        matched?.estimated_cost || stop.estimated_cost_per_person
      )
    );

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
      place_type: matched?.type || stop.place_type,
      estimated_cost_per_person: finalCost,
      walk_from_previous_mins: walk,
      distance_from_previous_km: distanceKm,
      lat: hasCoords ? Number(matched?.lat) : undefined,
      lng: hasCoords ? Number(matched?.lng) : undefined,
    };
  });

  const total = stops.reduce((sum, s) => sum + s.estimated_cost_per_person, 0);

  return {
    ...itinerary,
    stops,
    total_cost_per_person: total,
    contingency_buffer: Math.round(total * 0.15),
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
    .filter((s) => s.place_type === 'restaurant' || s.place_type === 'cafe')
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
