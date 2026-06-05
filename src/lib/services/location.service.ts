import { locationRepository } from '../repositories/location.repository';
import { memberRepository } from '../repositories/member.repository';
import { calculateMidpoint } from '../algorithms/midpoint';
import { saveLocationSchema } from '../validators/location.schema';
import { ForbiddenError, ValidationError, NotFoundError, InsufficientLocationsError } from '../errors';

export const locationService = {
  async saveLocation(userId: string, groupId: string, lat: number, lng: number) {
    // 1. Verify user is member
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not a member of this planning group.');
    }

    // 2. Validate coordinates via Zod
    const parsed = saveLocationSchema.safeParse({ groupId, lat, lng });
    if (!parsed.success) {
      throw new ValidationError('Invalid location coordinates', parsed.error.flatten());
    }

    const uuid = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    return locationRepository.upsertLocation({
      id: uuid(),
      groupId,
      userId,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
    });
  },

  async getGroupLocations(userId: string, groupId: string) {
    // Only the group OWNER can see individual coordinates list
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not authorized.');
    }

    if (member.role !== 'OWNER') {
      throw new ForbiddenError('Only the group owner is authorized to view individual member coordinates.');
    }

    return locationRepository.getGroupLocations(groupId);
  },

  async getGroupMidpoint(groupId: string) {
    const locations = await locationRepository.getGroupLocations(groupId);
    if (locations.length < 2) {
      throw new InsufficientLocationsError(`At least 2 locations are required. Current submissions: ${locations.length}.`);
    }

    return calculateMidpoint(locations.map(loc => ({ lat: loc.lat, lng: loc.lng })));
  },
};

export type LocationService = typeof locationService;
