import Groq from 'groq-sdk';
import { AIItineraryResponseSchema } from '@/types';
import type { AIItineraryResponse, Place, Mood, HubCandidate, ItineraryProfile } from '@/types';
import { buildItineraryPrompt, RETRY_SUFFIX } from './prompts';
import {
  buildGeneratorAgentPrompt,
  buildOverseerAgentPrompt,
  buildRetryAgentPrompt,
} from './agent-role-prompts';
import { buildFallbackItinerary } from './fallback';
import { selectTopCandidates } from '../scoring';
import { haversineDistance } from '../transit';

const MODEL = 'llama3-70b-8192';
const GROQ_REVIEW_TIMEOUT_MS = 5000;

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

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

function hasGroqRoleKeysConfigured(): boolean {
  return (
    parseRoleVar(process.env.GROQ_API_KEY_GENERATOR).length > 0 ||
    parseRoleVar(process.env.GROQ_API_KEY_RETRY).length > 0 ||
    parseRoleVar(process.env.GROQ_API_KEY_OVERSEER).length > 0 ||
    parseGroqKeysFromEnv().length > 0
  );
}

interface QualityGateResult {
  passed: boolean;
  issues: string[];
  score: number;
}

interface OverseerAuditResult {
  approved: boolean;
  quality_score: number;
  issues: string[];
  summary: string;
}

interface GeneratorRefinePromptShape {
  stops: AIItineraryResponse['stops'];
  total_cost_per_person: number;
  duration_total_mins: number;
  vibe: Mood;
  travel_summary?: AIItineraryResponse['travel_summary'];
}

function candidateNameSet(candidates: Place[]): Set<string> {
  return new Set(candidates.map((candidate) => normalizeText(candidate.name)));
}

function calcDurationMins(plan: AIItineraryResponse): number {
  return plan.stops.reduce(
    (sum, stop) => sum + stop.duration_mins + stop.walk_from_previous_mins,
    0
  );
}

function evaluateItineraryRules(
  plan: AIItineraryResponse,
  candidates: Place[],
  perPersonCap: number
): QualityGateResult {
  const issues: string[] = [];
  const candidateNames = candidateNameSet(candidates);

  if (plan.stops.length < 3) {
    issues.push('Itinerary must contain at least 3 stops.');
  }

  const usedTypes = new Set<string>();
  for (let i = 0; i < plan.stops.length; i++) {
    const stop = plan.stops[i];
    const normalized = normalizeText(stop.place_name);

    if (!candidateNames.has(normalized)) {
      issues.push(`Stop ${i + 1} is not from candidate list: ${stop.place_name}`);
    }

    if (i > 0 && stop.place_type === plan.stops[i - 1].place_type) {
      issues.push(`Consecutive duplicate stop types at stops ${i} and ${i + 1}.`);
    }

    if (stop.walk_from_previous_mins > 40) {
      issues.push(`Stop ${i + 1} has excessive transfer time (${stop.walk_from_previous_mins} mins).`);
    }

    usedTypes.add(stop.place_type);
  }

  if (!usedTypes.has('activity') && !usedTypes.has('outdoor')) {
    issues.push('Itinerary must include at least one activity or outdoor stop.');
  }

  if (!usedTypes.has('restaurant') && !usedTypes.has('cafe')) {
    issues.push('Itinerary must include at least one food stop (cafe or restaurant).');
  }

  if (plan.total_cost_per_person > perPersonCap) {
    issues.push(`Total cost exceeds cap (₹${plan.total_cost_per_person} > ₹${perPersonCap}).`);
  }

  const score = Math.max(0, 100 - issues.length * 16);
  return { passed: issues.length === 0, issues, score };
}

