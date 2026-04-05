import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';

// GET /api/rooms/[id]/votes — Get vote counts
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/rooms/[id]/votes'>
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

    // Check if user is admin and room status
    const { data: room } = await supabase
      .from('rooms')
      .select('admin_id, status')
      .eq('id', id)
      .single();

    const isAdmin = room?.admin_id === userId;

    // Get all votes
    const { data: votes, error } = await supabase
      .from('votes')
      .select('*')
      .eq('room_id', id);

    if (error) {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Count votes per option
    const counts: Record<string, number> = {};
    let userVote: string | null = null;

    for (const vote of votes || []) {
      counts[vote.itinerary_option_id] = (counts[vote.itinerary_option_id] || 0) + 1;
      if (vote.user_id === userId) {
        userVote = vote.itinerary_option_id;
      }
    }

    const voteCounts = Object.entries(counts).map(([itinerary_option_id, count]) => ({
      itinerary_option_id,
      count,
    }));

    // Get total member count
    const { count: memberCount } = await supabase
      .from('room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', id);

    const { data: earliestOption } = await supabase
      .from('itinerary_options')
      .select('generated_at')
      .eq('room_id', id)
      .order('generated_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const totalVotes = votes?.length || 0;
    const totalMembers = memberCount || 0;
    const allVoted = totalMembers > 0 && totalVotes >= totalMembers;
    const missingVotes = Math.max(0, totalMembers - totalVotes);
    const votingStartTs = earliestOption?.generated_at
      ? new Date(earliestOption.generated_at).getTime()
      : null;
    const tenMins = 10 * 60 * 1000;
    const canConfirmNow =
      allVoted || (votingStartTs !== null && Date.now() - votingStartTs >= tenMins);

    const sortedVotes = [...voteCounts].sort((a, b) => b.count - a.count);
    const topVoteCount = sortedVotes[0]?.count || 0;
    const topOptionIds = sortedVotes
      .filter((voteCount) => voteCount.count === topVoteCount)
      .map((voteCount) => voteCount.itinerary_option_id);
    const isTie = topOptionIds.length > 1;

    let autoConfirmed = false;
    if (room?.status === 'voting' && totalMembers > 0 && allVoted && voteCounts.length === 1) {
      const firstVoteTs = votes?.reduce<string | null>((oldest, vote) => {
        if (!oldest) return vote.created_at as string;
        return new Date(vote.created_at as string) < new Date(oldest) ? (vote.created_at as string) : oldest;
      }, null);

      if (firstVoteTs) {
        const elapsedMs = Date.now() - new Date(firstVoteTs).getTime();
        const thirtyMins = 30 * 60 * 1000;
        if (elapsedMs >= thirtyMins) {
          const winningOptionId = voteCounts[0].itinerary_option_id;
          await supabase.from('confirmed_itinerary').upsert({
            room_id: id,
            itinerary_option_id: winningOptionId,
            confirmed_by: room.admin_id,
          });
          await supabase.from('rooms').update({ status: 'confirmed' }).eq('id', id);
          autoConfirmed = true;
        }
      }
    }

    return NextResponse.json({
      votes: voteCounts,
      user_vote: userVote,
      total_votes: totalVotes,
      total_members: totalMembers,
      is_admin: isAdmin,
      show_counts: isAdmin || allVoted,
      all_voted: allVoted,
      missing_votes: missingVotes,
      auto_confirmed: autoConfirmed,
      can_confirm_now: canConfirmNow,
      top_option_ids: topOptionIds,
      is_tie: isTie,
      confirm_warning: missingVotes > 0 ? `${missingVotes} members haven't voted yet — confirm anyway?` : null,
    });
  } catch (err) {
    console.error('[Votes] GET error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
      { status: 500 }
    );
  }
}
