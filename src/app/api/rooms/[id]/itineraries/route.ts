import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { cacheGet } from '@/lib/redis';

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

// GET /api/rooms/[id]/itineraries — Get all itinerary options
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/itineraries'>
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
    const supabase = getSupabaseServer();

    // Verify membership
    const { data: member } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', id)
      .eq('user_id', userId)
      .single();

    if (!member) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'You are not a member of this room' } },
        { status: 403 }
      );
    }

    const { data: room } = await supabase
      .from('rooms')
      .select('status')
      .eq('id', id)
      .single();

    const { data: options, error } = await supabase
      .from('itinerary_options')
      .select('*')
      .eq('room_id', id)
      .order('option_number', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    if (room?.status === 'generating' && (!options || options.length === 0)) {
      const job = await cacheGet<GenerationJobStatus>(getJobKey(id));
      return NextResponse.json(
        {
          status: 'generating',
          options: [],
          job_status: job?.state || 'queued',
          error_message: job?.error_message || null,
        },
        { status: 202 }
      );
    }

    return NextResponse.json(options || []);
  } catch (err) {
    console.error('[Itineraries] GET error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
