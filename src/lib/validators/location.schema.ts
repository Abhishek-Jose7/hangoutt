import { z } from 'zod';

export const saveLocationSchema = z.object({
  groupId: z.string().uuid('Invalid group ID format'),
  locationName: z.string().min(1, 'Location name must not be empty').optional().nullable(),
  lat: z.number()
    .min(-90, 'Latitude must be at least -90')
    .max(90, 'Latitude must be at most 90')
    .optional()
    .nullable(),
  lng: z.number()
    .min(-180, 'Longitude must be at least -180')
    .max(180, 'Longitude must be at most 180')
    .optional()
    .nullable(),
}).refine(data => {
  const hasName = data.locationName !== undefined && data.locationName !== null && data.locationName !== '';
  const hasCoords = data.lat !== undefined && data.lat !== null && data.lng !== undefined && data.lng !== null;
  return hasName || hasCoords;
}, {
  message: "Either locationName or coordinates (lat, lng) must be provided.",
  path: ["locationName"],
});

export type SaveLocationInput = z.infer<typeof saveLocationSchema>;

