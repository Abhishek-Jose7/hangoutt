'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { memberRepository } from '@/lib/repositories/member.repository';
import { locationRepository } from '@/lib/repositories/location.repository';
import { saveLocationSchema } from '@/lib/validators/location.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';

export async function saveLocation(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Validate inputs
    const parsed = saveLocationSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, lat, lng } = parsed.data;

    // Check that user is a member
    const member = await memberRepository.getMember(groupId, user.id);
    if (!member) {
      throw new NotFoundError('You must be a member of the group to submit your location.');
    }

    const randomUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    const location = await locationRepository.upsertLocation({
      id: randomUUID(),
      groupId,
      userId: user.id,
      lat,
      lng,
    });

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(location);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateLocation(rawInput: unknown): ActionResponse<any> {
  // Submission upserts, so saveLocation handles both creation and updates
  return saveLocation(rawInput);
}

import { ActionResponse } from '@/lib/types/api.types';
