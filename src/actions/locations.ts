'use server';

import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { locationService } from '@/lib/services/location.service';
import { saveLocationSchema } from '@/lib/validators/location.schema';
import { apiResponse } from '@/lib/utils/apiResponse';
import { ValidationError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import { ActionResponse } from '@/lib/types/api.types';

export async function saveLocation(rawInput: unknown): ActionResponse<any> {
  try {
    const user = await getCurrentUser();
    
    // Validate inputs
    const parsed = saveLocationSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { groupId, lat, lng } = parsed.data;

    const location = await locationService.saveLocation(user.id, groupId, lat, lng);

    revalidatePath(`/groups/${groupId}`);
    return apiResponse.success(location);
  } catch (err) {
    return apiResponse.error(err);
  }
}

export async function updateLocation(rawInput: unknown): ActionResponse<any> {
  // saveLocation handles both create and update (upsert)
  return saveLocation(rawInput);
}
