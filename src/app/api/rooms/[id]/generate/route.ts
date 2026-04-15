import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { generateHubCandidates } from '@/lib/location';
import { searchPlaces } from '@/lib/tavily';
import { generateGroundedItineraryForHub } from '@/lib/itinerary-engine';
import { reviewDeterministicItineraryWithGroq } from '@/lib/ai/generate-itinerary';
import { calculatePerPersonCap } from '@/lib/budget';
import { cacheGet, cacheIncr, cacheSet } from '@/lib/redis';
import { finalValidatePlacesBeforeEngine, validateGroundedPlaces } from '@/lib/place-validation';
import type { Mood, LatLng, ItineraryProfile, Place, AIItineraryResponse, HubCandidate } from '@/types';
import { z } from 'zod';

interface InsertItineraryRow {
  room_id: string;
  option_number: number;
  hub_name: string;
  hub_lat: number;
  hub_lng: number;
  hub_strategy: string;
  plan: AIItineraryResponse;
  total_cost_estimate: number;
  max_travel_time_mins: number;
  avg_travel_time_mins: number;
  travel_fairness_score: number;
  generation_method: 'ai' | 'rule_based_fallback';
  ai_model_version: string | null;
}

interface GenerationMember {
  user_id: string;
  display_name: string | null;
  budget: number | null;
  nearest_station: string | null;
}

interface HubGenerationCandidate {
  row: InsertItineraryRow;
  hub: HubCandidate;
  profile: ItineraryProfile;
  verifiedPlaces: Place[];
}

interface GenerationJobStatus {
  state: 'queued' | 'in_progress' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  options_count?: number;
  error_message?: string;
}

function getJobKey(roomId: string): string {
  return `generation_job:v1:${roomId}`;
}

const GenerateRequestSchema = z.object({
  meetup_start_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
});

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

const OPTION_PROFILES: ItineraryProfile[] = [
  'chill_walk',
  'activity_food',
  'premium_dining',
  'budget_bites',
];
const MAX_FINAL_OPTIONS = 4;

const HUB_GENERATION_TIMEOUT_MS = 65000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
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

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function calcDurationMins(plan: AIItineraryResponse): number {
  return plan.stops.reduce((sum, stop) => sum + stop.duration_mins + stop.walk_from_previous_mins, 0);
}

function buildFlowSummary(plan: AIItineraryResponse): string {
  if (!plan.stops.length) return '';
  const first = plan.stops[0].place_name;
  const tail = plan.stops.slice(1).map((stop) => {
    const mode = stop.walk_from_previous_mins > 16 ? 'auto' : 'walk';
    return `${mode} -> ${stop.place_name}`;
  });
  return [first, ...tail].join(' -> ');
}

function calcAveragePlaceRating(plan: AIItineraryResponse, places: Place[]): number {
  const byName = new Map(places.map((p) => [p.name.toLowerCase(), p]));
  const ratings = plan.stops
    .map((s) => byName.get(s.place_name.toLowerCase())?.inferred_rating)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
  if (!ratings.length) return 0;
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return Math.round(avg * 10) / 10;
}

function calcVibeMatch(plan: AIItineraryResponse, mood: Mood, profile: ItineraryProfile): number {
  const text = `${plan.day_summary} ${plan.stops.map((s) => `${s.place_name} ${s.vibe_note}`).join(' ')}`.toLowerCase();
  const moodTokens: Record<Mood, string[]> = {
    fun: ['social', 'lively', 'music', 'arcade', 'energy'],
    chill: ['cozy', 'calm', 'slow', 'walk', 'relax'],
    romantic: ['romantic', 'date', 'sunset', 'dessert', 'aesthetic'],
    adventure: ['action', 'escape', 'thrill', 'bowling', 'trampoline'],
  };
  const profileTypeExpect: Record<ItineraryProfile, string[]> = {
    chill_walk: ['cafe', 'outdoor'],
    activity_food: ['activity', 'restaurant'],
    premium_dining: ['restaurant', 'cafe'],
    budget_bites: ['restaurant', 'outdoor'],
  };
  const keywordHits = moodTokens[mood].filter((token) => text.includes(token)).length;
  const typeSet = new Set(plan.stops.map((s) => s.place_type));
  const profileHits = profileTypeExpect[profile].filter((t) => typeSet.has(t as 'cafe' | 'activity' | 'restaurant' | 'outdoor')).length;
  return clamp01(keywordHits / 4 * 0.65 + profileHits / profileTypeExpect[profile].length * 0.35);
}

