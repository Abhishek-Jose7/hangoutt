import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { places } from '@/lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export const dynamic = 'force-dynamic';

/**
 * Secure photo proxy with DB caching.
 */
export async function GET(req: NextRequest) {
  try {
    const ref = req.nextUrl.searchParams.get('ref');
    const maxWidth = req.nextUrl.searchParams.get('maxwidth') || '300';

    if (!ref) {
      return Response.json({ error: 'Missing photo reference ("ref")' }, { status: 400 });
    }

    // 0. Fallback to Cloudflare Worker if configured (handles remote D1 database)
    if (isHangoutApiConfigured()) {
      const baseUrl = process.env.HANGOUT_API_URL?.trim();
      const normalizedBase = /^https?:\/\//i.test(baseUrl || '') ? baseUrl : `https://${baseUrl}`;
      const cleanBase = normalizedBase?.replace(/\/$/, '');
      const workerUrl = `${cleanBase}/api/places/photo?ref=${encodeURIComponent(ref)}&maxwidth=${maxWidth}`;

      const workerRes = await fetch(workerUrl);
      if (workerRes.ok) {
        const imageBuffer = Buffer.from(await workerRes.arrayBuffer());
        return new Response(imageBuffer, {
          status: 200,
          headers: {
            'Content-Type': workerRes.headers.get('content-type') || 'image/jpeg',
            'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
            'Content-Length': String(imageBuffer.length),
          },
        });
      }
    }

    // 1. Check if we have this image cached in the DB — use exact match to avoid LIKE complexity errors
    const expectedImageUrl = `/api/places/photo?ref=${encodeURIComponent(ref)}`;
    
    const cached = await db
      .select({ imageData: places.imageData, imageUrl: places.imageUrl })
      .from(places)
      .where(
        and(
          isNotNull(places.imageData),
          eq(places.imageUrl, expectedImageUrl)
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
    const fallbackRedirect = async () => {
      return Response.redirect(new URL('/images/mumbai_map.png', req.url), 307);
    };

    // 2. Not cached — fetch from Google
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return fallbackRedirect();
    }

    const googleUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${ref}&key=${apiKey}`;

    // Follow the redirect manually to get the actual image
    const redirectRes = await fetch(googleUrl, { redirect: 'manual' });
    const redirectUrl = redirectRes.headers.get('location');

    if (!redirectUrl) {
      return fallbackRedirect();
    }

    // Fetch the actual image bytes from the CDN URL
    const imageRes = await fetch(redirectUrl);
    if (!imageRes.ok) {
      return fallbackRedirect();
    }

    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    const base64 = imageBuffer.toString('base64');

    // 3. Cache in DB
    try {
      const updateResult = await db.update(places)
        .set({ imageData: base64 })
        .where(eq(places.imageUrl, expectedImageUrl));
      console.log(`[PHOTO CACHE] Cached image for ref ${ref.substring(0, 30)}... Result:`, updateResult);
    } catch (err: any) {
      console.warn('[PHOTO CACHE] Failed to cache image:', err.message);
    }

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
    return Response.redirect(new URL('/images/mumbai_map.png', req.url), 307);
  }
}
