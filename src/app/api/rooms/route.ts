import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { CreateRoomRequestSchema } from '@/types';
import { nanoid } from 'nanoid';

// POST /api/rooms — Create a new room
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = CreateRoomRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message, field: parsed.error.issues[0].path[0]?.toString() } },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServer();

    const clerkUser = await currentUser();
    const fallbackEmail = clerkUser?.primaryEmailAddress?.emailAddress || `${userId}@placeholder.com`;
    const clerkName =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim() ||
      clerkUser?.username ||
      fallbackEmail.split('@')[0];

    await supabase.from('users').upsert({
      id: userId,
      email: fallbackEmail,
      name: clerkName,
      avatar_url: clerkUser?.imageUrl || null,
    });

    const inviteCode = nanoid(8);

    const { data: room, error } = await supabase
      .from('rooms')
      .insert({
        name: parsed.data.name,
        invite_code: inviteCode,
        admin_id: userId,
        mood: parsed.data.mood,
        currency: parsed.data.currency,
      })
      .select()
      .single();

    if (error) {
      console.error('[Rooms] Create error:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Auto-join admin to room
    const { error: joinError } = await supabase.from('room_members').insert({
      room_id: room.id,
      user_id: userId,
    });

    if (joinError) {
      console.error('[Rooms] Admin join error:', joinError);
    }

    return NextResponse.json(room, { status: 201 });
  } catch (err) {
    console.error('[Rooms] Unexpected error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}

// GET /api/rooms — List user's rooms
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        { status: 401 }
      );
    }

    const supabase = getSupabaseServer();

    const { data: memberships, error: memberError } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', userId);

    if (memberError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: memberError.message } },
        { status: 500 }
      );
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json([]);
    }

    const roomIds = memberships.map((m) => m.room_id);

    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .in('id', roomIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (roomsError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: roomsError.message } },
        { status: 500 }
      );
    }

    return NextResponse.json(rooms || []);
  } catch (err) {
    console.error('[Rooms] List error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
