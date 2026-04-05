import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { UpdateRoomSchema } from '@/types';

// GET /api/rooms/[id] — Room details + members
export async function GET(
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

    // Check membership
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

    // Check expiry
    if (new Date(room.expires_at) < new Date() && room.status !== 'confirmed') {
      return NextResponse.json({
        ...room,
        status: 'expired',
        members: [],
      });
    }

    // Get members with user info
    const { data: members } = await supabase
      .from('room_members')
      .select('*, users(name, avatar_url, email)')
      .eq('room_id', id)
      .order('joined_at', { ascending: true });

    const normalizedMembers = (members || []).map((member) => {
      const email = member.users?.email || null;
      const rawName = member.users?.name || null;
      const normalizedName =
        rawName && rawName.trim().toLowerCase() !== 'user'
          ? rawName
          : email?.split('@')[0] || 'Member';

      return {
        ...member,
        users: {
          ...member.users,
          name: normalizedName,
        },
      };
    });

    // Get confirmed itinerary if exists
    const { data: confirmed } = await supabase
      .from('confirmed_itinerary')
      .select('*')
      .eq('room_id', id)
      .single();

    return NextResponse.json({
      ...room,
      members: normalizedMembers,
      confirmed_itinerary: confirmed || null,
      is_admin: room.admin_id === userId,
    });
  } catch (err) {
    console.error('[Room] GET error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}

// PATCH /api/rooms/[id] — Update room (admin only)
export async function PATCH(
  req: NextRequest,
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

    // Verify admin
    const { data: room } = await supabase
      .from('rooms')
      .select('admin_id')
      .eq('id', id)
      .single();

    if (!room || room.admin_id !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only admin can update the room' } },
        { status: 403 }
      );
    }

    const body = await req.json();
    const parsed = UpdateRoomSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { data: updated, error } = await supabase
      .from('rooms')
      .update(parsed.data)
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
    console.error('[Room] PATCH error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
