import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { VoteRequestSchema } from '@/types';

// POST /api/rooms/[id]/vote — Cast a vote (upsert)
export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/vote'>
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

    const body = await req.json();
    const parsed = VoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    // Delete existing vote and insert new one (upsert pattern)
    await supabase
      .from('votes')
      .delete()
      .eq('room_id', id)
      .eq('user_id', userId);

    const { data: vote, error } = await supabase
      .from('votes')
      .insert({
        room_id: id,
        itinerary_option_id: parsed.data.itinerary_option_id,
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json(vote, { status: 201 });
  } catch (err) {
    console.error('[Vote] Error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
