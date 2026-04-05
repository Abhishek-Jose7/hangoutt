import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';

// DELETE /api/users/me — GDPR: clear private location and budget data
export async function DELETE() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        { status: 401 }
      );
    }

    const supabase = getSupabaseServer();

    const { error: memberError } = await supabase
      .from('room_members')
      .update({
        budget: null,
        lat: null,
        lng: null,
        location_name: null,
        nearest_station: null,
      })
      .eq('user_id', userId);

    if (memberError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: memberError.message } },
        { status: 500 }
      );
    }

    const { error: userError } = await supabase
      .from('users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', userId);

    if (userError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: userError.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Users] DELETE /me error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