async function runOverseerAudit(
  plan: AIItineraryResponse,
  candidates: Place[],
  mood: Mood,
  profile: ItineraryProfile,
  perPersonCap: number
): Promise<OverseerAuditResult> {
  const client = getGroqClient('overseer');
  const perUserTravel = plan.member_travel_breakdown;
  const overseerPrompt = buildOverseerAgentPrompt({
    itinerary: plan,
    per_user_travel: perUserTravel,
    budget: perPersonCap,
    vibe: mood,
  });

  try {
    const response = await withTimeout(
      client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: `${overseerPrompt}\n\nAdditional validator context:\n${JSON.stringify(
              {
                mood,
                profile,
                per_person_cap: perPersonCap,
                candidate_names: candidates.map((candidate) => candidate.name),
              },
              null,
              2
            )}`,
          },
        ],
      }),
      GROQ_REVIEW_TIMEOUT_MS
    );

    const text = response.choices[0]?.message?.content || '{}';
    const raw = JSON.parse(text) as Partial<OverseerAuditResult> & {
      valid?: boolean;
      score?: number;
      verdict?: 'accept' | 'reject';
    };
    const issues = Array.isArray(raw.issues)
      ? raw.issues.filter((issue): issue is string => typeof issue === 'string').slice(0, 6)
      : [];
    const summary = typeof raw.summary === 'string' && raw.summary.trim().length > 0
      ? raw.summary.trim()
      : issues.length > 0
      ? issues.slice(0, 2).join(' ')
      : 'Plan passes practical validation checks.';
    const quality = typeof raw.quality_score === 'number' && Number.isFinite(raw.quality_score)
      ? Math.max(0, Math.min(100, Math.round(raw.quality_score)))
      : typeof raw.score === 'number' && Number.isFinite(raw.score)
      ? Math.max(0, Math.min(100, Math.round(raw.score * 100)))
      : issues.length === 0
      ? 75
      : 55;
    const approvedFromVerdict = raw.verdict ? raw.verdict === 'accept' : undefined;
    const approvedFromValid = typeof raw.valid === 'boolean' ? raw.valid : undefined;
    const approved =
      approvedFromVerdict ??
      approvedFromValid ??
      Boolean(raw.approved);

    return {
      approved: approved && quality >= 60,
      quality_score: quality,
      issues,
      summary,
    };
  } catch {
    return {
      approved: true,
      quality_score: 70,
      issues: [],
      summary: 'AI reviewer unavailable, keeping deterministic plan.',
    };
  }
}

