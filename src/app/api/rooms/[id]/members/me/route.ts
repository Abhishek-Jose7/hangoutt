import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { findNearestStation } from '@/lib/transit';
import { UpdateMemberLocationSchema } from '@/types';

// PATCH /api/rooms/[id]/members/me — Update own location + budget
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/members/me'>
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
    const parsed = UpdateMemberLocationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    // Validate lat/lng are not (0, 0)
    if (parsed.data.lat === 0 && parsed.data.lng === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid coordinates (0, 0)', field: 'location' } },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, unknown> = { ...parsed.data };
    if (typeof parsed.data.lat === 'number' && typeof parsed.data.lng === 'number') {
      updatePayload.nearest_station = findNearestStation({
        lat: parsed.data.lat,
        lng: parsed.data.lng,
      }).name;
    }

    const { data: updated, error } = await supabase
      .from('room_members')
      .update(updatePayload)
      .eq('room_id', id)
      .eq('user_id', userId)
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
    console.error('[Members] Update error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}

// DELETE /api/rooms/[id]/members/me — Leave room
export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/members/me'>
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

    // Check if user is admin
    const { data: room } = await supabase
      .from('rooms')
      .select('admin_id')
      .eq('id', id)
      .single();

    if (room?.admin_id === userId) {
      // Transfer admin to earliest member
      const { data: members } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', id)
        .neq('user_id', userId)
        .order('joined_at', { ascending: true })
        .limit(1);

      if (members && members.length > 0) {
        await supabase
          .from('rooms')
          .update({ admin_id: members[0].user_id })
          .eq('id', id);
      }
    }

    const { error } = await supabase
      .from('room_members')
      .delete()
      .eq('room_id', id)
      .eq('user_id', userId);

    if (error) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: 'Left room successfully' });
  } catch (err) {
    console.error('[Members] Leave error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
