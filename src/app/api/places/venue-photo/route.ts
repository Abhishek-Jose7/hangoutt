import { NextRequest } from 'next/server';
import { getVenueImageUrl } from '@/lib/maps/places';

export const dynamic = 'force-dynamic';

/**
 * Resolves a venue name (+ optional city/category) to a real Google Places
 * photo and redirects to the internal /api/places/photo proxy, which streams
 * the actual image bytes. Used as a CSS background-image src for itinerary
 * plan cards so real venue imagery replaces stock placeholders.
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name');
  const city = req.nextUrl.searchParams.get('city') || 'Mumbai';
  const category = req.nextUrl.searchParams.get('category') || undefined;
  const maxWidth = req.nextUrl.searchParams.get('maxwidth') || '800';

  const fallback = new URL('/images/mumbai_map.png', req.url);

  if (!name) {
    return Response.redirect(fallback, 307);
  }

  try {
    const resolved = await getVenueImageUrl(name, city, category);
    if (!resolved || resolved === '/images/mumbai_map.png') {
      return Response.redirect(fallback, 307);
    }
    // resolved is either a relative "/api/places/photo?ref=..." URL or absolute.
    // Rewrite maxwidth so background usage gets a higher-quality asset.
    let target = resolved;
    if (target.startsWith('/api/places/photo')) {
      const u = new URL(target, req.url);
      u.searchParams.set('maxwidth', maxWidth);
      target = u.toString();
    } else if (!target.startsWith('http')) {
      target = new URL(target, req.url).toString();
    }
    return Response.redirect(target, 307);
  } catch (err) {
    console.error('[VENUE PHOTO] resolution failed:', err);
    return Response.redirect(fallback, 307);
  }
}