function calcBudgetMatch(totalCost: number, perPersonCap: number): number {
  if (totalCost <= 0) return 0.45;
  const ratio = totalCost / perPersonCap;
  if (ratio <= 0.6) return 0.95;
  if (ratio <= 0.85) return 0.9;
  if (ratio <= 1.0) return 0.78;
  if (ratio <= 1.15) return 0.45;
  return 0.2;
}

function calcDistanceScore(avgTravelMins: number): number {
  if (avgTravelMins <= 20) return 1;
  if (avgTravelMins <= 30) return 0.82;
  if (avgTravelMins <= 40) return 0.62;
  if (avgTravelMins <= 55) return 0.4;
  return 0.25;
}

function calcPlaceQualityScore(plan: AIItineraryResponse, places: Place[], averagePlaceRating: number): number {
  const byName = new Map(places.map((place) => [place.name.toLowerCase(), place]));
  const matched = plan.stops
    .map((stop) => byName.get(stop.place_name.toLowerCase()))
    .filter((place): place is Place => Boolean(place));

  const ratingComponent = averagePlaceRating > 0 ? clamp01((averagePlaceRating - 3) / 2) : 0.45;
  const popularityComponent = matched.length
    ? clamp01(
        matched.reduce((sum, place) => sum + (typeof place.popularity === 'number' ? place.popularity : 50), 0) /
          (matched.length * 100)
      )
    : 0.5;
  const confidenceComponent = matched.length
    ? clamp01(matched.reduce((sum, place) => sum + (place.confidence_score || 0), 0) / matched.length)
    : 0.5;

  return Math.round((ratingComponent * 0.5 + popularityComponent * 0.3 + confidenceComponent * 0.2) * 100) / 100;
}

function calcHardPenalty(params: {
  avgTravelMins: number;
  maxTravelMins: number;
  totalCost: number;
  perPersonCap: number;
}): number {
  let penalty = 0;

  const budgetRatio = params.totalCost / Math.max(params.perPersonCap, 1);
  if (budgetRatio > 1) {
    penalty += Math.min(0.45, (budgetRatio - 1) * 0.9);
  }

  if (params.avgTravelMins > 55) penalty += 0.12;
  if (params.maxTravelMins > 80) penalty += 0.14;
  if (params.maxTravelMins > 95) penalty += 0.16;

  return Math.min(0.55, penalty);
}

function calcWeightedOptionScore(params: {
  distanceScore: number;
  budgetMatch: number;
  vibeMatch: number;
  placeQualityScore: number;
  penalty: number;
}): number {
  const weighted =
    params.distanceScore * 0.32 +
    params.budgetMatch * 0.26 +
    params.vibeMatch * 0.24 +
    params.placeQualityScore * 0.18;

  return Math.round(clamp01(weighted - params.penalty) * 100) / 100;
}

function optionTypeSignature(plan: AIItineraryResponse): string {
  return plan.stops.map((stop) => stop.place_type).join('>');
}

function optionSimilarity(a: AIItineraryResponse, b: AIItineraryResponse): number {
  const namesA = new Set(a.stops.map((stop) => stop.place_name.toLowerCase()));
  const namesB = new Set(b.stops.map((stop) => stop.place_name.toLowerCase()));
  const overlap = [...namesA].filter((name) => namesB.has(name)).length;
  const union = new Set([...namesA, ...namesB]).size || 1;
  const nameJaccard = overlap / union;

  const typeSeqMatch = optionTypeSignature(a) === optionTypeSignature(b) ? 1 : 0;
  const vibeGap = Math.abs((a.dominant_vibe_match_pct || 0) - (b.dominant_vibe_match_pct || 0)) / 100;
  const profileMatch = a.profile && b.profile && a.profile === b.profile ? 1 : 0;

  return clamp01(nameJaccard * 0.52 + typeSeqMatch * 0.28 + (1 - vibeGap) * 0.12 + profileMatch * 0.08);
}

