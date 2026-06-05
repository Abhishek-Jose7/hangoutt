import { z } from 'zod';

export const venueCategoryEnum = z.enum([
  'CAFE',
  'RESTAURANT',
  'PARK',
  'ARCADE',
  'BOWLING',
  'ESCAPE_ROOM',
  'MOVIE',
  'MALL',
  'DESSERT',
  'SPORTS',
  'MUSEUM'
]);

export const updateProfileSchema = z.object({
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(80, 'Name must not exceed 80 characters')
    .optional()
    .transform(val => val?.trim()),
  favoriteActivities: z.array(venueCategoryEnum)
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
