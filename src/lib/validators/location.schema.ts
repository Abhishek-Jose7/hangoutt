import { z } from 'zod';

export const saveLocationSchema = z.object({
  groupId: z.string().uuid('Invalid group ID format'),
  locationName: z.string().min(1, 'Location name must not be empty').optional(),
  lat: z.number()
    .min(-90, 'Latitude must be at least -90')
    .max(90, 'Latitude must be at most 90')
    .optional(),
  lng: z.number()
    .min(-180, 'Longitude must be at least -180')
    .max(180, 'Longitude must be at most 180')
    .optional(),
}).refine(data => data.locationName !== undefined || (data.lat !== undefined && data.lng !== undefined), {
  message: "Either locationName or coordinates (lat, lng) must be provided.",
  path: ["locationName"],
});

export type SaveLocationInput = z.infer<typeof saveLocationSchema>;
