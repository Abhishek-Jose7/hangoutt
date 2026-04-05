import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';

// POST /api/rooms/[id]/start-planning — Transition lobby → planning
export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/start-planning'>
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

    // Verify admin
    const { data: room } = await supabase
      .from('rooms')
      .select('admin_id, status')
      .eq('id', id)
      .single();

    if (!room || room.admin_id !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only admin can start planning' } },
        { status: 403 }
      );
    }

    if (room.status !== 'lobby') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: `Cannot start planning from ${room.status} state` } },
        { status: 400 }
      );
    }

    // Check member count
    const { count } = await supabase
      .from('room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id);

    if (!count || count < 2) {
      return NextResponse.json(
        { error: { code: 'INSUFFICIENT_MEMBERS', message: 'You need at least 2 members to start planning' } },
        { status: 400 }
      );
    }

    // Transition to planning
    const { data: updated, error } = await supabase
      .from('rooms')
      .update({ status: 'planning' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[Planning] Start error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