function rankCandidatesWithDiversity(
  candidates: HubGenerationCandidate[],
  maxCount: number
): HubGenerationCandidate[] {
  const remaining = [...candidates];
  const selected: HubGenerationCandidate[] = [];

  while (remaining.length > 0 && selected.length < maxCount) {
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const candidatePlan = candidate.row.plan;
      const baseScore = Number(candidatePlan.score_breakdown?.total_score || 0);

      const maxSimilarity = selected.length
        ? Math.max(
            ...selected.map((picked) => optionSimilarity(candidatePlan, picked.row.plan))
          )
        : 0;

      const adjustedScore = baseScore - maxSimilarity * 0.18;
      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected.map((candidate, index) => ({
    ...candidate,
    row: {
      ...candidate.row,
      option_number: index + 1,
    },
  }));
}

function whyThisOption(profile: ItineraryProfile, budgetMatch: number, distanceScore: number): string {
  const profileReasons: Record<ItineraryProfile, string> = {
    chill_walk: 'Relaxed pace with easy transitions and low stress movement.',
    activity_food: 'Strong activity anchor followed by a practical food stop.',
    premium_dining: 'Higher-end social experience built around dining quality.',
    budget_bites: 'Value-first pick that keeps costs controlled and simple.',
  };

  if (budgetMatch >= 0.85 && distanceScore >= 0.8) {
    return 'Best overall balance of cost and commute fairness for the group.';
  }

  return profileReasons[profile];
}

function buildEmergencyFallbackPlan(params: {
  hub: { name: string; lat: number; lng: number };
  mood: Mood;
  perPersonCap: number;
  meetupStartTime: string;
  reason: string;
}): AIItineraryResponse {
  const typeByMood: Record<Mood, Array<'cafe' | 'activity' | 'restaurant' | 'outdoor'>> = {
    fun: ['activity', 'restaurant', 'cafe'],
    chill: ['cafe', 'outdoor', 'restaurant'],
    romantic: ['restaurant', 'outdoor', 'cafe'],
    adventure: ['activity', 'outdoor', 'restaurant'],
  };

  const labelsByType: Record<'cafe' | 'activity' | 'restaurant' | 'outdoor', string> = {
    cafe: 'Cafe',
    activity: 'Activity Spot',
    restaurant: 'Restaurant',
    outdoor: 'Walk Area',
  };

  const costs = [0.2, 0.34, 0.28].map((ratio) => Math.max(80, Math.round(params.perPersonCap * ratio)));
  const durations = [65, 95, 80];
  const walkMins = [8, 14, 12];
  const deltas = [
    { lat: 0, lng: 0 },
    { lat: 0.0032, lng: 0.0023 },
    { lat: -0.0026, lng: 0.0018 },
  ];

  let cursor = toMinutes(params.meetupStartTime);
  const stops = typeByMood[params.mood].map((type, index) => {
    const lat = Number((params.hub.lat + deltas[index].lat).toFixed(6));
    const lng = Number((params.hub.lng + deltas[index].lng).toFixed(6));
    const name = `${params.hub.name} ${labelsByType[type]}`;
    const start = toHHMM(cursor);
    cursor += durations[index] + walkMins[index];

    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}(${encodeURIComponent(name)})`;

    return {
      stop_number: index + 1,
      place_name: name,
      place_type: type,
      category_label: type,
      lat,
      lng,
      start_time: start,
      duration_mins: durations[index],
      estimated_cost_per_person: costs[index],
      walk_from_previous_mins: walkMins[index],
      distance_from_previous_km: Number((0.7 + index * 0.4).toFixed(1)),
      vibe_note: `${params.mood} aligned fallback stop in ${params.hub.name}`,
      map_url: mapUrl,
      google_maps_url: mapUrl,
      osm_maps_url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`,
      source_url: mapUrl,
    };
  });

  const total = stops.reduce((sum, stop) => sum + stop.estimated_cost_per_person, 0);

  return {
    stops,
    total_cost_per_person: total,
    contingency_buffer: Math.round(total * 0.12),
    day_summary: `Fallback grounded itinerary for ${params.hub.name}. Triggered because: ${params.reason}`,
    short_title: `${params.hub.name} - Reliable fallback plan`,
    area: params.hub.name,
    vibe_tags: [params.mood, 'fallback', 'deterministic'],
    meetup_start_time: params.meetupStartTime,
  };
}

