import Groq from 'groq-sdk';
import { AIItineraryResponseSchema } from '@/types';
import type { AIItineraryResponse, Place, Mood, HubCandidate } from '@/types';
import { buildItineraryPrompt, RETRY_SUFFIX } from './prompts';
import { buildFallbackItinerary } from './fallback';
import { selectTopCandidates } from '../scoring';

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
  const topCandidates = selectTopCandidates(places, perPersonCap, hub.lat, hub.lng);

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
  const stops = [...itinerary.stops].sort(
    (a, b) => b.estimated_cost_per_person - a.estimated_cost_per_person
  );

  let total = itinerary.total_cost_per_person;

  for (const stop of stops) {
    if (total <= cap) break;
    const excess = total - cap;
    const reduction = Math.min(excess, stop.estimated_cost_per_person * 0.4);
    stop.estimated_cost_per_person = Math.round(
      stop.estimated_cost_per_person - reduction
    );
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
