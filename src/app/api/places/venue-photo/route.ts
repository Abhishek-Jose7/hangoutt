import { NextRequest } from 'next/server';
import { getVenueImageUrl } from '@/lib/maps/places';

export const dynamic = 'force-dynamic';

/**
 * Compatibility endpoint for older cards. New catalog rows already carry
 * direct, source-backed image URLs; unknown venue names use local fallback.
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
    // Keep older relative image URLs working without discovering new venues.
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
