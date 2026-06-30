import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { places } from '@/lib/db/schema';
import { eq, and, isNotNull, like } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Secure photo proxy with DB caching.
 *
 * Flow:
 * 1. Look up the photo ref in the DB → if image_data exists, serve the cached JPEG directly
 * 2. If not cached, fetch from Google Places Photo API on the server side
 * 3. Cache the fetched image as base64 in the DB for future requests
 * 4. Serve the image bytes with proper content-type and cache headers
 *
 * This ensures:
 * - The Google API key is NEVER exposed to the client
 * - Once cached, zero Google API calls are needed (survives free tier expiry)
 * - Images are served directly as binary, not as redirects
 */
export async function GET(req: NextRequest) {
  try {
    const ref = req.nextUrl.searchParams.get('ref');
    const maxWidth = req.nextUrl.searchParams.get('maxwidth') || '300';

    if (!ref) {
      return Response.json({ error: 'Missing photo reference ("ref")' }, { status: 400 });
    }

    // 1. Check if we have this image cached in the DB
    const refFragment = ref.substring(0, 80); // Use first 80 chars as a matching key
    
    const cached = await db
      .select({ imageData: places.imageData, imageUrl: places.imageUrl })
      .from(places)
      .where(
        and(
          isNotNull(places.imageData),
          like(places.imageUrl, `%${refFragment}%`)
        )
      )
      .limit(1);

    if (cached.length > 0 && cached[0].imageData) {
      // Serve directly from DB cache
      const imageBuffer = Buffer.from(cached[0].imageData, 'base64');
      return new Response(imageBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
          'Content-Length': String(imageBuffer.length),
        },
      });
    }

    // 2. Not cached — fetch from Google
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'Server API key is not configured' }, { status: 500 });
    }

    const googleUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${ref}&key=${apiKey}`;

    // Follow the redirect manually to get the actual image
    const redirectRes = await fetch(googleUrl, { redirect: 'manual' });
    const redirectUrl = redirectRes.headers.get('location');

    if (!redirectUrl) {
      return Response.json({ error: 'Failed to get photo redirect from Google' }, { status: 502 });
    }

    // Fetch the actual image bytes from the CDN URL
    const imageRes = await fetch(redirectUrl);
    if (!imageRes.ok) {
      return Response.json({ error: 'Failed to fetch image from Google CDN' }, { status: 502 });
    }

    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    const base64 = imageBuffer.toString('base64');

    // 3. Cache in DB (fire and forget — don't block the response)
    const refForLike = `%${refFragment}%`;
    db.update(places)
      .set({ imageData: base64 })
      .where(like(places.imageUrl, refForLike))
      .then(() => {
        console.log(`[PHOTO CACHE] Cached image for ref ${refFragment.substring(0, 30)}...`);
      })
      .catch((err: Error) => {
        console.warn('[PHOTO CACHE] Failed to cache image:', err.message);
      });

    // 4. Serve the image
    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': imageRes.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
        'Content-Length': String(imageBuffer.length),
      },
    });
  } catch (err: any) {
    console.error('[PHOTO PROXY ERROR]', err);
    return Response.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