export async function reviewDeterministicItineraryWithGroq(params: {
  plan: AIItineraryResponse;
  candidates: Place[];
  hub: HubCandidate;
  mood: Mood;
  profile: ItineraryProfile;
  perPersonCap: number;
}): Promise<{
  plan: AIItineraryResponse;
  model: string | null;
  corrected: boolean;
}> {
  const finalizePlan = (input: AIItineraryResponse): AIItineraryResponse => {
    let next = postProcessItinerary(
      input,
      params.candidates,
      params.hub,
      params.perPersonCap,
      params.mood,
      params.profile
    );
    if (next.total_cost_per_person > params.perPersonCap) {
      next = adjustBudget(next, params.perPersonCap);
    }
    return next;
  };

  const basePlan = finalizePlan(params.plan);
  if (!hasGroqRoleKeysConfigured()) {
    return {
      plan: basePlan,
      model: null,
      corrected: false,
    };
  }

  const localGate = evaluateItineraryRules(basePlan, params.candidates, params.perPersonCap);
  const overseerGate = await runOverseerAudit(
    basePlan,
    params.candidates,
    params.mood,
    params.profile,
    params.perPersonCap
  );

  if (localGate.passed && overseerGate.approved) {
    return {
      plan: {
        ...basePlan,
        why_this_option: basePlan.why_this_option || overseerGate.summary,
      },
      model: MODEL,
      corrected: false,
    };
  }

  const reviewIssues = [...localGate.issues, ...overseerGate.issues]
    .filter(Boolean)
    .slice(0, 8);

  try {
    const retryClient = getGroqClient('retry');
    const retryPrompt = buildRetryAgentPrompt({
      current_itinerary: basePlan,
      issues: reviewIssues,
      candidate_places: params.candidates,
      budget: params.perPersonCap,
      vibe: params.mood,
    });

    const retryResponse = await withTimeout(
      retryClient.chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content:
              `${retryPrompt}\n\n` +
              'Correction mode: return full corrected AIItineraryResponse JSON only.\n' +
              'Do not generate from scratch. Correct the current itinerary using candidate places only.',
          },
        ],
      }),
      GROQ_REVIEW_TIMEOUT_MS
    );

    const correctedText = retryResponse.choices[0]?.message?.content || '';
    const corrected = tryParseItinerary(correctedText);
    if (!corrected) {
      return {
        plan: {
          ...basePlan,
          why_this_option: basePlan.why_this_option || overseerGate.summary,
        },
        model: MODEL,
        corrected: false,
      };
    }

    const correctedPlan = finalizePlan(corrected);
    const correctedLocalGate = evaluateItineraryRules(
      correctedPlan,
      params.candidates,
      params.perPersonCap
    );
    const correctedOverseerGate = await runOverseerAudit(
      correctedPlan,
      params.candidates,
      params.mood,
      params.profile,
      params.perPersonCap
    );

    if (correctedLocalGate.passed && correctedOverseerGate.approved) {
      return {
        plan: {
          ...correctedPlan,
          why_this_option: correctedPlan.why_this_option || correctedOverseerGate.summary,
        },
        model: MODEL,
        corrected: true,
      };
    }

    return {
      plan: {
        ...basePlan,
        why_this_option: basePlan.why_this_option || overseerGate.summary,
      },
      model: MODEL,
      corrected: false,
    };
  } catch {
    return {
      plan: {
        ...basePlan,
        why_this_option: basePlan.why_this_option || overseerGate.summary,
      },
      model: MODEL,
      corrected: false,
    };
  }
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
  const topCandidates = selectTopCandidates(places, perPersonCap, hub.lat, hub.lng, mood, 3);

  if (topCandidates.length < 3) {
    console.warn(`[AI] Insufficient structured places for hub ${hub.name}; using fallback`);
    return {
      plan: postProcessItinerary(
        buildFallbackItinerary(places, perPersonCap, mood),
        places,
        hub,
        perPersonCap,
        mood,
        profile
      ),
      method: 'rule_based_fallback',
      model: null,
    };
  }

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

  const fallbackSeed = buildFallbackItinerary(topCandidates, perPersonCap, mood);
  const generatorRolePromptInput: GeneratorRefinePromptShape = {
    stops: fallbackSeed.stops,
    total_cost_per_person: fallbackSeed.total_cost_per_person,
    duration_total_mins: calcDurationMins(fallbackSeed),
    vibe: mood,
    travel_summary: undefined,
  };
  const generatorRolePrompt = buildGeneratorAgentPrompt(generatorRolePromptInput);

  const finalizePlan = (input: AIItineraryResponse): AIItineraryResponse => {
    let next = postProcessItinerary(input, topCandidates, hub, perPersonCap, mood, profile);
    if (next.total_cost_per_person > perPersonCap) {
      next = adjustBudget(next, perPersonCap);
    }
    return next;
  };

  const buildFallback = () => ({
    plan: postProcessItinerary(
      buildFallbackItinerary(topCandidates, perPersonCap, mood),
      topCandidates,
      hub,
      perPersonCap,
      mood,
      profile
    ),
    method: 'rule_based_fallback' as const,
    model: null,
  });

  try {
    // 1) Generator agent: produce initial itinerary.
    const generatorClient = getGroqClient('generator');
    const generatorResponse = await generatorClient.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content:
            `${prompt}\n\nRole constraints for generator agent:\n${generatorRolePrompt}\n\n` +
            'Final output contract for this call: return full AIItineraryResponse JSON only.',
        },
      ],
    });

    const generatorText = generatorResponse.choices[0]?.message?.content || '';
    const generated = tryParseItinerary(generatorText);
    const collectedRetryIssues: string[] = [];

    if (generated) {
      const generatedPlan = finalizePlan(generated);
      const localGate = evaluateItineraryRules(generatedPlan, topCandidates, perPersonCap);
      const overseerGate = await runOverseerAudit(generatedPlan, topCandidates, mood, profile, perPersonCap);

      // 2) Overseer agent: audit quality before acceptance.
      if (localGate.passed && overseerGate.approved) {
        return { plan: generatedPlan, method: 'ai', model: MODEL };
      }
      collectedRetryIssues.push(...localGate.issues, ...overseerGate.issues);
    } else {
      collectedRetryIssues.push('Generator returned invalid JSON or schema-invalid output.');
    }

    // 3) Retry agent: regenerate when generator or overseer gates fail.
    const retryIssues = collectedRetryIssues
      .filter(Boolean)
      .slice(0, 8)
      .map((issue) => `- ${issue}`)
      .join('\n');

    const retryClient = getGroqClient('retry');
    const retryPrompt = buildRetryAgentPrompt({
      current_itinerary: generated
        ? finalizePlan(generated)
        : buildFallbackItinerary(topCandidates, perPersonCap, mood),
      issues: collectedRetryIssues,
      candidate_places: topCandidates,
      budget: perPersonCap,
      vibe: mood,
    });
    const retryResponse = await retryClient.chat.completions.create({
      model: MODEL,
      temperature: 0.15,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content:
            `${retryPrompt}\n\n${prompt}\n\n${RETRY_SUFFIX}\n\n` +
            `Regenerate and fix these failures strictly:\n${retryIssues}\n` +
            'Use only candidate venue names exactly as listed. Do not invent any venue. Return full AIItineraryResponse JSON only.',
        },
      ],
    });

    const retryText = retryResponse.choices[0]?.message?.content || '';
    const regenerated = tryParseItinerary(retryText);
    if (regenerated) {
      const regeneratedPlan = finalizePlan(regenerated);
      const retryLocalGate = evaluateItineraryRules(regeneratedPlan, topCandidates, perPersonCap);
      const retryOverseerGate = await runOverseerAudit(regeneratedPlan, topCandidates, mood, profile, perPersonCap);

      if (retryLocalGate.passed && retryOverseerGate.approved) {
        return { plan: regeneratedPlan, method: 'ai', model: MODEL };
      }
    }

    console.warn(`[AI] Generator/Retry quality gates failed for hub ${hub.name}, using fallback`);
    return buildFallback();
  } catch (err) {
    console.error(`[AI] Error generating for hub ${hub.name}:`, err);
    return buildFallback();
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
    let chosen = closestCandidateByName(stop.place_name, candidates, used);

    if (!chosen || placeNameLooksGeneric(stop.place_name)) {
      chosen = pickByType(preferredType, candidates, used) || pickFallbackCandidate(candidates, used);
    }

    if (!chosen && candidates.length > 0) {
      chosen = candidates[index % candidates.length];
    }

    if (chosen) {
      used.add(chosen.name);
    }

    const finalCost = chosen?.estimated_cost !== undefined
      ? Math.round(Math.min(perPersonCap, chosen.estimated_cost))
      : 0;

    const hasCoords = chosen?.lat !== undefined && chosen?.lng !== undefined;
    const distanceKm =
      hasCoords
        ? Math.round(haversineDistance(previousPoint, { lat: Number(chosen?.lat), lng: Number(chosen?.lng) }) * 10) / 10
        : Math.round(((index === 0 ? 10 : stop.walk_from_previous_mins) * 4.5 / 60) * 10) / 10;

    const walk =
      hasCoords
        ? walkMins(previousPoint, { lat: Number(chosen?.lat), lng: Number(chosen?.lng) })
        : index === 0
        ? 10
        : stop.walk_from_previous_mins;

    if (hasCoords) {
      previousPoint = { lat: Number(chosen?.lat), lng: Number(chosen?.lng) };
    }

    const safeName = chosen?.name || (candidates[index % candidates.length]?.name || stop.place_name);
    const safeType = chosen?.type || preferredType;

    return {
      ...stop,
      place_name: safeName,
      place_type: safeType,
      estimated_cost_per_person: finalCost,
      walk_from_previous_mins: walk,
      distance_from_previous_km: distanceKm,
      lat: hasCoords ? Number(chosen?.lat) : undefined,
      lng: hasCoords ? Number(chosen?.lng) : undefined,
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
