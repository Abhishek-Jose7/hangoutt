import { z } from 'zod';
import { venueCategoryEnum } from './profile.schema';

export const slotSchema = z.object({
  order: z.number().int().min(1).max(5),
  venueId: z.string().min(1),
  venueName: z.string().min(1),
  category: venueCategoryEnum,
  arrivalTime: z.string().min(1),
  durationMinutes: z.number().int().min(15).max(300),
  travelToNextMinutes: z.number().int().min(0).max(120).nullable(),
  estimatedCostPerHead: z.number().int().min(0),
  note: z.string().min(10),
});

export const itinerarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(40),
  tagline: z.string().min(5).max(120),
  totalEstimatedCostPerHead: z.number().int().min(0),
  totalDurationMinutes: z.number().int().min(60),
  slots: z.array(slotSchema).min(3).max(5),
});

export const itineraryResponseSchema = z.object({
  itineraries: z.array(itinerarySchema).min(3).max(4),
});

export type Slot = z.infer<typeof slotSchema>;
export type Itinerary = z.infer<typeof itinerarySchema>;
export type ItineraryResponse = z.infer<typeof itineraryResponseSchema>;
