import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';

// DELETE /api/rooms/[id]/members/[userId] — Admin removes a member
export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/members/[userId]'>
) {
  try {
    const { userId: actorId } = await auth();
    if (!actorId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        { status: 401 }
      );
    }

    const { id: roomId, userId: targetUserId } = await ctx.params;
    const supabase = getSupabaseServer();

    const { data: room } = await supabase
      .from('rooms')
      .select('admin_id')
      .eq('id', roomId)
      .single();

    if (!room || room.admin_id !== actorId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only admin can remove members' } },
        { status: 403 }
      );
    }

    if (targetUserId === actorId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Admin cannot remove self using this endpoint' } },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('room_members')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', targetUserId);

    if (error) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Members] Admin remove error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
