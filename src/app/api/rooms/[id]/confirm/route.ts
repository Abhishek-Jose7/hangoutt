import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { ConfirmRequestSchema } from '@/types';

// POST /api/rooms/[id]/confirm — Lock final itinerary (admin only)
export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/confirm'>
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
        { error: { code: 'FORBIDDEN', message: 'Only admin can confirm' } },
        { status: 403 }
      );
    }

    if (room.status !== 'voting') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: `Cannot confirm from ${room.status} state` } },
        { status: 400 }
      );
    }

    const { count: totalMembers } = await supabase
      .from('room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id);

    const { count: totalVotes } = await supabase
      .from('votes')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id);

    const { data: earliestOption } = await supabase
      .from('itinerary_options')
      .select('generated_at')
      .eq('room_id', id)
      .order('generated_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const missingVotes = Math.max(0, (totalMembers || 0) - (totalVotes || 0));
    const votingStartTs = earliestOption?.generated_at
      ? new Date(earliestOption.generated_at).getTime()
      : null;
    const tenMins = 10 * 60 * 1000;
    const canConfirmNow =
      missingVotes === 0 || (votingStartTs !== null && Date.now() - votingStartTs >= tenMins);

    if (!canConfirmNow) {
      return NextResponse.json(
        { error: { code: 'TOO_EARLY', message: 'Confirm is available after all votes are cast or after 10 minutes.' } },
        { status: 409 }
      );
    }

    const body = await req.json();
    const parsed = ConfirmRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { data: votes } = await supabase
      .from('votes')
      .select('itinerary_option_id')
      .eq('room_id', id);

    const voteCounts: Record<string, number> = {};
    for (const vote of votes || []) {
      voteCounts[vote.itinerary_option_id] = (voteCounts[vote.itinerary_option_id] || 0) + 1;
    }

    const topCount = Math.max(0, ...Object.values(voteCounts));
    const topOptionIds = Object.entries(voteCounts)
      .filter(([, count]) => count === topCount)
      .map(([optionId]) => optionId);

    if (topOptionIds.length > 1 && !topOptionIds.includes(parsed.data.itinerary_option_id)) {
      return NextResponse.json(
        {
          error: {
            code: 'TIE_SELECTION_REQUIRED',
            message: 'There is a tie. Confirm one of the tied options.',
          },
        },
        { status: 409 }
      );
    }

    // Insert confirmed itinerary
    const { error: confirmError } = await supabase
      .from('confirmed_itinerary')
      .upsert({
        room_id: id,
        itinerary_option_id: parsed.data.itinerary_option_id,
        confirmed_by: userId,
      });

    if (confirmError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: confirmError.message } },
        { status: 500 }
      );
    }

    // Update room status
    const { error: statusError } = await supabase
      .from('rooms')
      .update({ status: 'confirmed' })
      .eq('id', id);

    if (statusError) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: statusError.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      status: 'confirmed',
      top_option_ids: topOptionIds,
      warning: missingVotes > 0 ? `${missingVotes} members haven't voted yet — confirmed by admin.` : null,
    });
  } catch (err) {
    console.error('[Confirm] Error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