function buildMemberTravelInsights(params: {
  plan: AIItineraryResponse;
  membersWithLocations: GenerationMember[];
  hubTravelTimes: number[];
  perPersonCap: number;
  fairnessScore: number;
}): {
  member_travel_breakdown: AIItineraryResponse['member_travel_breakdown'];
  travel_summary: AIItineraryResponse['travel_summary'];
} {
  const inAreaTravelMins = params.plan.stops.reduce((sum, stop) => sum + stop.walk_from_previous_mins, 0);

  const memberBreakdown = params.membersWithLocations.map((member, index) => {
    const toHubMins = Math.max(5, Math.round(params.hubTravelTimes[index] ?? 45));
    const totalTravelMins = toHubMins + inAreaTravelMins;
    const budgetCap = member.budget && member.budget > 0 ? Number(member.budget) : params.perPersonCap;

    return {
      user_id: member.user_id,
      member_name: member.display_name || member.user_id,
      budget_cap: budgetCap,
      to_hub_mins: toHubMins,
      in_area_travel_mins: inAreaTravelMins,
      total_travel_mins: totalTravelMins,
      suits_budget: params.plan.total_cost_per_person <= budgetCap,
      suits_travel: totalTravelMins <= Math.max(95, Math.round((params.hubTravelTimes[index] ?? 45) * 2.25)),
    };
  });

  const totals = memberBreakdown.map((member) => member.total_travel_mins);
  const avg = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
  const max = totals.length ? Math.max(...totals) : 0;
  const fairnessLabel = params.fairnessScore >= 0.85
    ? 'high fairness'
    : params.fairnessScore >= 0.7
    ? 'balanced'
    : 'moderate fairness';

  return {
    member_travel_breakdown: memberBreakdown,
    travel_summary: {
      avg_total_travel_mins: avg,
      max_total_travel_mins: max,
      fairness_indicator: fairnessLabel,
    },
  };
}

