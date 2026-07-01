import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { places, placeCategories } from '@/lib/db/schema';
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
      try {
        const placeRecord = await db
          .select({ category: placeCategories.category })
          .from(places)
          .innerJoin(placeCategories, eq(places.id, placeCategories.placeId))
          .where(eq(places.imageUrl, expectedImageUrl))
          .limit(1);
        const category = placeRecord.length > 0 ? placeRecord[0].category : undefined;
        const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
          'CAFE': 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&auto=format&fit=crop',
          'RESTAURANT': 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&auto=format&fit=crop',
          'DESSERT': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&auto=format&fit=crop',
          'PARK': 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=600&auto=format&fit=crop',
          'ARCADE': 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=600&auto=format&fit=crop',
          'BOWLING': 'https://images.unsplash.com/photo-1538510166367-5477e2a521e7?w=600&auto=format&fit=crop',
          'ESCAPE_ROOM': 'https://images.unsplash.com/photo-1519074069444-1ba4e6664104?w=600&auto=format&fit=crop',
          'POTTERY': 'https://images.unsplash.com/photo-1565192647048-f997ded87ab5?w=600&auto=format&fit=crop',
          'LIVE_MUSIC': 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop',
        };
        const fallbackUrl = (category && CATEGORY_FALLBACK_IMAGES[category.toUpperCase()]) || 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&auto=format&fit=crop';
        return Response.redirect(fallbackUrl, 307);
      } catch {
        return Response.redirect('https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&auto=format&fit=crop', 307);
      }
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
    return Response.redirect('https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&auto=format&fit=crop', 307);
  }
}
