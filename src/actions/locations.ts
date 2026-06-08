'use server';

import { saveLocationSchema } from '@/lib/validators/location.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';
import { geocodeAddress, reverseGeocode } from '@/lib/maps/geocoding';
import { getCurrentApiUser, hangoutApi, isHangoutApiConfigured } from '@/lib/cloudflare/hangoutApi';

export async function saveLocation(rawInput: unknown): ActionResponse<any> {
  try {
    const parsed = saveLocationSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, locationName } = parsed.data;
    let { lat, lng } = parsed.data;
    let resolvedLocationName = locationName;

    if (resolvedLocationName && (lat === undefined || lat === null || lng === undefined || lng === null)) {
      const geocoded = await geocodeAddress(resolvedLocationName);
      lat = geocoded.lat;
      lng = geocoded.lng;
      resolvedLocationName = geocoded.formattedAddress;
    } else if (lat !== undefined && lat !== null && lng !== undefined && lng !== null && !resolvedLocationName) {
      resolvedLocationName = await reverseGeocode(lat, lng);
    }

    if (isHangoutApiConfigured()) {
      const user = await getCurrentApiUser();
      const location = await hangoutApi<any>(`/groups/${groupId}/location`, {
        method: 'POST',
        body: {
          clerkId: user.clerkId,
          lat,
          lng,
          locationName: resolvedLocationName,
        },
      });

      revalidatePath(`/groups/${groupId}`);
      return location;
    }

    const { getCurrentUser } = await import('@/lib/auth/getCurrentUser');
    const user = await getCurrentUser();
    const { locationService } = await import('@/lib/services/location.service');
    const location = await locationService.saveLocation(user.id, groupId, lat, lng, resolvedLocationName);

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(location);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateLocation(rawInput: unknown): ActionResponse<any> {
  return saveLocation(rawInput);
}

export async function reverseGeocodeAction(lat: number, lng: number): ActionResponse<string> {
  try {
    const address = await reverseGeocode(lat, lng);
    return apiResponse.success(address);
  } catch (err) {
    return apiResponse.error(err);
  }
}
