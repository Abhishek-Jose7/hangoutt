import { locationRepository } from '../repositories/location.repository';
import { memberRepository } from '../repositories/member.repository';
import { groupService } from './group.service';
import { calculateMidpoint } from '../algorithms/midpoint';
import { saveLocationSchema } from '../validators/location.schema';
import { ForbiddenError, ValidationError, NotFoundError, InsufficientLocationsError } from '../errors';
import { geocodeAddress, reverseGeocode } from '../maps/geocoding';

export const locationService = {
  async saveLocation(userId: string, groupId: string, lat?: number | null, lng?: number | null, locationName?: string | null) {
    // 1. Verify user is member
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not a member of this planning group.');
    }

    let resolvedLat = (lat === null) ? undefined : lat;
    let resolvedLng = (lng === null) ? undefined : lng;
    let resolvedName = (locationName === null) ? undefined : locationName;

    // 2. Resolve coordinates/address
    if (resolvedName && (resolvedLat === undefined || resolvedLng === undefined)) {
      const geocoded = await geocodeAddress(resolvedName);
      resolvedLat = geocoded.lat;
      resolvedLng = geocoded.lng;
      resolvedName = geocoded.formattedAddress;
    } else if (resolvedLat !== undefined && resolvedLng !== undefined && !resolvedName) {
      resolvedName = await reverseGeocode(resolvedLat, resolvedLng);
    }

    if (resolvedLat === undefined || resolvedLng === undefined) {
      throw new ValidationError('Could not resolve coordinates for the provided location.');
    }

    const isWithinBounds = resolvedLat >= 18.8 && resolvedLat <= 19.5 && resolvedLng >= 72.6 && resolvedLng <= 73.3;
    if (!isWithinBounds) {
      throw new ValidationError('Location is outside the supported Mumbai, Navi Mumbai, and Thane region. Please enter a location within this area.');
    }

    // Validate coordinates via Zod
    const parsed = saveLocationSchema.safeParse({ groupId, lat: resolvedLat, lng: resolvedLng, locationName: resolvedName });
    if (!parsed.success) {
      throw new ValidationError('Invalid location coordinates', parsed.error.flatten());
    }

    const uuid = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    // 3. Upsert location
    const result = await locationRepository.upsertLocation({
      id: uuid(),
      groupId,
      userId,
      lat: resolvedLat,
      lng: resolvedLng,
      locationName: resolvedName,
    });

    // 4. Trigger readiness check
    await groupService.checkGroupReadiness(groupId);

    return result;
  },

  async getGroupLocations(userId: string, groupId: string) {
    // Only the group ADMIN can see individual coordinates list
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not authorized.');
    }

    if (member.role !== 'ADMIN') {
      throw new ForbiddenError('Only the group admin is authorized to view individual member coordinates.');
    }

    return locationRepository.getGroupLocations(groupId);
  },

  async getGroupMidpoint(groupId: string) {
    const locations = await locationRepository.getGroupLocations(groupId);
    if (locations.length < 1) {
      throw new InsufficientLocationsError(`At least 1 location is required. Current submissions: ${locations.length}.`);
    }

    return calculateMidpoint(locations.map(loc => ({ lat: loc.lat, lng: loc.lng })));
  },
};

export type LocationService = typeof locationService;
