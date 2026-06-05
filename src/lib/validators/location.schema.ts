import { z } from 'zod';

export const saveLocationSchema = z.object({
  groupId: z.string().uuid('Invalid group ID format'),
  lat: z.number()
    .min(-90, 'Latitude must be at least -90')
    .max(90, 'Latitude must be at most 90'),
  lng: z.number()
    .min(-180, 'Longitude must be at least -180')
    .max(180, 'Longitude must be at most 180'),
});

export type SaveLocationInput = z.infer<typeof saveLocationSchema>;
