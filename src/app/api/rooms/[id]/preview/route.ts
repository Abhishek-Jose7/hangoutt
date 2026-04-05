import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';

// GET /api/rooms/[inviteCode]/preview — Validate and preview room before join
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/preview'>
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        { status: 401 }
      );
    }

    const params = await ctx.params;
    const inviteCode = params.id;
    const supabase = getSupabaseServer();

    const { data: room, error } = await supabase
      .from('rooms')
      .select('id, name, mood, status, created_at')
      .eq('invite_code', inviteCode)
      .is('deleted_at', null)
      .single();

    if (error || !room) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    // Count members
    const { count } = await supabase
      .from('room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id);

    return NextResponse.json({
      ...room,
      member_count: count || 0,
    });
  } catch (err) {
    console.error('[Preview] Error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
