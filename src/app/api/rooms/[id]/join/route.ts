import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';

// POST /api/rooms/[id]/join — Join a room
export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]'>
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

    // Get room
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single();

    if (roomError || !room) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    // Check if room has started planning
    if (room.status !== 'lobby') {
      // Check if user is already a member (idempotent for admin)
      const { data: existing } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', id)
        .eq('user_id', userId)
        .single();

      if (existing) {
        return NextResponse.json({ message: 'Already a member', room_id: id });
      }

      return NextResponse.json(
        { error: { code: 'ROOM_STARTED', message: 'Room has started planning — ask the admin to let you in' } },
        { status: 409 }
      );
    }

    // Check expiry
    if (new Date(room.expires_at) < new Date()) {
      return NextResponse.json(
        { error: { code: 'EXPIRED', message: 'This room has expired — create a new one' } },
        { status: 410 }
      );
    }

    // Ensure user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (!existingUser) {
      await supabase.from('users').upsert({
        id: userId,
        email: `${userId}@placeholder.com`,
        name: 'User',
      });
    }

    // Check if already a member (idempotent)
    const { data: existingMember } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', id)
      .eq('user_id', userId)
      .single();

    if (existingMember) {
      return NextResponse.json({ message: 'Already a member', room_id: id });
    }

    // Join
    const { error: joinError } = await supabase.from('room_members').insert({
      room_id: id,
      user_id: userId,
    });

    if (joinError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: joinError.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: 'Joined successfully', room_id: id }, { status: 201 });
  } catch (err) {
    console.error('[Join] Error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