function buildEnrichedPlan(params: {
  plan: AIItineraryResponse;
  verifiedPlaces: Place[];
  hub: HubCandidate;
  mood: Mood;
  profile: ItineraryProfile;
  perPersonCap: number;
  meetupStartTime: string;
  membersWithLocations: GenerationMember[];
}): AIItineraryResponse {
  const { plan, verifiedPlaces, hub, mood, profile, perPersonCap, meetupStartTime, membersWithLocations } = params;

  const firstStopTime = plan.stops?.[0]?.start_time || meetupStartTime;
  const firstStopMins = toMinutes(firstStopTime);
  const stationGuidance = membersWithLocations.map((member, memberIndex) => {
    const travelMins = Math.max(5, Math.round(hub.travelTimes[memberIndex] ?? 45));
    const bufferMins = 8;
    const reachStationBy = toHHMM(firstStopMins - travelMins - bufferMins);
    const arriveHubBy = toHHMM(firstStopMins - 2);
    return {
      member_name: member.display_name || member.user_id,
      station: member.nearest_station || 'Nearest station',
      train_travel_mins: travelMins,
      reach_station_by: reachStationBy,
      arrive_hub_by: arriveHubBy,
    };
  });

  const durationTotalMins = calcDurationMins(plan);
  const averagePlaceRating = calcAveragePlaceRating(plan, verifiedPlaces);
  const distanceScore = calcDistanceScore(Math.round(hub.avgTravelTime));
  const budgetMatch = calcBudgetMatch(plan.total_cost_per_person, perPersonCap);
  const vibeMatch = calcVibeMatch(plan, mood, profile);
  const placeQualityScore = calcPlaceQualityScore(plan, verifiedPlaces, averagePlaceRating);
  const penalty = calcHardPenalty({
    avgTravelMins: Math.round(hub.avgTravelTime),
    maxTravelMins: Math.round(hub.maxTravelTime),
    totalCost: plan.total_cost_per_person,
    perPersonCap,
  });
  const totalScore = calcWeightedOptionScore({
    distanceScore,
    budgetMatch,
    vibeMatch,
    placeQualityScore,
    penalty,
  });
  const travelInsights = buildMemberTravelInsights({
    plan,
    membersWithLocations,
    hubTravelTimes: hub.travelTimes,
    perPersonCap,
    fairnessScore: hub.fairnessScore,
  });

  return {
    ...plan,
    meetup_start_time: meetupStartTime,
    station_guidance: stationGuidance,
    area: plan.area || hub.name,
    profile,
    flow_summary: plan.flow_summary || buildFlowSummary(plan),
    duration_total_mins: durationTotalMins,
    average_place_rating: averagePlaceRating,
    score_breakdown: {
      distance_score: Math.round(distanceScore * 100) / 100,
      budget_match: Math.round(budgetMatch * 100) / 100,
      vibe_match: Math.round(vibeMatch * 100) / 100,
      rating_score: Math.round(placeQualityScore * 100) / 100,
      total_score: Math.round(totalScore * 100) / 100,
    },
    dominant_vibe_match_pct: Math.round(vibeMatch * 100),
    budget_breakdown: {
      stop_cost_total: plan.total_cost_per_person,
      contingency_buffer: plan.contingency_buffer,
      total_with_contingency: plan.total_cost_per_person + plan.contingency_buffer,
      cap_per_person: perPersonCap,
      within_cap: plan.total_cost_per_person <= perPersonCap,
    },
    member_travel_breakdown: travelInsights.member_travel_breakdown,
    travel_summary: travelInsights.travel_summary,
    why_this_option: plan.why_this_option || whyThisOption(profile, budgetMatch, distanceScore),
  };
}

