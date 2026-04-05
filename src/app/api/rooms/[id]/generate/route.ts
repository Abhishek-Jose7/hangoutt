import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { generateHubCandidates } from '@/lib/location';
import { searchPlaces } from '@/lib/tavily';
import { generateItineraryForHub } from '@/lib/ai/generate-itinerary';
import { calculatePerPersonCap } from '@/lib/budget';
import { cacheGet, cacheIncr, cacheSet } from '@/lib/redis';
import type { Mood, LatLng } from '@/types';
import { z } from 'zod';

interface InsertItineraryRow {
  room_id: string;
  option_number: number;
  hub_name: string;
  hub_lat: number;
  hub_lng: number;
  hub_strategy: string;
  plan: unknown;
  total_cost_estimate: number;
  max_travel_time_mins: number;
  avg_travel_time_mins: number;
  travel_fairness_score: number;
  generation_method: 'ai' | 'rule_based_fallback';
  ai_model_version: string | null;
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

    const hubs = generateHubCandidates(memberLocations, memberStations, mood);

    const results = await Promise.allSettled<InsertItineraryRow>(
      hubs.map(async (hub, index) => {
        const places = await searchPlaces(hub.name, { lat: hub.lat, lng: hub.lng }, mood, perPersonCap);
        const { plan, method, model } = await generateItineraryForHub(
          hub,
          places,
          members.length,
          mood,
          perPersonCap
        );

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

        const enrichedPlan = {
          ...plan,
          meetup_start_time: meetupStartTime,
          station_guidance: stationGuidance,
        };

        return {
          room_id: roomId,
          option_number: index + 1,
          hub_name: hub.name,
          hub_lat: hub.lat,
          hub_lng: hub.lng,
          hub_strategy: hub.strategy,
          plan: enrichedPlan,
          total_cost_estimate: plan.total_cost_per_person,
          max_travel_time_mins: Math.round(hub.maxTravelTime),
          avg_travel_time_mins: Math.round(hub.avgTravelTime),
          travel_fairness_score: Math.round(hub.fairnessScore * 100) / 100,
          generation_method: method,
          ai_model_version: model,
        };
      })
    );

    const itineraries = results
      .filter((result): result is PromiseFulfilledResult<InsertItineraryRow> => result.status === 'fulfilled')
      .map((result) => result.value);

    if (itineraries.length === 0) {
      throw new Error('All itinerary generations failed. Please try again.');
    }

    await supabase.from('itinerary_options').delete().eq('room_id', roomId);

    const { error: insertError } = await supabase
      .from('itinerary_options')
      .insert(itineraries);

    if (insertError) {
      throw new Error(insertError.message);
    }

    await supabase.from('rooms').update({ status: 'voting' }).eq('id', roomId);

    await cacheSet(getJobKey(roomId), {
      state: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      options_count: itineraries.length,
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
