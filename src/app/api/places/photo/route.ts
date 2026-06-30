import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ref = searchParams.get('ref');
    const maxWidth = searchParams.get('maxwidth') || '400';

    if (!ref) {
      return NextResponse.json({ error: 'Missing photo reference ("ref")' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server API key is not configured' }, { status: 500 });
    }

    const googleUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${ref}&key=${apiKey}`;

    // Perform a manual redirect fetch on the server to get the temporary googleusercontent redirect URL.
    // This prevents the browser from ever seeing the URL containing our private Google API key.
    const response = await fetch(googleUrl, {
      redirect: 'manual',
    });

    const redirectUrl = response.headers.get('location');
    if (!redirectUrl) {
      return NextResponse.json({ error: 'Failed to retrieve photo redirect from Google' }, { status: 502 });
    }

    // Return a 307 temporary redirect to the user's browser with a cache control header to cache the redirect
    return new Response(null, {
      status: 307,
      headers: {
        Location: redirectUrl,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  } catch (err: any) {
    console.error('[PHOTO PROXY ERROR]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