async function runGenerationJob(roomId: string, meetupStartTime: string): Promise<void> {
  const supabase = getSupabaseServer();

  await cacheSet(getJobKey(roomId), {
    state: 'in_progress',
    started_at: new Date().toISOString(),
  } satisfies GenerationJobStatus, 3600);

  try {
    const { data: room } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (!room || room.status !== 'generating') {
      throw new Error('Room is not ready for generation');
    }

    const { data: members } = await supabase
      .from('room_members')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });

    if (!members || members.length < 2) {
      throw new Error('Need at least 2 members with locations');
    }

    const membersWithLocations = members.filter(
      (member) => member.lat !== null && member.lng !== null
    );

    if (membersWithLocations.length < 2) {
      throw new Error(
        `Waiting for ${members.length - membersWithLocations.length} members to add their location`
      );
    }

    const memberLocations: LatLng[] = membersWithLocations.map((member) => ({
      lat: Number(member.lat),
      lng: Number(member.lng),
    }));

    const memberStations = membersWithLocations.map(
      (member) => member.nearest_station || 'Dadar'
    );

    const budgets = members.map((member) => (member.budget ? Number(member.budget) : null));
    const perPersonCap = calculatePerPersonCap(budgets);
    const mood = room.mood as Mood;
    const generationStartedAt = new Date().toISOString();

    const hubs = generateHubCandidates(memberLocations, memberStations, mood);
    await supabase.from('itinerary_options').delete().eq('room_id', roomId);

    let nextOptionNumber = 1;
    let insertedCount = 0;
    let switchedToVoting = false;

    const insertOption = async (candidate: HubGenerationCandidate) => {
      if (nextOptionNumber > MAX_FINAL_OPTIONS) return;

      const optionNumber = nextOptionNumber;
      nextOptionNumber += 1;

      const row: InsertItineraryRow = {
        ...candidate.row,
        option_number: optionNumber,
      };

      const { error: insertError } = await supabase
        .from('itinerary_options')
        .insert([row]);

      if (insertError) {
        throw new Error(insertError.message);
      }

      insertedCount += 1;

      if (!switchedToVoting) {
        await supabase.from('rooms').update({ status: 'voting' }).eq('id', roomId);
        switchedToVoting = true;
      }

      await cacheSet(getJobKey(roomId), {
        state: 'in_progress',
        started_at: generationStartedAt,
        options_count: insertedCount,
      } satisfies GenerationJobStatus, 3600);
    };

    const hubTasks = hubs.map((hub, index) =>
      withTimeout(
        (async () => {
          const preferredProfile = OPTION_PROFILES[index % OPTION_PROFILES.length];
          const groupSize = members.length;
          const places = await searchPlaces(hub.name, { lat: hub.lat, lng: hub.lng }, mood, perPersonCap, groupSize);
          const preValidatedPlaces = finalValidatePlacesBeforeEngine(places);
          const verifiedPlaces = validateGroundedPlaces(preValidatedPlaces, { lat: hub.lat, lng: hub.lng });
          if (verifiedPlaces.length < 3) {
            throw new Error(`Insufficient verified places for hub ${hub.name}`);
          }

          const hubCandidates: HubGenerationCandidate[] = [];

          for (const profile of OPTION_PROFILES) {
            try {
              const { plan, method, model } = generateGroundedItineraryForHub({
                hub,
                places: verifiedPlaces,
                mood,
                perPersonCap,
                profile,
                meetupStartTime,
                groupSize,
              });

              const enrichedPlan = buildEnrichedPlan({
                plan,
                verifiedPlaces,
                hub,
                mood,
                profile,
                perPersonCap,
                meetupStartTime,
                membersWithLocations,
              });

              hubCandidates.push({
                row: {
                  room_id: roomId,
                  option_number: 0,
                  hub_name: hub.name,
                  hub_lat: hub.lat,
                  hub_lng: hub.lng,
                  hub_strategy: hub.strategy,
                  plan: enrichedPlan,
                  total_cost_estimate: enrichedPlan.total_cost_per_person,
                  max_travel_time_mins: Math.round(hub.maxTravelTime),
                  avg_travel_time_mins: Math.round(hub.avgTravelTime),
                  travel_fairness_score: Math.round(hub.fairnessScore * 100) / 100,
                  generation_method: method,
                  ai_model_version: model,
                },
                hub,
                profile,
                verifiedPlaces,
              });
            } catch {
              // Skip weak profile fit for this hub.
            }
          }

          // Recovery pass: allow slightly relaxed budget cap to avoid synthetic fallback on sparse/strict hubs.
          if (!hubCandidates.length) {
            const relaxedCap = Math.round(perPersonCap * 1.25);
            for (const profile of OPTION_PROFILES) {
              try {
                const { plan, method, model } = generateGroundedItineraryForHub({
                  hub,
                  places: verifiedPlaces,
                  mood,
                  perPersonCap: relaxedCap,
                  profile,
                  meetupStartTime,
                  groupSize,
                });

                const enrichedPlan = {
                  ...buildEnrichedPlan({
                    plan,
                    verifiedPlaces,
                    hub,
                    mood,
                    profile,
                    perPersonCap,
                    meetupStartTime,
                    membersWithLocations,
                  }),
                  why_this_option:
                    plan.why_this_option ||
                    'Recovery mode: relaxed budget-fit constraints used to keep real nearby places.',
                };

                hubCandidates.push({
                  row: {
                    room_id: roomId,
                    option_number: 0,
                    hub_name: hub.name,
                    hub_lat: hub.lat,
                    hub_lng: hub.lng,
                    hub_strategy: hub.strategy,
                    plan: enrichedPlan,
                    total_cost_estimate: enrichedPlan.total_cost_per_person,
                    max_travel_time_mins: Math.round(hub.maxTravelTime),
                    avg_travel_time_mins: Math.round(hub.avgTravelTime),
                    travel_fairness_score: Math.round(hub.fairnessScore * 100) / 100,
                    generation_method: method,
                    ai_model_version: `${model}-recovery`,
                  },
                  hub,
                  profile,
                  verifiedPlaces,
                });
              } catch {
                // Continue trying other profiles.
              }
            }
          }

          if (!hubCandidates.length) {
            throw new Error(`No viable itinerary variants for hub ${hub.name}`);
          }

          const bestByDiversity = rankCandidatesWithDiversity(hubCandidates, 1);
          const bestCandidate = bestByDiversity[0] || hubCandidates[0];

          const shouldReview =
            bestCandidate.row.generation_method === 'ai' &&
            bestCandidate.verifiedPlaces.length >= 2;

          let finalCandidate = bestCandidate;
          if (shouldReview) {
            try {
              const reviewed = await reviewDeterministicItineraryWithGroq({
                plan: bestCandidate.row.plan,
                candidates: bestCandidate.verifiedPlaces,
                hub: bestCandidate.hub,
                mood,
                profile: bestCandidate.profile,
                perPersonCap,
              });

              const reviewedPlan = buildEnrichedPlan({
                plan: reviewed.plan,
                verifiedPlaces: bestCandidate.verifiedPlaces,
                hub: bestCandidate.hub,
                mood,
                profile: bestCandidate.profile,
                perPersonCap,
                meetupStartTime,
                membersWithLocations,
              });

              finalCandidate = {
                ...bestCandidate,
                row: {
                  ...bestCandidate.row,
                  plan: reviewedPlan,
                  total_cost_estimate: reviewedPlan.total_cost_per_person,
                  ai_model_version: reviewed.model || bestCandidate.row.ai_model_version,
                },
              };
            } catch {
              // Keep deterministic version if AI review times out/fails.
            }
          }

          // Prefer the profile tied to this hub strategy unless score gap is meaningful.
          if (finalCandidate.profile !== preferredProfile) {
            const preferred = hubCandidates.find((candidate) => candidate.profile === preferredProfile);
            const currentScore = Number(finalCandidate.row.plan.score_breakdown?.total_score || 0);
            const preferredScore = Number(preferred?.row.plan.score_breakdown?.total_score || 0);
            if (preferred && preferredScore >= currentScore - 0.08) {
              finalCandidate = preferred;
            }
          }

          await insertOption(finalCandidate);
        })(),
        HUB_GENERATION_TIMEOUT_MS,
        `Hub ${hub.name} generation`
      ).catch(async (error: unknown) => {
        if (nextOptionNumber > MAX_FINAL_OPTIONS) return;

        const profile = OPTION_PROFILES[index % OPTION_PROFILES.length];
        const reason = error instanceof Error ? error.message : 'unknown_generation_error';
        const fallbackPlan = buildEmergencyFallbackPlan({
          hub,
          mood,
          perPersonCap,
          meetupStartTime,
          reason,
        });
        const enrichedPlan = {
          ...buildEnrichedPlan({
            plan: fallbackPlan,
            verifiedPlaces: [],
            hub,
            mood,
            profile,
            perPersonCap,
            meetupStartTime,
            membersWithLocations,
          }),
          why_this_option: `Reliable fallback option generated because primary pipeline failed: ${reason}`,
        };

        const fallbackCandidate: HubGenerationCandidate = {
          row: {
            room_id: roomId,
            option_number: 0,
            hub_name: hub.name,
            hub_lat: hub.lat,
            hub_lng: hub.lng,
            hub_strategy: hub.strategy,
            plan: enrichedPlan,
            total_cost_estimate: fallbackPlan.total_cost_per_person,
            max_travel_time_mins: Math.round(hub.maxTravelTime),
            avg_travel_time_mins: Math.round(hub.avgTravelTime),
            travel_fairness_score: Math.round(hub.fairnessScore * 100) / 100,
            generation_method: 'rule_based_fallback',
            ai_model_version: null,
          },
          hub,
          profile,
          verifiedPlaces: [],
        };

        await insertOption(fallbackCandidate);
      })
    );

    await Promise.allSettled(hubTasks);

    if (insertedCount === 0) {
      throw new Error('All itinerary generations failed. Please try again.');
    }

    await cacheSet(getJobKey(roomId), {
      state: 'completed',
      started_at: generationStartedAt,
      completed_at: new Date().toISOString(),
      options_count: insertedCount,
    } satisfies GenerationJobStatus, 3600);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    await supabase.from('rooms').update({ status: 'planning' }).eq('id', roomId);
    await cacheSet(getJobKey(roomId), {
      state: 'failed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error_message: message,
    } satisfies GenerationJobStatus, 3600);
  }
}

