import { z } from 'zod';

export const categoryEnum = z.enum([
  'CONCERT', 'LIVE_MUSIC', 'COMEDY', 'STANDUP_COMEDY', 'THEATRE', 'EXHIBITION',
  'ART_GALLERY', 'ART_EXHIBITION', 'MUSEUM', 'AQUARIUM', 'WORKSHOP', 'POTTERY',
  'PAINTING', 'BOOK_EVENT', 'BOOKSTORE_EVENT', 'FOOD_FESTIVAL', 'FLEA_MARKET',
  'NIGHT_MARKET', 'CONVENTION', 'COMIC_CON', 'ANIME_EVENT', 'GAMING_EVENT',
  'BOARD_GAME', 'BOARD_GAME_CAFE', 'BOARD_GAME_EVENT', 'SPORTS_EVENT', 'LOCAL_EVENT',
  'SEASONAL_EVENT', 'CULTURAL_EVENT', 'OUTDOOR_EXPERIENCE', 'SCENIC_EXPERIENCE',
  'FREE_EXPERIENCE', 'CAFE', 'RESTAURANT', 'PARK', 'ARCADE', 'BOWLING',
  'ESCAPE_ROOM', 'MOVIE', 'MOVIE_THEATER', 'MALL', 'DESSERT', 'SPORTS'
]);

const imageUrlSchema = z.string().refine(
  value => value.startsWith('/') || /^https?:\/\//i.test(value),
  'Image URL must be absolute or app-relative.'
);

export const slotSchema = z.object({
  order: z.number().int().min(1).max(5),
  venueId: z.string().nullable().optional(),
  experienceId: z.string().nullable().optional(),
  name: z.string().min(1),
  category: categoryEnum,
  arrivalTime: z.string().min(1),
  durationMinutes: z.number().int().min(15).max(300),
  travelToNextMinutes: z.number().int().min(0).max(120).nullable(),
  estimatedCostPerHead: z.number().int().min(0),
  note: z.string().min(10),
  travelToNextCost: z.number().int().min(0).nullable().optional(),
  imageUrl: imageUrlSchema.nullable().optional(),
  link: z.string().url().nullable().optional(),
}).refine(data => !!data.venueId || !!data.experienceId, {
  message: "Either venueId or experienceId must be provided.",
  path: ["venueId", "experienceId"]
});

export const itinerarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(40),
  tagline: z.string().min(5).max(120),
  budgetTier: z.enum(['TRAVEL_FRIENDLY', 'BUDGET_FRIENDLY', 'BALANCED', 'EXPERIENCE_FIRST', 'PREMIUM']),
  totalEstimatedCostPerHead: z.number().int().min(0),
  totalDurationMinutes: z.number().int().min(60),
  slots: z.array(slotSchema).min(1).max(5),
  whyRecommended: z.array(z.string()).min(1).optional(),
});

export const itineraryResponseSchema = z.object({
  itineraries: z.array(itinerarySchema).min(1).max(4),
});

export type Slot = z.infer<typeof slotSchema>;
export type Itinerary = z.infer<typeof itinerarySchema>;
export type ItineraryResponse = z.infer<typeof itineraryResponseSchema>;
export type CategoryEnum = z.infer<typeof categoryEnum>;
