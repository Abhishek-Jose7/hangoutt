import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { searchPlaces } from '@/lib/tavily';
import type { Mood, Place } from '@/types';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  hub: z.string().min(2).max(120),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  mood: z.enum(['fun', 'chill', 'romantic', 'adventure']),
  budget: z.coerce.number().int().min(120).max(10000).default(1200),
});

function countBySource(places: Place[]): Record<string, number> {
  return places.reduce<Record<string, number>>((acc, place) => {
    acc[place.source] = (acc[place.source] || 0) + 1;
    return acc;
  }, {});
}

// GET /api/search/places?hub=Bandra&lat=19.06&lng=72.83&mood=fun&budget=1200
export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      hub: url.searchParams.get('hub'),
      lat: url.searchParams.get('lat'),
      lng: url.searchParams.get('lng'),
      mood: url.searchParams.get('mood'),
      budget: url.searchParams.get('budget') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid search query' } },
        { status: 400 }
      );
    }

    const query = parsed.data;
    const places = await searchPlaces(
      query.hub,
      { lat: query.lat, lng: query.lng },
      query.mood as Mood,
      query.budget
    );

    return NextResponse.json({
      success: true,
      places,
      total: places.length,
      source_breakdown: countBySource(places),
    });
  } catch (error) {
    console.error('[API Search Places] Failed:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Search request failed' } },
      { status: 500 }
    );
  }
}