// POST /api/rooms/[id]/generate — Generate 4 itineraries
export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/generate'>
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        { status: 401 }
      );
    }

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const parsedBody = GenerateRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid meetup start time' } },
        { status: 400 }
      );
    }
    const meetupStartTime = parsedBody.data.meetup_start_time || '12:00';
    const supabase = getSupabaseServer();

    // Verify admin + room status
    const { data: room } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single();

    if (!room || room.admin_id !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only admin can generate itineraries' } },
        { status: 403 }
      );
    }

    if (room.status !== 'planning') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: `Cannot generate from ${room.status} state` } },
        { status: 400 }
      );
    }

    // Rate limit: max 5 generations per room per day
    const rateLimitKey = `gen_limit:${id}:${new Date().toISOString().slice(0, 10)}`;
    const count = await cacheIncr(rateLimitKey, 86400);
    if (count !== null && count > 5) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Maximum 5 generations per day reached' } },
        { status: 429 }
      );
    }

    const existingJob = await cacheGet<GenerationJobStatus>(getJobKey(id));
    if (existingJob?.state === 'in_progress') {
      return NextResponse.json(
        {
          success: true,
          status: 'generating',
          job_status: existingJob.state,
          poll_url: `/api/rooms/${id}/itineraries`,
        },
        { status: 202 }
      );
    }

    // Update status to generating
    await supabase.from('rooms').update({ status: 'generating' }).eq('id', id);

    // Get all members with locations
    const { data: members } = await supabase
      .from('room_members')
      .select('*')
      .eq('room_id', id);

    if (!members || members.length < 2) {
      await supabase.from('rooms').update({ status: 'planning' }).eq('id', id);
      return NextResponse.json(
        { error: { code: 'INSUFFICIENT_DATA', message: 'Need at least 2 members with locations' } },
        { status: 400 }
      );
    }

    // Check all members have locations
    const membersWithLocations = members.filter(
      (m) => m.lat !== null && m.lng !== null
    );

    if (membersWithLocations.length < 2) {
      await supabase.from('rooms').update({ status: 'planning' }).eq('id', id);
      return NextResponse.json(
        { error: { code: 'MISSING_LOCATIONS', message: `Waiting for ${members.length - membersWithLocations.length} members to add their location` } },
        { status: 400 }
      );
    }

    await cacheSet(getJobKey(id), {
      state: 'queued',
      started_at: new Date().toISOString(),
    } satisfies GenerationJobStatus, 3600);

    void runGenerationJob(id, meetupStartTime);

    return NextResponse.json(
      {
        success: true,
        status: 'generating',
        job_status: 'queued',
        poll_url: `/api/rooms/${id}/itineraries`,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error('[Generate] Error:', err);
    // Try to reset status
    try {
      const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
      const supabase = getSupabaseServer();
      await supabase.from('rooms').update({ status: 'planning' }).eq('id', id);
    } catch {
      // ignore
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Generation failed' } },
      { status: 500 }
    );
  }
}
