import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { forwardGeocode, reverseGeocode } from '@/lib/geocoding';
import { findNearestStation, haversineDistance } from '@/lib/transit';

const CST_COORDS = { lat: 18.9402, lng: 72.8356 };

// GET /api/geocode?lat=X&lng=Y or ?q=searchQuery
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const query = searchParams.get('q');

    if (lat && lng) {
      // Reverse geocode
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);

      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid coordinates' } },
          { status: 400 }
        );
      }

      if (latNum === 0 && lngNum === 0) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid coordinates (0, 0)', field: 'location' } },
          { status: 400 }
        );
      }

      const displayName = await reverseGeocode({ lat: latNum, lng: lngNum });
      const nearestStation = findNearestStation({ lat: latNum, lng: lngNum });
      const distanceFromMumbai = haversineDistance({ lat: latNum, lng: lngNum }, CST_COORDS);

      return NextResponse.json({
        lat: latNum,
        lng: lngNum,
        display_name: displayName || `${latNum.toFixed(4)}, ${lngNum.toFixed(4)}`,
        nearest_station: nearestStation.name,
        station_line: nearestStation.line,
        warning:
          distanceFromMumbai > 80
            ? "You're outside Mumbai — travel time estimates may be inaccurate"
            : null,
      });
    }

    if (query) {
      // Forward geocode
      const result = await forwardGeocode(query);
      if (!result) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Location not found' } },
          { status: 404 }
        );
      }

      const nearestStation = findNearestStation({ lat: result.lat, lng: result.lng });
      const distanceFromMumbai = haversineDistance({ lat: result.lat, lng: result.lng }, CST_COORDS);

      return NextResponse.json({
        lat: result.lat,
        lng: result.lng,
        display_name: result.display_name,
        nearest_station: nearestStation.name,
        station_line: nearestStation.line,
        warning:
          distanceFromMumbai > 80
            ? "You're outside Mumbai — travel time estimates may be inaccurate"
            : null,
      });
    }

    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Provide lat/lng or q parameter' } },
      { status: 400 }
    );
  } catch (err) {
    console.error('[Geocode] Error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Geocoding failed' } },
      { status: 500 }
    );
  }
}
