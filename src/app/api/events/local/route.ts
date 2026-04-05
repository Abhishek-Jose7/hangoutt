import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { fetchTopEventsForArea } from '@/lib/events';

function todayLabelInIST(): string {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Kolkata',
  });
  return formatter.format(new Date());
}

function areaFromLocation(locationName: string | null, nearestStation: string | null): string {
  if (locationName) {
    const first = locationName.split(',')[0]?.trim();
    if (first && first.length > 2) return first;
  }
  if (nearestStation && nearestStation.length > 2) return nearestStation;
  return 'Mumbai';
}

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

    const { data: latestMembership } = await supabase
      .from('room_members')
      .select('location_name, nearest_station')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const area = areaFromLocation(
      latestMembership?.location_name || null,
      latestMembership?.nearest_station || null
    );

    const dateLabel = todayLabelInIST();
    const events = await fetchTopEventsForArea(area, dateLabel);

    return NextResponse.json({
      area,
      date: dateLabel,
      events,
    });
  } catch (err) {
    console.error('[Events API] local events failed:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch local events' } },
      { status: 500 }
    );
  }
}
