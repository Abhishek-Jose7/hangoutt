import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { JoinRoomRequestSchema } from '@/types';

// POST /api/rooms/[id]/join — Join a room
export async function POST(
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

    const body = await req.json();
    const parsed = JoinRoomRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    if (parsed.data.lat === 0 && parsed.data.lng === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid coordinates (0, 0)' } },
        { status: 400 }
      );
    }

    const clerkUser = await currentUser();
    const fallbackEmail = clerkUser?.primaryEmailAddress?.emailAddress || `${userId}@placeholder.com`;
    const clerkName =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim() ||
      clerkUser?.username ||
      fallbackEmail.split('@')[0];

    await supabase.from('users').upsert({
      id: userId,
      email: fallbackEmail,
      name: parsed.data.display_name || clerkName,
      avatar_url: clerkUser?.imageUrl || null,
    });

    // Check if already a member (idempotent)
    const { data: existingMember } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', id)
      .eq('user_id', userId)
      .single();

    if (existingMember) {
      await supabase
        .from('room_members')
        .update({
          budget: parsed.data.budget,
          lat: parsed.data.lat,
          lng: parsed.data.lng,
          location_name: parsed.data.location_name,
          nearest_station: parsed.data.nearest_station,
        })
        .eq('room_id', id)
        .eq('user_id', userId);

      return NextResponse.json({ message: 'Already a member', room_id: id, profile_updated: true });
    }

    // Join
    const { error: joinError } = await supabase.from('room_members').insert({
      room_id: id,
      user_id: userId,
      budget: parsed.data.budget,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      location_name: parsed.data.location_name,
      nearest_station: parsed.data.nearest_station,
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
